import * as monaco from 'monaco-editor';
import { capabilities, DefinitionRegistrationOptions } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';
import { toMonacoLocation } from "./common";

export class LspDefinitionFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                definition: {
                    dynamicRegistration: true,
                    linkSupport: true,
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentDefinition, true, capability => {
            return monaco.languages.registerDefinitionProvider(
                this._connection.selectorFor(capability.documentSelector),
                new LspDefinitionProvider(this._connection, capability),
            );
        }));
    }
}

class LspDefinitionProvider implements monaco.languages.DefinitionProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: DefinitionRegistrationOptions,
    ) { }

    async provideDefinition(
        model: monaco.editor.ITextModel,
        position: monaco.Position,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.Definition | monaco.languages.LocationLink[] | null> {
        const translated = this._client.bridge.translate(model, position);

        const result = await lspRequest(token, () => this._client.server.textDocumentDefinition({
            textDocument: translated.textDocument,
            position: translated.position,
        }));

        if (!result) {
            return null;
        }

        if (Array.isArray(result)) {
            return result.map(loc => toMonacoLocation(loc, this._client, translated.textDocument.uri));
        }

        return toMonacoLocation(result, this._client, translated.textDocument.uri);
    }
}
