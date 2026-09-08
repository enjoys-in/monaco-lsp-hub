import * as monaco from 'monaco-editor';
import { capabilities, SemanticTokensRegistrationOptions } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';
import { toMonacoLanguageSelector } from './common';

export class LspRangeSemanticTokensFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentSemanticTokensFull, true, capability => {
            // Only register range provider if server supports it
            if (!capability.range) {
                return { dispose() { } };
            }

            return monaco.languages.registerDocumentRangeSemanticTokensProvider(
                toMonacoLanguageSelector(capability.documentSelector),
                new LspRangeSemanticTokensProvider(this._connection, capability),
            );
        }));
    }
}

class LspRangeSemanticTokensProvider implements monaco.languages.DocumentRangeSemanticTokensProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: SemanticTokensRegistrationOptions,
    ) { }

    getLegend(): monaco.languages.SemanticTokensLegend {
        return {
            tokenTypes: this._capabilities.legend.tokenTypes,
            tokenModifiers: this._capabilities.legend.tokenModifiers,
        };
    }

    async provideDocumentRangeSemanticTokens(
        model: monaco.editor.ITextModel,
        range: monaco.Range,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.SemanticTokens | null> {
        const translated = this._client.bridge.translate(model, model.getPositionAt(0));

        const result = await lspRequest(token, () => this._client.server.textDocumentSemanticTokensRange({
            textDocument: translated.textDocument,
            range: {
                start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
            },
        }));

        if (!result) {
            return null;
        }

        return {
            resultId: result.resultId,
            data: new Uint32Array(result.data),
        };
    }
}
