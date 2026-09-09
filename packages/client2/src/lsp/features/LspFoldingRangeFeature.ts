import * as monaco from 'monaco-editor';
import { capabilities, FoldingRangeRegistrationOptions, FoldingRangeKind } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';
import { toMonacoFoldingRangeKind } from './common';

export class LspFoldingRangeFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                foldingRange: {
                    dynamicRegistration: true,
                    rangeLimit: 5000,
                    lineFoldingOnly: false,
                    foldingRangeKind: {
                        valueSet: [FoldingRangeKind.Comment, FoldingRangeKind.Imports, FoldingRangeKind.Region],
                    },
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentFoldingRange, true, capability => {
            return monaco.languages.registerFoldingRangeProvider(
                this._connection.selectorFor(capability.documentSelector),
                new LspFoldingRangeProvider(this._connection, capability),
            );
        }));
    }
}

class LspFoldingRangeProvider implements monaco.languages.FoldingRangeProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: FoldingRangeRegistrationOptions,
    ) { }

    async provideFoldingRanges(
        model: monaco.editor.ITextModel,
        context: monaco.languages.FoldingContext,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.FoldingRange[] | null> {
        const translated = this._client.bridge.translate(model, new monaco.Position(1, 1));

        const result = await lspRequest(token, () => this._client.server.textDocumentFoldingRange({
            textDocument: translated.textDocument,
        }));

        if (!result) {
            return null;
        }

        return result.map(range => ({
            start: range.startLine + 1,
            end: range.endLine + 1,
            kind: toMonacoFoldingRangeKind(range.kind),
        }));
    }
}
