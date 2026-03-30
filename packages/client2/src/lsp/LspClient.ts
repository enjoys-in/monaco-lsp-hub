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
import { api } from "./types";
import { LspConnection } from "./LspConnection";
import { LspCapabilitiesRegistry } from './LspCapabilitiesRegistry';
import { TextDocumentSynchronizer } from "./TextDocumentSynchronizer";
import { DisposableStore, IDisposable } from "./utils";

export class MonacoLspClient {
    private _connection: LspConnection;
    private readonly _capabilitiesRegistry: LspCapabilitiesRegistry;
    private readonly _bridge: TextDocumentSynchronizer;

    private _initPromise: Promise<void>;

    constructor(transport: IMessageTransport) {
        const c = TypedChannel.fromTransport(transport);
        const s = api.getServer(c, {});
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

        return store;
    }
}
