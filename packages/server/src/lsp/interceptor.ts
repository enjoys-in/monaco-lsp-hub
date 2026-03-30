// LSP message interceptor — transforms messages flowing between client and server.
// Handles URI rewriting, workspace initialization, and file synchronization.

import type { Workspace } from "./workspace.js";

export interface MessageInterceptor {
    processClientMessage(msg: any): any;
    processServerMessage(msg: any): any;
}

export function createInterceptor(workspace: Workspace): MessageInterceptor {
    const { dir, uri, virtualToReal, realToVirtual, rewriteUris, syncFile, removeFile } = workspace;

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

        // textDocument/didOpen — sync file content to disk
        if (msg.method === "textDocument/didOpen" && msg.params?.textDocument) {
            const { uri: docUri, text } = msg.params.textDocument;
            syncFile(docUri, text);
        }

        // textDocument/didChange — sync full-document content updates
        if (msg.method === "textDocument/didChange" && msg.params) {
            const docUri = msg.params.textDocument.uri;
            const changes = msg.params.contentChanges;
            const fullChange = changes?.find((c: any) => c.range === undefined);
            if (fullChange) {
                syncFile(docUri, fullChange.text);
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
        return msg;
    }

    return { processClientMessage, processServerMessage };
}
