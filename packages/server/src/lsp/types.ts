// LSP JSON-RPC message types — strongly typed representations of
// the messages flowing between client and server.

export interface LspResponseError {
    code: number;
    message: string;
    data?: unknown;
}

/**
 * JSON-RPC 2.0 message — single interface with all optional fields.
 * Requests have `id` + `method`, notifications have `method` but no `id`,
 * responses have `id` + (`result` | `error`).
 */
export interface LspMessage {
    jsonrpc: string;
    id?: number | string | null;
    method?: string;
    params?: LspParams;
    result?: unknown;
    error?: LspResponseError;
}

// ── Params types for specific methods ────────────────────────────────────────

export interface TextDocumentIdentifier {
    uri: string;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
    version: number;
}

export interface TextDocumentItem {
    uri: string;
    languageId: string;
    version: number;
    text: string;
}

export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

export interface TextDocumentContentChangeEvent {
    range?: Range;
    text: string;
}

export interface WorkspaceFolder {
    uri: string;
    name: string;
}

export interface InitializeParams {
    processId: number | null;
    rootUri: string | null;
    rootPath?: string | null;
    workspaceFolders?: WorkspaceFolder[] | null;
    capabilities: Record<string, unknown>;
    [key: string]: unknown;
}

export interface DidOpenTextDocumentParams {
    textDocument: TextDocumentItem;
}

export interface DidChangeTextDocumentParams {
    textDocument: VersionedTextDocumentIdentifier;
    contentChanges: TextDocumentContentChangeEvent[];
}

export interface DidCloseTextDocumentParams {
    textDocument: TextDocumentIdentifier;
}

/** Generic params container — may be any of the specific param types or a generic object */
export type LspParams = Record<string, unknown>;

// ── Type guards ──────────────────────────────────────────────────────────────

export function isRequestMessage(msg: LspMessage): boolean {
    return "method" in msg && "id" in msg;
}

export function isNotificationMessage(msg: LspMessage): boolean {
    return "method" in msg && !("id" in msg);
}

export function isResponseMessage(msg: LspMessage): boolean {
    return !("method" in msg) && "id" in msg;
}
