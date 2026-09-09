import * as monaco from 'monaco-editor';
import { capabilities, RenameRegistrationOptions } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';
import { toMonacoWorkspaceEdit } from './common';

export class LspRenameFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                rename: {
                    dynamicRegistration: true,
                    prepareSupport: true,
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentRename, true, capability => {
            return monaco.languages.registerRenameProvider(
                this._connection.selectorFor(capability.documentSelector),
                new LspRenameProvider(this._connection, capability),
            );
        }));
    }
}

class LspRenameProvider implements monaco.languages.RenameProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: RenameRegistrationOptions,
    ) { }

    async provideRenameEdits(
        model: monaco.editor.ITextModel,
        position: monaco.Position,
        newName: string,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.WorkspaceEdit | null> {
        const translated = this._client.bridge.translate(model, position);

        const result = await lspRequest(token, () => this._client.server.textDocumentRename({
            textDocument: translated.textDocument,
            position: translated.position,
            newName,
        }));

        if (!result) {
            return null;
        }

        return toMonacoWorkspaceEdit(result, this._client, 'rename');
    }

    /**
     * Where the rename box opens and what it is pre-filled with.
     *
     * Returning null aborts the rename outright, so a server without
     * `prepareProvider` — which is most of them — has to fall back to the word
     * under the cursor rather than being treated as a refusal. Same for
     * `defaultBehavior: true`, which means exactly "use the word here".
     */
    async resolveRenameLocation(
        model: monaco.editor.ITextModel,
        position: monaco.Position,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.RenameLocation | null> {
        if (!this._capabilities.prepareProvider) {
            return wordAt(model, position);
        }

        const translated = this._client.bridge.translate(model, position);

        const result = await lspRequest(token, () => this._client.server.textDocumentPrepareRename({
            textDocument: translated.textDocument,
            position: translated.position,
        }));

        if (!result) {
            return token.isCancellationRequested ? null : wordAt(model, position);
        }

        if ('placeholder' in result && 'range' in result) {
            return {
                range: this._client.bridge.toMonacoRange(result.range),
                text: result.placeholder,
            };
        }

        if ('defaultBehavior' in result) {
            return result.defaultBehavior ? wordAt(model, position) : null;
        }

        if ('start' in result && 'end' in result) {
            const range = this._client.bridge.toMonacoRange(result);
            return {
                range,
                text: model.getValueInRange(range),
            };
        }

        return wordAt(model, position);
    }
}

function wordAt(
    model: monaco.editor.ITextModel,
    position: monaco.Position
): monaco.languages.RenameLocation | null {
    const word = model.getWordAtPosition(position);
    if (!word) {
        return null;
    }
    return {
        range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
        ),
        text: word.word,
    };
}
