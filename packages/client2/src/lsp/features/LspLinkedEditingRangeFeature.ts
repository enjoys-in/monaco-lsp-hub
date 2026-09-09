import * as monaco from 'monaco-editor';
import { capabilities, LinkedEditingRangeRegistrationOptions } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';

export class LspLinkedEditingRangeFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                linkedEditingRange: {
                    dynamicRegistration: true,
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentLinkedEditingRange, true, capability => {
            return monaco.languages.registerLinkedEditingRangeProvider(
                this._connection.selectorFor(capability.documentSelector),
                new LspLinkedEditingRangeProvider(this._connection, capability),
            );
        }));
    }
}

class LspLinkedEditingRangeProvider implements monaco.languages.LinkedEditingRangeProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: LinkedEditingRangeRegistrationOptions,
    ) { }

    async provideLinkedEditingRanges(
        model: monaco.editor.ITextModel,
        position: monaco.Position,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.LinkedEditingRanges | null> {
        const translated = this._client.bridge.translate(model, position);

        const result = await lspRequest(token, () => this._client.server.textDocumentLinkedEditingRange({
            textDocument: translated.textDocument,
            position: translated.position,
        }));

        if (!result) {
            return null;
        }

        return {
            ranges: result.ranges.map(range =>
                this._client.bridge.toMonacoRange(range)
            ),
            wordPattern: result.wordPattern ? new RegExp(result.wordPattern) : undefined,
        };
    }
}
