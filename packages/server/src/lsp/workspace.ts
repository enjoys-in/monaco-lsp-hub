// Temp workspace creation, URI mapping, and file sync for cloud deployments.
// Each WebSocket session gets an isolated temp directory so language servers
// that require real files on disk can function without a persistent filesystem.
//
// Clients may create arbitrary files anywhere *inside* the session workspace,
// nested directories included — that is what a real LSP workspace needs, and
// `didOpen` on a new URI is the mechanism for it. Paths that resolve outside
// the session directory are rejected: `..` escapes are never legitimate LSP
// traffic, only a way to write to the host filesystem.

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";

const VIRTUAL_ROOT = "file:///workspace";
const FILE_SCHEME = "file://";

/**
 * Percent-encode the characters that would otherwise make a legitimate
 * filename unparseable as a URI.
 *
 * Clients differ on how much they encode — Monaco's `Uri.toString(true)`, for
 * instance, encodes nothing. An unencoded `#` or `?` makes `new URL()` read the
 * rest of the name as a fragment or query, so `file:///workspace/a#b.py`
 * resolves to `/workspace/a`; a lone `%` (as in `50%_done.txt`) makes
 * `fileURLToPath` throw outright and the document silently never syncs. Both
 * are ordinary names over SFTP, so the hub normalizes them instead of
 * demanding a spec-perfect client.
 */
