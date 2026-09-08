import * as monaco from 'monaco-editor';
import { capabilities, DocumentLinkRegistrationOptions } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';
import { toMonacoLanguageSelector } from './common';

export class LspDocumentLinkFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                documentLink: {
                    dynamicRegistration: true,
                    tooltipSupport: true,
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentDocumentLink, true, capability => {
            return monaco.languages.registerLinkProvider(
                toMonacoLanguageSelector(capability.documentSelector),
                new LspDocumentLinkProvider(this._connection, capability),
            );
        }));
    }
}

class LspDocumentLinkProvider implements monaco.languages.LinkProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: DocumentLinkRegistrationOptions,
    ) { }

    async provideLinks(
        model: monaco.editor.ITextModel,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.ILinksList | null> {
        const translated = this._client.bridge.translate(model, new monaco.Position(1, 1));

        const result = await lspRequest(token, () => this._client.server.textDocumentDocumentLink({
            textDocument: translated.textDocument,
        }));

        if (!result) {
            return null;
        }

        return {
            links: result.map(link => ({
                range: this._client.bridge.toMonacoRange(link.range),
                url: link.target,
                tooltip: link.tooltip,
            })),
        };
    }

    async resolveLink(
        link: monaco.languages.ILink,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.ILink> {
        if (!this._capabilities.resolveProvider) {
            return link;
        }

        const result = await lspRequest(token, () => this._client.server.documentLinkResolve({
            range: {
                start: { line: link.range.startLineNumber - 1, character: link.range.startColumn - 1 },
                end: { line: link.range.endLineNumber - 1, character: link.range.endColumn - 1 },
            },
            target: link.url?.toString(),
            tooltip: link.tooltip,
        }));

        if (!result) {
            return link;
        }

        return {
            range: link.range,
            url: result.target ?? link.url,
            tooltip: result.tooltip ?? link.tooltip,
        };
    }
}
