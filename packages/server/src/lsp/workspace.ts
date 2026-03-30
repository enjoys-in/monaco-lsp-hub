// Temp workspace creation, URI mapping, and file sync for cloud deployments.
// Each WebSocket session gets an isolated temp directory so language servers
// that require real files on disk can function without a persistent filesystem.

import fs from "fs";
import path from "path";
import os from "os";
import { pathToFileURL } from "url";

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
    rewriteUris(obj: any, rewriter: (uri: string) => string): any;
    /** Write file content to disk so the language server can read it */
    syncFile(uri: string, content: string): void;
    /** Remove a file from the temp workspace */
    removeFile(uri: string): void;
    /** Delete the entire temp workspace */
    cleanup(): void;
}

export function createWorkspace(): Workspace {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-workspace-"));
    const uri = pathToFileURL(dir).href;

    function virtualToReal(u: string): string {
        return u.startsWith(VIRTUAL_ROOT)
            ? uri + u.substring(VIRTUAL_ROOT.length)
            : u;
    }

    function realToVirtual(u: string): string {
        return u.startsWith(uri)
            ? VIRTUAL_ROOT + u.substring(uri.length)
            : u;
    }

    function rewriteUris(obj: any, rewriter: (u: string) => string): any {
        if (typeof obj === "string") {
            return obj.startsWith("file://") ? rewriter(obj) : obj;
        }
        if (Array.isArray(obj)) return obj.map((v) => rewriteUris(v, rewriter));
        if (obj && typeof obj === "object") {
            const out: any = {};
            for (const [k, v] of Object.entries(obj)) {
                out[k] = rewriteUris(v, rewriter);
            }
            return out;
        }
        return obj;
    }

    function syncFile(fileUri: string, content: string): void {
        try {
            const realUri = virtualToReal(fileUri);
            const filePath = new URL(realUri);
            fs.mkdirSync(path.dirname(filePath.pathname), { recursive: true });
            fs.writeFileSync(filePath.pathname, content, "utf-8");
        } catch (err) {
            console.error("[Workspace] Failed to sync file:", err);
        }
    }

    function removeFile(fileUri: string): void {
        try {
            const realUri = virtualToReal(fileUri);
            const filePath = new URL(realUri);
            fs.unlinkSync(filePath.pathname);
        } catch {
            // ignore — file may already be gone
        }
    }

    function cleanup(): void {
        fs.rm(dir, { recursive: true, force: true }, () => {});
    }

    return { dir, uri, virtualToReal, realToVirtual, rewriteUris, syncFile, removeFile, cleanup };
}
