import * as monaco from 'monaco-editor';
import { capabilities, CompletionRegistrationOptions, MarkupKind, CompletionItem, TextDocumentPositionParams } from '../types';
import { assertTargetTextModel, ITextModelBridge } from '../ITextModelBridge';
import { Disposable } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspRequest } from './cancellation';
import {
    lspCompletionItemKindToMonacoCompletionItemKind,
    lspCompletionItemTagToMonacoCompletionItemTag,
    toMarkdown,
    toMonacoCompletionItemKind,
    toMonacoCompletionItemTag,
    toLspCompletionTriggerKind,
    toMonacoInsertTextRules,
    toMonacoCommand,
    toMonacoLanguageSelector,
} from './common';

export class LspCompletionFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                completion: {
                    dynamicRegistration: true,
                    contextSupport: true,
                    completionItemKind: {
                        valueSet: Array.from(lspCompletionItemKindToMonacoCompletionItemKind.keys()),
                    },
                    completionItem: {
                        snippetSupport: true,
                        tagSupport: {
                            valueSet: Array.from(lspCompletionItemTagToMonacoCompletionItemTag.keys()),
                        },
                        documentationFormat: [MarkupKind.Markdown, MarkupKind.PlainText],
                        commitCharactersSupport: true,
                        deprecatedSupport: true,
                        preselectSupport: true,
                        labelDetailsSupport: true,
                        insertReplaceSupport: true,
                        resolveSupport: {
                            properties: ['documentation', 'detail', 'additionalTextEdits', 'command'],
                        },
                    }
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentCompletion, true, capability => {
            return monaco.languages.registerCompletionItemProvider(
                toMonacoLanguageSelector(capability.documentSelector),
                new LspCompletionProvider(this._connection, capability),
            );
        }));
    }
}

interface ExtendedCompletionItem extends monaco.languages.CompletionItem {
    _lspItem: CompletionItem;
    _translated: TextDocumentPositionParams;
    _model: monaco.editor.ITextModel;
}

class LspCompletionProvider implements monaco.languages.CompletionItemProvider {
    public readonly resolveCompletionItem;

    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: CompletionRegistrationOptions,
    ) {
        if (_capabilities.resolveProvider) {
            this.resolveCompletionItem = async (item: ExtendedCompletionItem, token: monaco.CancellationToken): Promise<ExtendedCompletionItem> => {
                const resolved = await lspRequest(token, () => this._client.server.completionItemResolve(item._lspItem));
                if (!resolved) {
                    return item;
                }
                applyLspCompletionItemProperties(item, resolved, this._client.bridge, item._translated, item._model);
                return item;
            }
        }
    }

    get triggerCharacters(): string[] | undefined {
        return this._capabilities.triggerCharacters;
    }

    async provideCompletionItems(
        model: monaco.editor.ITextModel,
        position: monaco.Position,
        context: monaco.languages.CompletionContext,
        token: monaco.CancellationToken
    ): Promise<(monaco.languages.CompletionList & { suggestions: ExtendedCompletionItem[] }) | null> {
        const translated = this._client.bridge.translate(model, position);

        const result = await lspRequest(token, () => this._client.server.textDocumentCompletion({
            textDocument: translated.textDocument,
            position: translated.position,
            // `contextSupport: true` is advertised, so context goes with every
            // request — not only the trigger-character ones. Servers use
            // triggerKind to tell an explicit invoke from an incremental retype.
            context: {
                triggerKind: toLspCompletionTriggerKind(context.triggerKind),
                triggerCharacter: context.triggerCharacter,
            },
        }));

        if (!result) {
            return null;
        }

        const items = Array.isArray(result) ? result : result.items;
        // isIncomplete must be forwarded: otherwise the editor caches this list
        // and filters it locally instead of re-querying as the user types,
        // which is exactly wrong for servers that truncate their results.
        const incomplete = Array.isArray(result) ? false : result.isIncomplete === true;
        const defaultRange = defaultInsertRange(model, position);

        return {
            incomplete,
            suggestions: items.map<ExtendedCompletionItem>(i => ({
                ...convertLspToMonacoCompletionItem(
                    i,
                    this._client.bridge,
                    translated,
                    model,
                    defaultRange
                ),
                _lspItem: i,
                _translated: translated,
                _model: model,
            })),
        };
    }
}

