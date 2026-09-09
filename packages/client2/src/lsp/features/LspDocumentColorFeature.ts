import * as monaco from 'monaco-editor';
import { capabilities, DocumentColorRegistrationOptions, Color } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';

export class LspDocumentColorFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                colorProvider: {
                    dynamicRegistration: true,
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentDocumentColor, true, capability => {
            return monaco.languages.registerColorProvider(
                this._connection.selectorFor(capability.documentSelector),
                new LspDocumentColorProvider(this._connection, capability),
            );
        }));
    }
}

class LspDocumentColorProvider implements monaco.languages.DocumentColorProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: DocumentColorRegistrationOptions,
    ) { }

    async provideDocumentColors(
        model: monaco.editor.ITextModel,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.IColorInformation[] | null> {
        const translated = this._client.bridge.translate(model, new monaco.Position(1, 1));

        const result = await lspRequest(token, () => this._client.server.textDocumentDocumentColor({
            textDocument: translated.textDocument,
        }));

        if (!result || result.length === 0) {
            return null;
        }

        return result.map(colorInfo => ({
            range: this._client.bridge.toMonacoRange(colorInfo.range),
            color: colorInfo.color,
        }));
    }

    async provideColorPresentations(
        model: monaco.editor.ITextModel,
        colorInfo: monaco.languages.IColorInformation,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.IColorPresentation[] | null> {
        const translated = this._client.bridge.translate(model, new monaco.Position(1, 1));

        const result = await lspRequest(token, () => this._client.server.textDocumentColorPresentation({
            textDocument: translated.textDocument,
            color: colorInfo.color as Color,
            range: {
                start: { line: colorInfo.range.startLineNumber - 1, character: colorInfo.range.startColumn - 1 },
                end: { line: colorInfo.range.endLineNumber - 1, character: colorInfo.range.endColumn - 1 },
            },
        }));

        if (!result || result.length === 0) {
            return null;
        }

        return result.map(presentation => ({
            label: presentation.label,
            textEdit: presentation.textEdit ? {
                range: this._client.bridge.toMonacoRange(presentation.textEdit.range),
                text: presentation.textEdit.newText,
            } : undefined,
            additionalTextEdits: presentation.additionalTextEdits?.map(edit => ({
                range: this._client.bridge.toMonacoRange(edit.range),
                text: edit.newText,
            })),
        }));
    }
}
