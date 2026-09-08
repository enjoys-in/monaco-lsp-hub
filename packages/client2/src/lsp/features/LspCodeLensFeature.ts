import * as monaco from 'monaco-editor';
import { capabilities, CodeLensRegistrationOptions, CodeLens } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';
import { toMonacoLanguageSelector } from './common';
import { assertTargetTextModel } from '../ITextModelBridge';
import { toMonacoCommand } from './common';

export class LspCodeLensFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                codeLens: {
                    dynamicRegistration: true,
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentCodeLens, true, capability => {
            return monaco.languages.registerCodeLensProvider(
                toMonacoLanguageSelector(capability.documentSelector),
                new LspCodeLensProvider(this._connection, capability),
            );
        }));
    }
}

interface ExtendedCodeLens extends monaco.languages.CodeLens {
    _lspCodeLens?: CodeLens;
}

class LspCodeLensProvider implements monaco.languages.CodeLensProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: CodeLensRegistrationOptions,
    ) { }

    async provideCodeLenses(
        model: monaco.editor.ITextModel,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.CodeLensList | null> {
        const translated = this._client.bridge.translate(model, new monaco.Position(1, 1));

        const result = await lspRequest(token, () => this._client.server.textDocumentCodeLens({
            textDocument: translated.textDocument,
        }));

        if (!result) {
            return null;
        }

        return {
            lenses: result.map(lens => {
                const monacoLens: ExtendedCodeLens = {
                    range: assertTargetTextModel(this._client.bridge.translateBackRange(translated.textDocument, lens.range), model).range,
                    command: toMonacoCommand(lens.command),
                    _lspCodeLens: lens,
                };
                return monacoLens;
            }),
            dispose: () => { },
        };
    }

    async resolveCodeLens(
        model: monaco.editor.ITextModel,
        codeLens: ExtendedCodeLens,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.CodeLens> {
        const lspCodeLens = codeLens._lspCodeLens;
        if (!this._capabilities.resolveProvider || !lspCodeLens) {
            return codeLens;
        }

        const resolved = await lspRequest(token, () => this._client.server.codeLensResolve(lspCodeLens));

        if (!resolved) {
            return codeLens;
        }

        if (resolved.command) {
            codeLens.command = toMonacoCommand(resolved.command);
        }

        return codeLens;
    }
}
