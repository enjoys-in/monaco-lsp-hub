import * as monaco from 'monaco-editor';
import { api, capabilities, Position, Range, TextDocumentContentChangeEvent, TextDocumentIdentifier, TextDocumentSyncKind } from './types';
import { Disposable, DisposableStore } from './utils';
import { ITextModelBridge } from './ITextModelBridge';
import { ILspCapabilitiesRegistry } from './LspCapabilitiesRegistry';
import { ResolvedScope } from './LspConnection';

/**
 * LSP URI for a Monaco model.
 *
 * `toString()` and not `toString(true)`: the skip-encoding form leaves `#` and
 * `?` raw, so a file legitimately named `report #2.py` becomes a URI whose
 * fragment is `2.py` and which resolves, server-side, to `report `. Over SFTP
 * those names are ordinary.
 */
function lspUri(model: monaco.editor.ITextModel): string {
    return model.uri.toString();
}

export class TextDocumentSynchronizer extends Disposable implements ITextModelBridge {
    private readonly _managedModels = new Map<monaco.editor.ITextModel, ManagedModel>();
    private readonly _managedModelsReverse = new Map</* uri */ string, monaco.editor.ITextModel>();
    /** onWillDispose subscriptions, one per managed model, keyed for removal */
    private readonly _modelSubscriptions = new Map<monaco.editor.ITextModel, monaco.IDisposable>();

    private _started = false;

    constructor(
        private readonly _server: typeof api.TServerInterface,
        private readonly _capabilities: ILspCapabilitiesRegistry,
        /** Restricts sync to a single document; unscoped means every file: model */
        private readonly _scope?: ResolvedScope,
    ) {
        super();

        this._register(this._capabilities.addStaticClientCapabilities({
            textDocument: {
                synchronization: {
                    dynamicRegistration: true,
                    willSave: false,
                    willSaveWaitUntil: false,
                    didSave: false,
                }
            }
        }));

        this._register(_capabilities.registerCapabilityHandler(capabilities.textDocumentDidChange, true, options => {
            if (this._started) {
                return { dispose: () => { } };
            }
            this._started = true;

            // The server's declared sync kind, honoured rather than assumed.
            // Sending range-based changes to a server that asked for Full sync
            // makes it read the typed fragment as the entire new document, so
            // its copy of the file silently becomes garbage and every result
            // computed from it is wrong.
            const syncKind = options?.syncKind ?? TextDocumentSyncKind.Full;

            const store = new DisposableStore();
            store.add(monaco.editor.onDidCreateModel(m => {
                this._getOrCreateManagedModel(m, syncKind);
            }));
            for (const m of monaco.editor.getModels()) {
                this._getOrCreateManagedModel(m, syncKind);
            }
            this._register(store);
            return { dispose: () => { } };
        }));
    }

    /**
     * Whether this connection is responsible for a model.
     *
     * Every model on the page used to be opened against the language server:
     * other editors' documents, `inmemory://` scratch models, diff views. The
     * hub can only write `file:` URIs to its workspace, and the server can only
     * answer for the file it was started for, so everything else was noise at
     * best.
     */
    private _isInScope(m: monaco.editor.ITextModel): boolean {
        if (!this._scope) {
            return m.uri.scheme === 'file';
        }
        return m.uri.toString() === this._scope.resolvedUri.toString();
    }

    private _getOrCreateManagedModel(m: monaco.editor.ITextModel, syncKind: TextDocumentSyncKind) {
        if (!this._started) {
            throw new Error('Not started');
        }
        if (!this._isInScope(m)) {
            return undefined;
        }

        const uriStr = lspUri(m);
        let mm = this._managedModels.get(m);
        if (mm) {
            return mm;
        }

        mm = new ManagedModel(m, this._server, syncKind);
        this._managedModels.set(m, mm);
        this._managedModelsReverse.set(uriStr, m);

        // Registered once per model, and removed on teardown — re-subscribing
        // on every lookup would leak a listener per call.
        this._modelSubscriptions.set(m, m.onWillDispose(() => {
            this._releaseManagedModel(m, uriStr);
        }));

        return mm;
    }

    private _releaseManagedModel(m: monaco.editor.ITextModel, uriStr: string): void {
        this._modelSubscriptions.get(m)?.dispose();
        this._modelSubscriptions.delete(m);
        this._managedModels.get(m)?.dispose();
        this._managedModels.delete(m);
        this._managedModelsReverse.delete(uriStr);
    }

    override dispose(): void {
        // Close every open document before the connection goes away, so the
        // server isn't left believing a set of phantom files is still open.
        for (const [uriStr, model] of [...this._managedModelsReverse]) {
            this._releaseManagedModel(model, uriStr);
        }
        this._managedModels.clear();
        this._managedModelsReverse.clear();
        this._modelSubscriptions.clear();
        super.dispose();
    }