function canonicalizeFileUri(u: string): string {
    if (!u.startsWith(FILE_SCHEME)) return u;
    const rest = u.slice(FILE_SCHEME.length);
    const encoded = rest
        .replace(/%(?![0-9a-fA-F]{2})/g, "%25")
        .replace(/#/g, "%23")
        .replace(/\?/g, "%3F");
    return encoded === rest ? u : FILE_SCHEME + encoded;
}

export interface Workspace {
    /** Absolute path to the temp directory */
    dir: string;
    /** file:// URI of the temp directory */
    uri: string;
    /**
     * Rewrite a client→server payload: every virtual `file:///workspace/…` URI
     * becomes the real temp path. Non-canonical URIs are normalized on the way
     * through and remembered, so `rewriteToClient` can hand the client back
     * byte-identical URIs to the ones it sent.
     */
    rewriteToServer(obj: unknown): unknown;
    /**
     * Rewrite a server→client payload: real temp URIs become virtual ones, and
     * bare temp paths embedded in message text are scrubbed too.
     */
    rewriteToClient(obj: unknown): unknown;
    /** Write file content to disk (skips write if content unchanged) */
    syncFile(uri: string, content: string): void;
    /** Remove a file from the temp workspace */
    removeFile(uri: string): void;
    /** Cancel any pending removal and restore from cache if available */
    reclaimFile(uri: string): boolean;
    /** Cached file content, falling back to whatever is on disk */
    getFileContent(uri: string): string | undefined;
    /** Workspace-relative path for a URI, or null when it points outside */
    relativePath(uri: string): string | null;
    /** Delete the entire temp workspace */
    cleanup(): void;
}

export function createWorkspace(): Workspace {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-workspace-"));
    const uri = pathToFileURL(dir).href;

    // Prefix comparisons require a path-segment boundary, otherwise a sibling
    // directory (file:///workspace-other/…) would be mapped into this session.
    function hasPrefix(u: string, prefix: string): boolean {
        return u === prefix || u.startsWith(prefix + "/");
    }

    function virtualToReal(u: string): string {
        if (!hasPrefix(u, VIRTUAL_ROOT)) return u;
        return uri + u.substring(VIRTUAL_ROOT.length);
    }

    function realToVirtual(u: string): string {
        if (!hasPrefix(u, uri)) return u;
        return VIRTUAL_ROOT + u.substring(uri.length);
    }

    // ── URI aliases ──────────────────────────────────────────────────────────
    // Resolved real path → the exact URI string the client used for it.
    //
    // Keyed on the path rather than on the URI text because the two ends encode
    // differently and neither is wrong: a client may send a raw space, and the
    // language server echoes back the same file as `%20`. The filesystem path is
    // the one identity both agree on. Restoring the client's own spelling
    // matters because a client matches diagnostics to its open documents by
    // string equality — a re-encoded URI means diagnostics land nowhere.
    const originalByRealPath = new Map<string, string>();

    function toServerUri(u: string): string {
        const canonical = canonicalizeFileUri(u);
        // Real URIs (the rootUri the interceptor has already substituted) and
        // anything outside the virtual root pass through untouched.
        if (!hasPrefix(canonical, VIRTUAL_ROOT)) return canonical;

        const realPath = resolveInsideWorkspace(u);
        if (!realPath) return virtualToReal(canonical);

        originalByRealPath.set(realPath, u);
        // pathToFileURL, not string surgery: the server gets a spec-clean URI
        // whatever the client sent.
        return pathToFileURL(realPath).href;
    }

    function toClientUri(u: string): string {
        const canonical = canonicalizeFileUri(u);
        if (!hasPrefix(canonical, uri)) return u;

        const realPath = resolveInsideWorkspace(canonical);
        if (realPath) {
            const original = originalByRealPath.get(realPath);
            if (original) return original;
        }
        return realToVirtual(canonical);
    }

    /** Strip the temp directory out of free text (diagnostic messages, hovers) */
    function scrubPaths(s: string): string {
        return s.includes(dir) ? s.split(dir).join("/workspace") : s;
    }

    function rewrite(obj: unknown, rewriter: (u: string) => string, text?: (s: string) => string): unknown {
        if (typeof obj === "string") {
            if (obj.startsWith(FILE_SCHEME)) return rewriter(obj);
            return text ? text(obj) : obj;
        }
        if (Array.isArray(obj)) return obj.map((v) => rewrite(v, rewriter, text));
        if (obj && typeof obj === "object") {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(obj)) {
                // Rewrite keys that are file:// URIs (e.g. WorkspaceEdit.changes)
                const rewrittenKey = k.startsWith(FILE_SCHEME) ? rewriter(k) : k;
                out[rewrittenKey] = rewrite(v, rewriter, text);
            }
            return out;
        }
        return obj;
    }

    function rewriteToServer(obj: unknown): unknown {
        return rewrite(obj, toServerUri);
    }

    function rewriteToClient(obj: unknown): unknown {
        return rewrite(obj, toClientUri, scrubPaths);
    }

    // ── Stale-cache: skip redundant disk I/O ─────────────────────────────────
    // Track content hashes and created directories to avoid unnecessary writes.
    const contentHashes = new Map<string, string>();
    const fileContents = new Map<string, string>();
    const createdDirs = new Set<string>();
    const pendingRemovals = new Map<string, ReturnType<typeof setTimeout>>();

    const STALE_CACHE_MS = 2 * 60 * 1000; // 2 minutes

    let disposed = false;

    function hash(content: string): string {
        return crypto.createHash("md5").update(content).digest("hex");
    }

    /**
     * Cache key for a URI: the resolved real path, so a `didChange` still finds
     * the baseline its `didOpen` cached even if the two spell the same name with
     * different encoding. Unresolvable URIs fall back to their canonical text.
     */
    function cacheKey(fileUri: string): string {
        return resolveInsideWorkspace(fileUri) ?? canonicalizeFileUri(fileUri);
    }

    /**
     * Resolve a file:// URI to a real path inside this workspace.
     * Returns null when the URI is unparseable or escapes the workspace root —
     * `new URL()` collapses `..` and percent-encoded `%2e%2e` segments, so the
     * check has to run on the *resolved* path, not on the URI text.
     */
    function resolveInsideWorkspace(fileUri: string): string | null {
        let filePath: string;
        try {
            filePath = fileURLToPath(virtualToReal(canonicalizeFileUri(fileUri)));
        } catch {
            return null;
        }
        const resolved = path.resolve(filePath);
        if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
            return null;
        }
        return resolved;
    }

    function relativePath(fileUri: string): string | null {
        const resolved = resolveInsideWorkspace(fileUri);
        if (!resolved || resolved === dir) return null;
        return path.relative(dir, resolved).split(path.sep).join("/");
    }

    /** Ensure parent directory exists (cached — only calls mkdirSync once per dir) */
    function ensureDir(filePath: string): void {
        const dirPath = path.dirname(filePath);
        if (createdDirs.has(dirPath)) return;
        fs.mkdirSync(dirPath, { recursive: true });
        createdDirs.add(dirPath);
    }

    function syncFile(fileUri: string, content: string): void {
        if (disposed) return;
        try {
            const filePath = resolveInsideWorkspace(fileUri);
            if (!filePath) {
                console.warn(`[Workspace] Refusing write outside workspace: ${fileUri}`);
                return;
            }

            const key = cacheKey(fileUri);

            // Cancel any pending deferred removal — file is active again
            const pending = pendingRemovals.get(key);
            if (pending) {
                clearTimeout(pending);
                pendingRemovals.delete(key);
            }

            // Update in-memory cache always
            fileContents.set(key, content);

            // Skip disk write if content hasn't changed
            const h = hash(content);
            if (contentHashes.get(key) === h) return;
            contentHashes.set(key, h);

            ensureDir(filePath);
            fs.writeFileSync(filePath, content, "utf-8");
        } catch (err) {
            console.error("[Workspace] Failed to sync file:", err);
        }
    }

    /** Deferred removal — keeps cache for STALE_CACHE_MS so reopening is instant */
    function removeFile(fileUri: string): void {
        if (disposed) return;

        const filePath = resolveInsideWorkspace(fileUri);
        if (!filePath) {
            console.warn(`[Workspace] Refusing delete outside workspace: ${fileUri}`);
            return;
        }

        const key = cacheKey(fileUri);

        // If already pending, reset the timer
        const existing = pendingRemovals.get(key);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            pendingRemovals.delete(key);
            fileContents.delete(key);
            contentHashes.delete(key);
            try {
                fs.unlinkSync(filePath);
            } catch {
                // ignore — file may already be gone
            }
        }, STALE_CACHE_MS);

        pendingRemovals.set(key, timer);
    }

    /** Cancel pending removal and return true if cached content was available */
    function reclaimFile(fileUri: string): boolean {
        const key = cacheKey(fileUri);
        const pending = pendingRemovals.get(key);
        if (pending) {
            clearTimeout(pending);
            pendingRemovals.delete(key);
        }
        return fileContents.has(key);
    }

    /**
     * Cached content, or whatever is on disk if the cache has no entry.
     *
     * The disk fallback is what keeps incremental `didChange` honest: a client
     * that opened its document before this socket existed, or one whose file was
     * evicted by the stale-cache timer, has no cached baseline, and applying a
     * range edit to an empty string would write a corrupted file.
     */
    function getFileContent(fileUri: string): string | undefined {
        const key = cacheKey(fileUri);
        const cached = fileContents.get(key);
        if (cached !== undefined) return cached;

        const filePath = resolveInsideWorkspace(fileUri);
        if (!filePath) return undefined;
        try {
            const content = fs.readFileSync(filePath, "utf-8");
            fileContents.set(key, content);
            contentHashes.set(key, hash(content));
            return content;
        } catch {
            return undefined;
        }
    }

    function cleanup(): void {
        if (disposed) return;
        disposed = true;

        for (const timer of pendingRemovals.values()) clearTimeout(timer);
        pendingRemovals.clear();
        fileContents.clear();
        contentHashes.clear();
        createdDirs.clear();
        originalByRealPath.clear();

        // Language servers keep writing caches while they shut down, so retry
        // instead of silently leaving the directory behind in /tmp.
        fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }, (err) => {
            if (err) console.error(`[Workspace] Failed to remove ${dir}:`, err.message);
        });
    }

    return {
        dir, uri,
        rewriteToServer, rewriteToClient,
        syncFile, removeFile, reclaimFile, getFileContent, relativePath, cleanup,
    };
}
