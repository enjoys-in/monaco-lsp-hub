import * as monaco from 'monaco-editor';
import { capabilities, SelectionRangeRegistrationOptions } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';

export class LspSelectionRangeFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                selectionRange: {
                    dynamicRegistration: true,
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentSelectionRange, true, capability => {
            return monaco.languages.registerSelectionRangeProvider(
                this._connection.selectorFor(capability.documentSelector),
                new LspSelectionRangeProvider(this._connection, capability),
            );
        }));
    }
}

class LspSelectionRangeProvider implements monaco.languages.SelectionRangeProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: SelectionRangeRegistrationOptions,
    ) { }

    async provideSelectionRanges(
        model: monaco.editor.ITextModel,
        positions: monaco.Position[],
        token: monaco.CancellationToken
    ): Promise<monaco.languages.SelectionRange[][] | null> {
        const translated = this._client.bridge.translate(model, positions[0]);

        const result = await lspRequest(token, () => this._client.server.textDocumentSelectionRange({
            textDocument: translated.textDocument,
            positions: positions.map(pos => this._client.bridge.translate(model, pos).position),
        }));

        if (!result) {
            return null;
        }

        return result.map(selRange => this.convertSelectionRange(selRange, translated.textDocument));
    }

    private convertSelectionRange(
        range: any,
        textDocument: { uri: string }
    ): monaco.languages.SelectionRange[] {
        const result: monaco.languages.SelectionRange[] = [];
        let current = range;

        while (current) {
            result.push({
                range: this._client.bridge.toMonacoRange(current.range),
            });
            current = current.parent;
        }

        return result;
    }
}
