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

export interface Workspace {
    /** Absolute path to the temp directory */
    dir: string;
    /** file:// URI of the temp directory */
    uri: string;
    /** Map a virtual file:///workspace/… URI to the real temp path */
    virtualToReal(uri: string): string;
    /** Map a real temp URI back to the virtual file:///workspace/… URI */
    realToVirtual(uri: string): string;
    /** Recursively rewrite all file:// URIs in an object */
    rewriteUris(obj: unknown, rewriter: (uri: string) => string): unknown;
    /** Write file content to disk (skips write if content unchanged) */
    syncFile(uri: string, content: string): void;
    /** Remove a file from the temp workspace */
    removeFile(uri: string): void;
    /** Cancel any pending removal and restore from cache if available */
    reclaimFile(uri: string): boolean;
    /** Get cached file content (in-memory) */
    getFileContent(uri: string): string | undefined;
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

    function rewriteUris(obj: unknown, rewriter: (u: string) => string): unknown {
        if (typeof obj === "string") {
            return obj.startsWith("file://") ? rewriter(obj) : obj;
        }
        if (Array.isArray(obj)) return obj.map((v) => rewriteUris(v, rewriter));
        if (obj && typeof obj === "object") {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(obj)) {
                // Rewrite keys that are file:// URIs (e.g. WorkspaceEdit.changes)
                const rewrittenKey = k.startsWith("file://") ? rewriter(k) : k;
                out[rewrittenKey] = rewriteUris(v, rewriter);
            }
            return out;
        }
        return obj;
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
     * Resolve a file:// URI to a real path inside this workspace.
     * Returns null when the URI is unparseable or escapes the workspace root —
     * `new URL()` collapses `..` and percent-encoded `%2e%2e` segments, so the
     * check has to run on the *resolved* path, not on the URI text.
     */
    function resolveInsideWorkspace(fileUri: string): string | null {
        let filePath: string;
        try {
            filePath = fileURLToPath(virtualToReal(fileUri));
        } catch {
            return null;
        }
        const resolved = path.resolve(filePath);
        if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
            return null;
        }
        return resolved;
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

            // Cancel any pending deferred removal — file is active again
            const pending = pendingRemovals.get(fileUri);
            if (pending) {
                clearTimeout(pending);
                pendingRemovals.delete(fileUri);
            }

            // Update in-memory cache always
            fileContents.set(fileUri, content);

            // Skip disk write if content hasn't changed
            const h = hash(content);
            if (contentHashes.get(fileUri) === h) return;
            contentHashes.set(fileUri, h);

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

        // If already pending, reset the timer
        const existing = pendingRemovals.get(fileUri);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            pendingRemovals.delete(fileUri);
            fileContents.delete(fileUri);
            contentHashes.delete(fileUri);
            try {
                fs.unlinkSync(filePath);
            } catch {
                // ignore — file may already be gone
            }
        }, STALE_CACHE_MS);

        pendingRemovals.set(fileUri, timer);
    }

    /** Cancel pending removal and return true if cached content was available */
    function reclaimFile(fileUri: string): boolean {
        const pending = pendingRemovals.get(fileUri);
        if (pending) {
            clearTimeout(pending);
            pendingRemovals.delete(fileUri);
        }
        return fileContents.has(fileUri);
    }

    function getFileContent(fileUri: string): string | undefined {
        return fileContents.get(fileUri);
    }

    function cleanup(): void {
        if (disposed) return;
        disposed = true;

        for (const timer of pendingRemovals.values()) clearTimeout(timer);
        pendingRemovals.clear();
        fileContents.clear();
        contentHashes.clear();
        createdDirs.clear();

        // Language servers keep writing caches while they shut down, so retry
        // instead of silently leaving the directory behind in /tmp.
        fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }, (err) => {
            if (err) console.error(`[Workspace] Failed to remove ${dir}:`, err.message);
        });
    }

    return {
        dir, uri,
        virtualToReal, realToVirtual, rewriteUris,
        syncFile, removeFile, reclaimFile, getFileContent, cleanup,
    };
}