    // ── ITextModelBridge ────────────────────────────────────────────────────

    findTextModel(textDocument: TextDocumentIdentifier): monaco.editor.ITextModel | undefined {
        const known = this._managedModelsReverse.get(textDocument.uri);
        if (known && !known.isDisposed()) {
            return known;
        }
        // Fall back to Monaco's registry: a model can exist without being
        // managed yet (created before sync started, or a different scheme).
        const model = monaco.editor.getModel(monaco.Uri.parse(textDocument.uri));
        return model ?? undefined;
    }

    resolveUri(uri: string): monaco.Uri {
        return this.findTextModel({ uri })?.uri ?? monaco.Uri.parse(uri);
    }

    toMonacoPosition(position: Position): monaco.Position {
        return new monaco.Position(position.line + 1, position.character + 1);
    }

    toMonacoRange(range: Range): monaco.Range {
        return new monaco.Range(
            range.start.line + 1,
            range.start.character + 1,
            range.end.line + 1,
            range.end.character + 1
        );
    }

    translateBack(textDocument: TextDocumentIdentifier, position: Position): { textModel: monaco.editor.ITextModel; position: monaco.Position; } {
        const textModel = this.findTextModel(textDocument);
        if (!textModel) {
            throw new Error(`No text model for uri ${textDocument.uri}`);
        }
        return { textModel, position: this.toMonacoPosition(position) };
    }

    translateBackRange(textDocument: TextDocumentIdentifier, range: Range): { textModel: monaco.editor.ITextModel; range: monaco.Range; } {
        const textModel = this.findTextModel(textDocument);
        if (!textModel) {
            throw new Error(`No text model for uri ${textDocument.uri}`);
        }
        return { textModel, range: this.toMonacoRange(range) };
    }

    translate(textModel: monaco.editor.ITextModel, monacoPos: monaco.Position): { textDocument: TextDocumentIdentifier; position: Position; } {
        return {
            textDocument: {
                uri: lspUri(textModel),
            },
            position: {
                line: monacoPos.lineNumber - 1,
                character: monacoPos.column - 1,
            }
        };
    }

    translateRange(textModel: monaco.editor.ITextModel, monacoRange: monaco.Range): Range {
        return {
            start: {
                line: monacoRange.startLineNumber - 1,
                character: monacoRange.startColumn - 1,
            },
            end: {
                line: monacoRange.endLineNumber - 1,
                character: monacoRange.endColumn - 1,
            }
        };
    }
}

class ManagedModel extends Disposable {
    constructor(
        private readonly _textModel: monaco.editor.ITextModel,
        private readonly _api: typeof api.TServerInterface,
        private readonly _syncKind: TextDocumentSyncKind,
    ) {
        super();

        const uri = lspUri(_textModel);

        this._api.textDocumentDidOpen({
            textDocument: {
                languageId: _textModel.getLanguageId(),
                uri: uri,
                version: _textModel.getVersionId(),
                text: _textModel.getValue(),
            }
        });

        // TextDocumentSyncKind.None means the server tracks content itself and
        // wants no change notifications. Open and close still go out: a server
        // that never learns the document exists cannot answer anything about it.
        if (_syncKind !== TextDocumentSyncKind.None) {
            this._register(_textModel.onDidChangeContent(e => {
                this._api.textDocumentDidChange({
                    textDocument: {
                        uri: uri,
                        version: _textModel.getVersionId(),
                    },
                    contentChanges: this._toContentChanges(e),
                });
            }));
        }

        this._register({
            dispose: () => {
                this._api.textDocumentDidClose({
                    textDocument: {
                        uri: uri,
                    }
                });
            }
        });
    }

    private _toContentChanges(e: monaco.editor.IModelContentChangedEvent): TextDocumentContentChangeEvent[] {
        if (this._syncKind === TextDocumentSyncKind.Full) {
            // A single change with no range *is* the full-document form.
            return [{ text: this._textModel.getValue() }];
        }
        return e.changes.map(c => toLspTextDocumentContentChangeEvent(c));
    }
}

function toLspTextDocumentContentChangeEvent(change: monaco.editor.IModelContentChange): TextDocumentContentChangeEvent {
    return {
        range: toLspRange(change.range),
        rangeLength: change.rangeLength,
        text: change.text,
    };
}

function toLspRange(range: monaco.IRange): Range {
    return {
        start: {
            line: range.startLineNumber - 1,
            character: range.startColumn - 1,
        },
        end: {
            line: range.endLineNumber - 1,
            character: range.endColumn - 1,
        }
    };
}
