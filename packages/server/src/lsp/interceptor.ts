// LSP message interceptor — transforms messages flowing between client and server.
// Handles URI rewriting, workspace initialization, and file synchronization.

import type { Workspace } from "./workspace.js";
import { scaffoldWorkspace, canScaffold } from "./scaffold.js";
import type {
    LspMessage,
    LspParams,
    InitializeParams,
    DidOpenTextDocumentParams,
    DidChangeTextDocumentParams,
    DidCloseTextDocumentParams,
    Range,
} from "./types.js";

/**
 * Offset of an LSP position within `lines` (the content split on "\n").
 *
 * Clamped at both ends: a stale or malformed range from a client that has
 * drifted out of sync must not write at a wrong offset. Line lengths keep any
 * trailing "\r", so the +1 per line is correct for CRLF content too.
 */
function linesToOffset(lines: string[], rawLine: number, character: number): number {
    const line = Math.max(0, rawLine);

    let total = 0;
    for (const l of lines) total += l.length + 1;
    total -= 1; // no newline after the last line

    if (line >= lines.length) return total;

    let offset = 0;
    for (let i = 0; i < line; i++) {
        offset += lines[i].length + 1; // +1 for \n
    }
    return offset + Math.max(0, Math.min(character, lines[line].length));
}

/** Apply an incremental LSP text edit (range + newText) to a string */
function applyTextEdit(content: string, range: Range, newText: string): string {
    const lines = content.split("\n");
    const startOffset = linesToOffset(lines, range.start.line, range.start.character);
    const endOffset = Math.max(startOffset, linesToOffset(lines, range.end.line, range.end.character));
    return content.substring(0, startOffset) + newText + content.substring(endOffset);
}

/**
 * Monaco language id → LSP language id.
 *
 * The two vocabularies are not the same. Monaco calls shell scripts `shell`,
 * while the LSP/VS Code identifier every shell server matches on is
 * `shellscript`; Monaco ships per-dialect SQL languages where servers expect
 * plain `sql`. The mismatch is silent until a server registers a dynamic
 * capability with a `documentSelector`, at which point the selector fails to
 * match and the feature simply never appears — no error anywhere.
 *
 * Only ids with a known, unambiguous LSP counterpart are mapped; anything else
 * passes through untouched.
 */
const LANGUAGE_ID_ALIASES: Record<string, string> = {
    shell: "shellscript",
    bash: "shellscript",
    sh: "shellscript",
    zsh: "shellscript",
    yml: "yaml",
    mysql: "sql",
    pgsql: "sql",
};

export interface MessageInterceptor {
    processClientMessage(msg: LspMessage): LspMessage;
    processServerMessage(msg: LspMessage): LspMessage;
}

