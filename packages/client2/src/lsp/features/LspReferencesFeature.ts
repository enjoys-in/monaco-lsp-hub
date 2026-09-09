import * as monaco from 'monaco-editor';
import { capabilities, ReferenceRegistrationOptions } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';

export class LspReferencesFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                references: {
                    dynamicRegistration: true,
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentReferences, true, capability => {
            return monaco.languages.registerReferenceProvider(
                this._connection.selectorFor(capability.documentSelector),
                new LspReferenceProvider(this._connection, capability),
            );
        }));
    }
}

class LspReferenceProvider implements monaco.languages.ReferenceProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: ReferenceRegistrationOptions,
    ) { }

    async provideReferences(
        model: monaco.editor.ITextModel,
        position: monaco.Position,
        context: monaco.languages.ReferenceContext,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.Location[] | null> {
        const translated = this._client.bridge.translate(model, position);

        const result = await lspRequest(token, () => this._client.server.textDocumentReferences({
            textDocument: translated.textDocument,
            position: translated.position,
            context: {
                includeDeclaration: context.includeDeclaration,
            },
        }));

        if (!result) {
            return null;
        }

        // References legitimately point at files the editor has never opened,
        // so resolve the URI without requiring a model.
        return result.map(loc => ({
            uri: this._client.bridge.resolveUri(loc.uri),
            range: this._client.bridge.toMonacoRange(loc.range),
        }));
    }
}