/**
 * Range an item replaces when the server sends no textEdit of its own.
 *
 * This has to cover the word already typed. An empty range at the caret
 * inserts *next to* the prefix instead of replacing it, so accepting
 * `console` after typing `co` produced `coconsole`.
 */
function defaultInsertRange(
    model: monaco.editor.ITextModel,
    position: monaco.Position
): monaco.IRange {
    const word = model.getWordUntilPosition(position);
    return {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
    };
}

function convertLspToMonacoCompletionItem(
    lspItem: CompletionItem,
    bridge: ITextModelBridge,
    translated: TextDocumentPositionParams,
    model: monaco.editor.ITextModel,
    defaultRange: monaco.IRange
): monaco.languages.CompletionItem {
    let insertText = lspItem.insertText || lspItem.label;
    let range: monaco.IRange | monaco.languages.CompletionItemRanges | undefined = undefined;

    if (lspItem.textEdit) {
        if ('range' in lspItem.textEdit) {
            insertText = lspItem.textEdit.newText;
            range = assertTargetTextModel(bridge.translateBackRange(translated.textDocument, lspItem.textEdit.range), model).range;
        } else {
            insertText = lspItem.textEdit.newText;
            range = {
                insert: assertTargetTextModel(bridge.translateBackRange(translated.textDocument, lspItem.textEdit.insert), model).range,
                replace: assertTargetTextModel(bridge.translateBackRange(translated.textDocument, lspItem.textEdit.replace), model).range,
            };
        }
    }

    if (!range) {
        range = defaultRange;
    }

    const item: monaco.languages.CompletionItem = {
        label: toMonacoLabel(lspItem),
        kind: toMonacoCompletionItemKind(lspItem.kind),
        insertText,
        sortText: lspItem.sortText,
        filterText: lspItem.filterText,
        preselect: lspItem.preselect,
        commitCharacters: lspItem.commitCharacters,
        range: range,
    };

    applyLspCompletionItemProperties(item, lspItem, bridge, translated, model);

    return item;
}

/** `labelDetailsSupport` is advertised, so the extra label parts must show up. */
function toMonacoLabel(lspItem: CompletionItem): string | monaco.languages.CompletionItemLabel {
    const details = lspItem.labelDetails;
    if (!details || (!details.detail && !details.description)) {
        return lspItem.label;
    }
    return {
        label: lspItem.label,
        detail: details.detail,
        description: details.description,
    };
}

function applyLspCompletionItemProperties(
    monacoItem: monaco.languages.CompletionItem,
    lspItem: CompletionItem,
    bridge: ITextModelBridge,
    translated: TextDocumentPositionParams,
    targetModel: monaco.editor.ITextModel
): void {
    if (lspItem.detail !== undefined) {
        monacoItem.detail = lspItem.detail;
    }
    if (lspItem.documentation !== undefined) {
        monacoItem.documentation = toMarkdown(lspItem.documentation);
    }
    if (lspItem.insertTextFormat !== undefined) {
        const insertTextRules = toMonacoInsertTextRules(lspItem.insertTextFormat);
        monacoItem.insertTextRules = insertTextRules;
    }
    if (lspItem.tags && lspItem.tags.length > 0) {
        monacoItem.tags = lspItem.tags.map(toMonacoCompletionItemTag).filter((tag): tag is monaco.languages.CompletionItemTag => tag !== undefined);
    }
    if (lspItem.additionalTextEdits && lspItem.additionalTextEdits.length > 0) {
        monacoItem.additionalTextEdits = lspItem.additionalTextEdits.map(edit => ({
            range: bridge.toMonacoRange(edit.range),
            text: edit.newText,
        }));
    }
    if (lspItem.command) {
        monacoItem.command = toMonacoCommand(lspItem.command);
    }
}
