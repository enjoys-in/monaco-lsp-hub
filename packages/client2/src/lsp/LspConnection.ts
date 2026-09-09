import * as monaco from 'monaco-editor';
import { TypedChannel } from '@hediet/json-rpc';
import { api, DocumentSelector } from './types';
import { ITextModelBridge } from './ITextModelBridge';
import { LspCapabilitiesRegistry } from './LspCapabilitiesRegistry';
import { LspDiagnosticStore } from './LspDiagnosticStore';
import { toMonacoLanguageSelector } from './features/common';

/**
 * The single document a connection serves.
 *
 * A hub session is one language server for one file: the server's workspace
 * holds that file and nothing else, so answering requests about any other model
 * on the page can only produce errors or empty results. Declaring the scope is
 * what lets the connection stay inside it.
 */
export interface LspDocumentScope {
    /** URI of the document, in whatever form the host uses */
    uri: string;
    /** Monaco language id of the document */
    languageId: string;
}

/** Scope with its URI normalized to Monaco's canonical form, for comparison */
export interface ResolvedScope extends LspDocumentScope {
    readonly resolvedUri: monaco.Uri;
    readonly scheme: string;
}

export function resolveScope(scope: LspDocumentScope): ResolvedScope {
    const resolvedUri = monaco.Uri.parse(scope.uri);
    return { ...scope, resolvedUri, scheme: resolvedUri.scheme };
}

export class LspConnection {
    constructor(
        public readonly server: typeof api.TServerInterface,
        public readonly bridge: ITextModelBridge,
        public readonly capabilities: LspCapabilitiesRegistry,
        public readonly connection: TypedChannel,
        /** Originals for the diagnostics currently shown, shared across features */
        public readonly diagnostics: LspDiagnosticStore = new LspDiagnosticStore(),
        /** The one document this connection serves, when it is scoped */
        public readonly scope?: ResolvedScope,
    ) { }

    /**
     * Monaco selector for a feature's providers.
     *
     * Static server capabilities carry no `documentSelector` — `hoverProvider:
     * true` is the norm — and `toMonacoLanguageSelector` turns that absence into
     * `'*'`. On a scoped connection that meant every feature registered for
     * *every* language, so a Python session answered hovers and completions for
     * JSON and TypeScript models too and competed with Monaco's own built-in
     * workers. The scope is narrower than anything the server could ask for, so
     * it wins outright.
     */
    selectorFor(documentSelector: DocumentSelector | null): monaco.languages.LanguageSelector {
        if (!this.scope) {
            return toMonacoLanguageSelector(documentSelector);
        }
        return { language: this.scope.languageId, scheme: this.scope.scheme };
    }

    /** Whether a model is the one this connection serves */
    isInScope(model: monaco.editor.ITextModel): boolean {
        if (!this.scope) {
            // Unscoped connections still never sync anything the hub could not
            // put on disk: an `inmemory://` model has no path to write to.
            return model.uri.scheme === 'file';
        }
        return model.uri.toString() === this.scope.resolvedUri.toString();
    }
}
