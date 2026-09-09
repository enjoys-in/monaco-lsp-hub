import * as monaco from "monaco-editor";
import { IMessageTransport, TypedChannel } from "@hediet/json-rpc";
import { LspCompletionFeature } from "./features/LspCompletionFeature";
import { LspHoverFeature } from "./features/LspHoverFeature";
import { LspSignatureHelpFeature } from "./features/LspSignatureHelpFeature";
import { LspDefinitionFeature } from "./features/LspDefinitionFeature";
import { LspDeclarationFeature } from "./features/LspDeclarationFeature";
import { LspTypeDefinitionFeature } from "./features/LspTypeDefinitionFeature";
import { LspImplementationFeature } from "./features/LspImplementationFeature";
import { LspReferencesFeature } from "./features/LspReferencesFeature";
import { LspDocumentHighlightFeature } from "./features/LspDocumentHighlightFeature";
import { LspDocumentSymbolFeature } from "./features/LspDocumentSymbolFeature";
import { LspRenameFeature } from "./features/LspRenameFeature";
import { LspCodeActionFeature } from "./features/LspCodeActionFeature";
import { LspCodeLensFeature } from "./features/LspCodeLensFeature";
import { LspDocumentLinkFeature } from "./features/LspDocumentLinkFeature";
import { LspFormattingFeature } from "./features/LspFormattingFeature";
import { LspRangeFormattingFeature } from "./features/LspRangeFormattingFeature";
import { LspOnTypeFormattingFeature } from "./features/LspOnTypeFormattingFeature";
import { LspFoldingRangeFeature } from "./features/LspFoldingRangeFeature";
import { LspSelectionRangeFeature } from "./features/LspSelectionRangeFeature";
import { LspInlayHintsFeature } from "./features/LspInlayHintsFeature";
import { LspSemanticTokensFeature } from "./features/LspSemanticTokensFeature";
import { LspDiagnosticsFeature } from "./features/LspDiagnosticsFeature";
import { LspDocumentColorFeature } from "./features/LspDocumentColorFeature";
import { LspLinkedEditingRangeFeature } from "./features/LspLinkedEditingRangeFeature";
import { LspRangeSemanticTokensFeature } from "./features/LspRangeSemanticTokensFeature";
import { LspExecuteCommandFeature } from "./features/LspExecuteCommandFeature";
import { api, type ShowMessageParams, type LogMessageParams, type ShowMessageRequestParams, type MessageActionItem, type ApplyWorkspaceEditParams, type ConfigurationParams, type ProgressParams, type WorkDoneProgressCreateParams, type WorkDoneProgressBegin, type WorkDoneProgressReport, type WorkDoneProgressEnd, type TextEdit, type CreateFile, type RenameFile, type DeleteFile } from "./types";
import { LspConnection, resolveScope, type LspDocumentScope, type ResolvedScope } from "./LspConnection";
import { LspCapabilitiesRegistry } from './LspCapabilitiesRegistry';
import { LspDiagnosticStore } from './LspDiagnosticStore';
import { TextDocumentSynchronizer } from "./TextDocumentSynchronizer";
import { DisposableStore, IDisposable } from "./utils";

/**
 * Restricts a connection to the single document it was opened for.
 *
 * A hub session is one language server holding one file, so a connection that
 * answers for every model on the page can only produce errors, empty results,
 * and duplicate completions alongside Monaco's own built-in workers. Passing a
 * scope is strongly recommended; omitting it keeps the old page-wide behaviour,
 * narrowed to `file:` models.
 */
export type { LspDocumentScope };

export interface LspClientOptions extends LspClientCallbacks {
    scope?: LspDocumentScope;
}

export interface LspClientCallbacks {
    onShowMessage?: (params: ShowMessageParams) => void;
    onLogMessage?: (params: LogMessageParams) => void;
    onShowMessageRequest?: (params: ShowMessageRequestParams) => Promise<MessageActionItem | null>;
    onProgress?: (token: string | number, value: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd) => void;
    /** Called when the initialize handshake fails */
    onInitializeError?: (error: unknown) => void;
}

export class MonacoLspClient implements IDisposable {
    private readonly _connection: LspConnection;
    private readonly _capabilitiesRegistry: LspCapabilitiesRegistry;
    private readonly _bridge: TextDocumentSynchronizer;
    private readonly _diagnostics: LspDiagnosticStore;
    private readonly _store = new DisposableStore();
    private readonly _progressTokens = new Set<string | number>();
    private _executeCommandFeature?: LspExecuteCommandFeature;
    private _disposed = false;

    private readonly _initPromise: Promise<void>;

    private readonly _scope?: ResolvedScope;

