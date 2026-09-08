import * as monaco from 'monaco-editor';
import { capabilities, CodeActionRegistrationOptions, Command, CodeAction, Diagnostic, CodeActionKind } from '../types';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';
import {
    lspCodeActionKindToMonacoCodeActionKind,
    toMonacoCodeActionKind,
    toLspCodeActionTriggerKind,
    toLspDiagnostic,
    toMonacoCommand,
    toMonacoLanguageSelector,
    toMonacoWorkspaceEdit,
} from './common';

export class LspCodeActionFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                codeAction: {
                    dynamicRegistration: true,
                    codeActionLiteralSupport: {
                        codeActionKind: {
                            valueSet: Array.from(lspCodeActionKindToMonacoCodeActionKind.keys()),
                        }
                    },
                    isPreferredSupport: true,
                    disabledSupport: true,
                    dataSupport: true,
                    resolveSupport: {
                        properties: ['edit', 'command'],
                    },
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentCodeAction, true, capability => {
            return monaco.languages.registerCodeActionProvider(
                toMonacoLanguageSelector(capability.documentSelector),
                new LspCodeActionProvider(this._connection, capability),
            );
        }));
    }
}

interface ExtendedCodeAction extends monaco.languages.CodeAction {
    _lspAction?: CodeAction;
}

class LspCodeActionProvider implements monaco.languages.CodeActionProvider {
    public readonly resolveCodeAction;

    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: CodeActionRegistrationOptions,
    ) {
        if (_capabilities.resolveProvider) {
            this.resolveCodeAction = async (codeAction: ExtendedCodeAction, token: monaco.CancellationToken): Promise<ExtendedCodeAction> => {
                if (!codeAction._lspAction) {
                    return codeAction;
                }
                const resolved = await lspRequest(token, () => this._client.server.codeActionResolve(codeAction._lspAction!));
                if (!resolved) {
                    return codeAction;
                }
                if (resolved.edit) {
                    codeAction.edit = toMonacoWorkspaceEdit(resolved.edit, this._client, 'codeAction/resolve');
                }
                if (resolved.command) {
                    codeAction.command = toMonacoCommand(resolved.command);
                }
                return codeAction;
            };
        }
    }

    async provideCodeActions(
        model: monaco.editor.ITextModel,
        range: monaco.Range,
        context: monaco.languages.CodeActionContext,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.CodeActionList | null> {
        const translated = this._client.bridge.translate(model, range.getStartPosition());
        const uri = translated.textDocument.uri;

        const result = await lspRequest(token, () => this._client.server.textDocumentCodeAction({
            textDocument: translated.textDocument,
            range: this._client.bridge.translateRange(model, range),
            context: {
                diagnostics: context.markers.map(marker => this._toDiagnostic(uri, marker, model)),
                // `only` is how the editor asks for one specific kind — the
                // organize-imports and source-action entry points. Dropping it
                // made every one of those requests a generic "all actions" ask.
                only: toLspCodeActionKinds(context.only),
                triggerKind: toLspCodeActionTriggerKind(context.trigger),
            },
        }));

        if (!result) {
            return null;
        }

        const actions = Array.isArray(result) ? result : [result];

        return {
            actions: actions.map(action => {
                if ('command' in action && typeof (action as any).command === 'string') {
                    // Command (has command: string, vs CodeAction which has command?: Command object)
                    const cmd = action as Command;
                    const monacoAction: ExtendedCodeAction = {
                        title: cmd.title,
                        command: toMonacoCommand(cmd),
                    };
                    return monacoAction;
                } else {
                    // CodeAction
                    const codeAction = action as CodeAction;
                    const monacoAction: ExtendedCodeAction = {
                        title: codeAction.title,
                        kind: toMonacoCodeActionKind(codeAction.kind),
                        isPreferred: codeAction.isPreferred,
                        disabled: codeAction.disabled?.reason,
                        edit: codeAction.edit ? toMonacoWorkspaceEdit(codeAction.edit, this._client, 'codeAction') : undefined,
                        command: toMonacoCommand(codeAction.command),
                        diagnostics: codeAction.diagnostics
                            ? context.markers.filter(m => this._client.diagnostics.match(uri, m) !== undefined)
                            : undefined,
                        _lspAction: codeAction,
                    };
                    return monacoAction;
                }
            }),
            dispose: () => { },
        };
    }

    /**
     * The diagnostic to send with a code-action request.
     *
     * Prefers the original the server published, because `data`, the
     * structured `code` and `relatedInformation` never survive the trip
     * through a Monaco marker — and those are precisely the fields
     * tsserver and eslint match their quick fixes against. Reconstruction
     * from the marker is the fallback for markers this client didn't publish
     * (Monaco's own JSON/CSS/TS workers, for instance).
     */
    private _toDiagnostic(
        uri: string,
        marker: monaco.editor.IMarkerData,
        model: monaco.editor.ITextModel
    ): Diagnostic {
        const original = this._client.diagnostics.match(uri, marker);
        if (original) {
            return original;
        }
        return toLspDiagnostic(marker, this._client.bridge, model);
    }
}

/** Monaco passes a single requested kind; LSP takes a list. */
function toLspCodeActionKinds(only: string | undefined): CodeActionKind[] | undefined {
    if (!only) {
        return undefined;
    }
    return [only as CodeActionKind];
}
