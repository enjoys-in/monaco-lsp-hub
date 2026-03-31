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
import { api, type ShowMessageParams, type LogMessageParams, type ShowMessageRequestParams, type MessageActionItem, type ApplyWorkspaceEditParams, type ConfigurationParams, type ProgressParams, type WorkDoneProgressCreateParams, type WorkDoneProgressBegin, type WorkDoneProgressReport, type WorkDoneProgressEnd } from "./types";
import { LspConnection } from "./LspConnection";
import { LspCapabilitiesRegistry } from './LspCapabilitiesRegistry';
import { TextDocumentSynchronizer } from "./TextDocumentSynchronizer";
import { DisposableStore, IDisposable } from "./utils";

export interface LspClientCallbacks {
    onShowMessage?: (params: ShowMessageParams) => void;
    onLogMessage?: (params: LogMessageParams) => void;
    onShowMessageRequest?: (params: ShowMessageRequestParams) => Promise<MessageActionItem | null>;
    onProgress?: (token: string | number, value: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd) => void;
}

export class MonacoLspClient {
    private _connection: LspConnection;
    private readonly _capabilitiesRegistry: LspCapabilitiesRegistry;
    private readonly _bridge: TextDocumentSynchronizer;
    private _progressTokens = new Set<string | number>();

    private _initPromise: Promise<void>;

    constructor(transport: IMessageTransport, callbacks: LspClientCallbacks = {}) {
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

        this._capabilitiesRegistry = new LspCapabilitiesRegistry(c);
        this._bridge = new TextDocumentSynchronizer(s.server, this._capabilitiesRegistry);

        this._connection = new LspConnection(s.server, this._bridge, this._capabilitiesRegistry, c);
        this.createFeatures();

        this._initPromise = this._init();
    }

    private async _init() {
        const result = await this._connection.server.initialize({
            processId: null,
            capabilities: this._capabilitiesRegistry.getClientCapabilities(),
            rootUri: null,
        });

        this._connection.server.initialized({});
        this._capabilitiesRegistry.setServerCapabilities(result.capabilities);
    }

    private _applyWorkspaceEdit(params: ApplyWorkspaceEditParams): { applied: boolean; failureReason?: string } {
        try {
            const edit = params.edit;
            if (edit.changes) {
                for (const [uri, edits] of Object.entries(edit.changes)) {
                    const monacoUri = monaco.Uri.parse(uri);
                    const model = monaco.editor.getModel(monacoUri);
                    if (!model) continue;
                    const monacoEdits = edits.map(e => ({
                        range: new monaco.Range(
                            e.range.start.line + 1, e.range.start.character + 1,
                            e.range.end.line + 1, e.range.end.character + 1,
                        ),
                        text: e.newText,
                    }));
                    model.pushEditOperations([], monacoEdits, () => null);
                }
            }
            if (edit.documentChanges) {
                for (const change of edit.documentChanges) {
                    if ('textDocument' in change) {
                        const monacoUri = monaco.Uri.parse(change.textDocument.uri);
                        const model = monaco.editor.getModel(monacoUri);
                        if (!model) continue;
                        const monacoEdits = change.edits.map(e => ({
                            range: new monaco.Range(
                                e.range.start.line + 1, e.range.start.character + 1,
                                e.range.end.line + 1, e.range.end.character + 1,
                            ),
                            text: e.newText,
                        }));
                        model.pushEditOperations([], monacoEdits, () => null);
                    }
                }
            }
            return { applied: true };
        } catch (err) {
            return { applied: false, failureReason: String(err) };
        }
    }

    protected createFeatures(): IDisposable {
        const store = new DisposableStore();

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