export function createInterceptor(workspace: Workspace): MessageInterceptor {
    const {
        dir, uri, rewriteToServer, rewriteToClient,
        syncFile, removeFile, reclaimFile, getFileContent, relativePath,
    } = workspace;

    /**
     * The launcher pre-scaffolds for a guessed `main.<ext>` because some servers
     * read their project file at init. The first *source* document the client
     * opens is the real one, so it gets to correct that guess exactly once.
     */
    let primaryScaffolded = false;

    /** Workspace-relative paths the client has sent content for */
    const clientProvided = new Set<string>();

    function scaffoldForPrimaryDocument(docUri: string): void {
        if (primaryScaffolded) return;

        const relPath = relativePath(docUri);
        if (!relPath) return;

        // Latch only on a document the hub actually scaffolds for. Clients
        // commonly open their project files first (the `client` package sends
        // go.mod and Cargo.toml as documents), and consuming the one chance on
        // one of those left the real source file unscaffolded.
        if (!canScaffold(relPath)) return;
        primaryScaffolded = true;

        const result = scaffoldWorkspace(dir, relPath, { overwrite: true, skip: clientProvided });
        if (result) {
            // Servers that read their project file at init (rust-analyzer) pick
            // this up through their own watcher, not through the protocol.
            console.log(`[LSP] Scaffolded ${result.language} for ${relPath}: ${result.created.join(", ")}`);
        }
    }

    function processClientMessage(msg: LspMessage): LspMessage {
        // Client→server *responses* (the reply to workspace/configuration or
        // workspace/workspaceFolders, for instance) carry file:// URIs too, so
        // they need the same virtual→real rewrite as requests.
        if (msg.method === undefined) {
            if (msg.result !== undefined) {
                msg.result = rewriteToServer(msg.result);
            }
            if (msg.error?.data !== undefined) {
                msg.error.data = rewriteToServer(msg.error.data);
            }
            return msg;
        }

        // initialize: rewrite rootUri / rootPath / workspaceFolders to real temp dir
        if (msg.method === "initialize" && msg.params) {
            const params = msg.params as InitializeParams;
            params.rootUri = uri;
            params.rootPath = dir;
            if (params.workspaceFolders) {
                params.workspaceFolders = [{ uri, name: "workspace" }];
            }
            // A processId belonging to the *client's* host means nothing here,
            // and servers that monitor it (jdtls, rust-analyzer) exit when it
            // turns out not to exist. The hub is the real parent.
            if (typeof params.processId === "number") {
                params.processId = process.pid;
            }
        }

        // Rewrite all file:// URIs in params from virtual → real
        if (msg.params) {
            msg.params = rewriteToServer(msg.params) as LspParams;
        }

        // textDocument/didOpen — reclaim from cache or sync to disk
        if (msg.method === "textDocument/didOpen" && msg.params) {
            const params = msg.params as unknown as DidOpenTextDocumentParams;
            const { uri: docUri, text } = params.textDocument;

            const lspLanguageId = LANGUAGE_ID_ALIASES[params.textDocument.languageId];
            if (lspLanguageId) {
                params.textDocument.languageId = lspLanguageId;
            }

            // Cancel pending removal — if cached content + disk file still exist,
            // syncFile will skip the write (hash match). Instant reopen.
            reclaimFile(docUri);
            syncFile(docUri, text);
            const rel = relativePath(docUri);
            if (rel) clientProvided.add(rel);
            scaffoldForPrimaryDocument(docUri);
        }

        // textDocument/didChange — sync content updates (full and incremental)
        if (msg.method === "textDocument/didChange" && msg.params) {
            const params = msg.params as unknown as DidChangeTextDocumentParams;
            const docUri = params.textDocument.uri;
            const changes = params.contentChanges;
            if (changes && changes.length > 0) {
                // `undefined` means "no baseline known". A full-text change
                // establishes one; an incremental change cannot, and applying
                // it to an assumed empty document would write a corrupted file
                // to disk and hand the language server nonsense to analyse.
                let content = getFileContent(docUri);
                let usable = true;
                for (const change of changes) {
                    if (change.range === undefined) {
                        content = change.text;
                        continue;
                    }
                    if (content === undefined) {
                        console.warn(
                            `[LSP] Incremental change with no baseline content, skipping sync: ${docUri}`,
                        );
                        usable = false;
                        break;
                    }
                    content = applyTextEdit(content, change.range as Range, change.text);
                }
                if (usable && content !== undefined) {
                    syncFile(docUri, content);
                }
            }
        }

        // textDocument/didClose — remove temp file
        if (msg.method === "textDocument/didClose" && msg.params) {
            const params = msg.params as unknown as DidCloseTextDocumentParams;
            removeFile(params.textDocument.uri);
        }

        return msg;
    }

    function processServerMessage(msg: LspMessage): LspMessage {
        // Rewrite all file:// URIs from real → virtual
        if (msg.result !== undefined) {
            msg.result = rewriteToClient(msg.result);
        }
        if (msg.params) {
            msg.params = rewriteToClient(msg.params) as LspParams;
        }
        // Rewrite URIs in error responses (e.g. error.data may contain file paths)
        if (msg.error?.data !== undefined) {
            msg.error.data = rewriteToClient(msg.error.data);
        }
        if (msg.error?.message) {
            msg.error.message = rewriteToClient(msg.error.message) as string;
        }
        return msg;
    }

    return { processClientMessage, processServerMessage };
}