    constructor(transport: IMessageTransport, options: LspClientOptions = {}) {
        const callbacks: LspClientCallbacks = options;
        this._scope = options.scope ? resolveScope(options.scope) : undefined;

        const c = TypedChannel.fromTransport(transport);

        // Client-side handlers for server→client notifications/requests
        // Keys must match the property names in api.client (e.g. windowShowMessage)
        const clientHandler: Record<string, Function> = {};

        if (callbacks.onShowMessage) {
            clientHandler.windowShowMessage = callbacks.onShowMessage;
        }

        if (callbacks.onLogMessage) {
            clientHandler.windowLogMessage = callbacks.onLogMessage;
        }

        if (callbacks.onShowMessageRequest) {
            clientHandler.windowShowMessageRequest = callbacks.onShowMessageRequest;
        }

        // workspace/applyEdit — server asks client to apply a WorkspaceEdit
        clientHandler.workspaceApplyEdit = (params: ApplyWorkspaceEditParams) => {
            return this._applyWorkspaceEdit(params);
        };

        // workspace/configuration — server pulls config settings
        clientHandler.workspaceConfiguration = (params: ConfigurationParams) => {
            return params.items.map(() => ({}));
        };

        // window/workDoneProgress/create — server registers a progress token
        clientHandler.windowWorkDoneProgressCreate = (params: WorkDoneProgressCreateParams) => {
            this._progressTokens.add(params.token);
            return null;
        };

        // $/progress — server reports progress for a registered token
        clientHandler.progress = (params: ProgressParams) => {
            const value = params.value as unknown as WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd;
            if (callbacks.onProgress) {
                callbacks.onProgress(params.token, value);
            }
            if (value.kind === 'end') {
                this._progressTokens.delete(params.token);
            }
        };

        const s = api.getServer(c, clientHandler);
        c.startListen();

        this._capabilitiesRegistry = this._store.add(new LspCapabilitiesRegistry(c));

        // Workspace-level capabilities
        this._store.add(this._capabilitiesRegistry.addStaticClientCapabilities({
            workspace: {
                applyEdit: true,
                workspaceEdit: {
                    documentChanges: true,
                },
            },
        }));

        this._bridge = this._store.add(new TextDocumentSynchronizer(s.server, this._capabilitiesRegistry, this._scope));
        this._diagnostics = new LspDiagnosticStore();

        this._connection = new LspConnection(s.server, this._bridge, this._capabilitiesRegistry, c, this._diagnostics, this._scope);
        this._store.add(this.createFeatures());

        this._initPromise = this._init().catch((err) => {
            console.error('[LSP] initialize failed:', err);
            callbacks.onInitializeError?.(err);
            throw err;
        });
        // The promise is surfaced through `ready`; swallow the duplicate
        // rejection here so a failed handshake isn't an unhandled rejection.
        void this._initPromise.catch(() => { });
    }

    /**
     * Resolves once `initialize`/`initialized` have completed and the server's
     * capabilities are registered. Requests issued before this are answered
     * with an error by a spec-compliant server, so callers that report
     * "connected" should await it.
     */
    public get ready(): Promise<void> {
        return this._initPromise;
    }

    public get connection(): LspConnection {
        return this._connection;
    }

    /** Run a command on the server (the same path code lenses use). */
    public executeCommand(command: string, args: unknown[] = []): Promise<unknown> {
        if (!this._executeCommandFeature) {
            return Promise.resolve(undefined);
        }
        return this._executeCommandFeature.executeCommand(command, args);
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        // Disposes every feature, which unregisters its Monaco providers, plus
        // the synchronizer (closing open documents) and the capability
        // registry. Without this each connection left a full set of providers
        // behind, pointed at a dead socket.
        this._store.dispose();
        this._diagnostics.clear();
        this._progressTokens.clear();
    }

    private async _init() {
        const result = await this._connection.server.initialize({
            processId: null,
            capabilities: this._capabilitiesRegistry.getClientCapabilities(),
            rootUri: null,
        });

        if (this._disposed) {
            return;
        }

        this._connection.server.initialized({});
        this._capabilitiesRegistry.setServerCapabilities(result.capabilities);
    }

    private _applyWorkspaceEdit(params: ApplyWorkspaceEditParams): { applied: boolean; failureReason?: string } {
        try {
            const edit = params.edit;

            if (edit.changes) {
                for (const [uri, edits] of Object.entries(edit.changes)) {
                    this._applyTextEdits(uri, edits);
                }
            }

            if (edit.documentChanges) {
                // documentChanges are ordered and may interleave file
                // operations with text edits, so they're applied in sequence
                // rather than filtered down to text edits only.
                for (const change of edit.documentChanges) {
                    if ('textDocument' in change) {
                        this._applyTextEdits(change.textDocument.uri, change.edits);
                    } else if ('kind' in change) {
                        const failure = this._applyFileOperation(change);
                        if (failure) {
                            return { applied: false, failureReason: failure };
                        }
                    }
                }
            }

            return { applied: true };
        } catch (err) {
            return { applied: false, failureReason: String(err) };
        }
    }

