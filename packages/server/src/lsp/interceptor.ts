// LSP message interceptor — transforms messages flowing between client and server.
// Handles URI rewriting, workspace initialization, and file synchronization.

import type { Workspace } from "./workspace.js";

/** Apply an incremental LSP text edit (range + newText) to a string */
function applyTextEdit(
    content: string,
    range: { start: { line: number; character: number }; end: { line: number; character: number } },
    newText: string,
): string {
    const lines = content.split("\n");
    const startOffset = linesToOffset(lines, range.start.line, range.start.character);
    const endOffset = linesToOffset(lines, range.end.line, range.end.character);
    return content.substring(0, startOffset) + newText + content.substring(endOffset);
}

function linesToOffset(lines: string[], line: number, character: number): number {
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for \n
    }
    return offset + character;
}

export interface MessageInterceptor {
    processClientMessage(msg: any): any;
    processServerMessage(msg: any): any;
}

export function createInterceptor(workspace: Workspace): MessageInterceptor {
    const { dir, uri, virtualToReal, realToVirtual, rewriteUris, syncFile, removeFile, reclaimFile, getFileContent } = workspace;

    function processClientMessage(msg: any): any {
        // initialize: rewrite rootUri / rootPath / workspaceFolders to real temp dir
        if (msg.method === "initialize" && msg.params) {
            msg.params.rootUri = uri;
            msg.params.rootPath = dir;
            if (msg.params.workspaceFolders) {
                msg.params.workspaceFolders = [{ uri, name: "workspace" }];
            }
        }

        // Rewrite all file:// URIs in params from virtual → real
        if (msg.params) {
            msg.params = rewriteUris(msg.params, virtualToReal);
        }

        // textDocument/didOpen — reclaim from cache or sync to disk
        if (msg.method === "textDocument/didOpen" && msg.params?.textDocument) {
            const { uri: docUri, text } = msg.params.textDocument;
            // Cancel pending removal — if cached content + disk file still exist,
            // syncFile will skip the write (hash match). Instant reopen.
            reclaimFile(docUri);
            syncFile(docUri, text);
        }

        // textDocument/didChange — sync content updates (full and incremental)
        if (msg.method === "textDocument/didChange" && msg.params) {
            const docUri = msg.params.textDocument.uri;
            const changes = msg.params.contentChanges;
            if (changes) {
                let content = getFileContent(docUri) ?? "";
                for (const change of changes) {
                    if (change.range === undefined) {
                        content = change.text;
                    } else {
                        content = applyTextEdit(content, change.range, change.text);
                    }
                }
                syncFile(docUri, content);
            }
        }

        // textDocument/didClose — remove temp file
        if (msg.method === "textDocument/didClose" && msg.params?.textDocument) {
            removeFile(msg.params.textDocument.uri);
        }

        return msg;
    }

    function processServerMessage(msg: any): any {
        // Rewrite all file:// URIs from real → virtual
        if (msg.result !== undefined) {
            msg.result = rewriteUris(msg.result, realToVirtual);
        }
        if (msg.params) {
            msg.params = rewriteUris(msg.params, realToVirtual);
        }
        // Rewrite URIs in error responses (e.g. error.data may contain file paths)
        if (msg.error?.data !== undefined) {
            msg.error.data = rewriteUris(msg.error.data, realToVirtual);
        }
        return msg;
    }

    return { processClientMessage, processServerMessage };
}