    private _applyTextEdits(uri: string, edits: readonly TextEdit[]): void {
        const model = monaco.editor.getModel(monaco.Uri.parse(uri));
        if (!model || edits.length === 0) {
            return;
        }
        const monacoEdits = edits.map(e => ({
            range: new monaco.Range(
                e.range.start.line + 1, e.range.start.character + 1,
                e.range.end.line + 1, e.range.end.character + 1,
            ),
            text: e.newText,
            forceMoveMarkers: true,
        }));
        model.pushEditOperations([], monacoEdits, () => null);
    }

    /**
     * Create / rename / delete, applied against Monaco's model registry.
     *
     * These used to be skipped while still reporting `applied: true`, so a
     * server that asked for a file to be created believed it had been.
     */
    /**
     * Create / rename / delete, applied against Monaco's model registry.
     *
     * These used to be skipped while still reporting `applied: true`, so a
     * server that asked for a file to be created believed it had been. Returns
     * a failure reason, or undefined on success.
     */
    private _applyFileOperation(change: CreateFile | RenameFile | DeleteFile): string | undefined {
        try {
            switch (change.kind) {
                case 'create':
                    return this._createFile(change);
                case 'rename':
                    return this._renameFile(change);
                case 'delete':
                    return this._deleteFile(change);
                default:
                    return `Unsupported file operation: ${(change as { kind: string }).kind}`;
            }
        } catch (err) {
            return String(err);
        }
    }

    private _createFile(change: CreateFile): string | undefined {
        const options = change.options ?? {};
        const uri = monaco.Uri.parse(change.uri);
        const existing = monaco.editor.getModel(uri);

        if (existing) {
            if (options.ignoreIfExists) return undefined;
            if (!options.overwrite) return `File already exists: ${uri.toString()}`;
            existing.setValue('');
            return undefined;
        }

        monaco.editor.createModel('', undefined, uri);
        return undefined;
    }

    private _renameFile(change: RenameFile): string | undefined {
        const options = change.options ?? {};
        const oldUri = monaco.Uri.parse(change.oldUri);
        const newUri = monaco.Uri.parse(change.newUri);

        const source = monaco.editor.getModel(oldUri);
        if (!source) {
            // RenameFileOptions has no ignoreIfNotExists in the protocol, so a
            // missing source is simply a failure.
            return `File not found: ${oldUri.toString()}`;
        }

        const existing = monaco.editor.getModel(newUri);
        if (existing && !options.overwrite) {
            return options.ignoreIfExists ? undefined : `File already exists: ${newUri.toString()}`;
        }

        // A Monaco model's URI is immutable, so a rename is a new model holding
        // the old content plus disposal of the original (which sends didClose).
        const content = source.getValue();
        const languageId = source.getLanguageId();
        existing?.dispose();
        monaco.editor.createModel(content, languageId, newUri);
        source.dispose();
        return undefined;
    }

    private _deleteFile(change: DeleteFile): string | undefined {
        const options = change.options ?? {};
        const uri = monaco.Uri.parse(change.uri);
        const model = monaco.editor.getModel(uri);

        if (!model) {
            return options.ignoreIfNotExists ? undefined : `File not found: ${uri.toString()}`;
        }

        model.dispose();
        return undefined;
    }

    protected createFeatures(): IDisposable {
        const store = new DisposableStore();

        this._executeCommandFeature = store.add(new LspExecuteCommandFeature(this._connection));

        store.add(new LspCompletionFeature(this._connection));
        store.add(new LspHoverFeature(this._connection));
        store.add(new LspSignatureHelpFeature(this._connection));
        store.add(new LspDefinitionFeature(this._connection));
        store.add(new LspDeclarationFeature(this._connection));
        store.add(new LspTypeDefinitionFeature(this._connection));
        store.add(new LspImplementationFeature(this._connection));
        store.add(new LspReferencesFeature(this._connection));
        store.add(new LspDocumentHighlightFeature(this._connection));
        store.add(new LspDocumentSymbolFeature(this._connection));
        store.add(new LspRenameFeature(this._connection));
        store.add(new LspCodeActionFeature(this._connection));
        store.add(new LspCodeLensFeature(this._connection));
        store.add(new LspDocumentLinkFeature(this._connection));
        store.add(new LspFormattingFeature(this._connection));
        store.add(new LspRangeFormattingFeature(this._connection));
        store.add(new LspOnTypeFormattingFeature(this._connection));
        store.add(new LspFoldingRangeFeature(this._connection));
        store.add(new LspSelectionRangeFeature(this._connection));
        store.add(new LspInlayHintsFeature(this._connection));
        store.add(new LspSemanticTokensFeature(this._connection));
        store.add(new LspDiagnosticsFeature(this._connection));
        store.add(new LspDocumentColorFeature(this._connection));
        store.add(new LspLinkedEditingRangeFeature(this._connection));
        store.add(new LspRangeSemanticTokensFeature(this._connection));

        return store;
    }
}
