import * as monaco from 'monaco-editor';
import { Diagnostic } from './types';

/**
 * The original LSP diagnostics behind the markers currently in the editor.
 *
 * A Monaco marker cannot carry `data`, and it flattens `code` to a string —
 * but `data`/`code`/`source` are exactly what servers key their quick fixes
 * off. Handing a code-action request markers converted back from Monaco meant
 * typescript-language-server and eslint saw diagnostics they didn't recognise
 * and returned nothing, so the originals are kept here and matched by position.
 */
export class LspDiagnosticStore {
    private readonly _byUri = new Map</* uri */ string, Diagnostic[]>();

    set(uri: string, diagnostics: Diagnostic[]): void {
        if (diagnostics.length === 0) {
            this._byUri.delete(uri);
            return;
        }
        this._byUri.set(uri, diagnostics);
    }

    get(uri: string): Diagnostic[] {
        return this._byUri.get(uri) ?? [];
    }

    delete(uri: string): void {
        this._byUri.delete(uri);
    }

    clear(): void {
        this._byUri.clear();
    }

    /** The original diagnostic a marker came from, if we published it. */
    match(uri: string, marker: monaco.editor.IMarkerData): Diagnostic | undefined {
        return this.get(uri).find(d =>
            d.range.start.line + 1 === marker.startLineNumber &&
            d.range.start.character + 1 === marker.startColumn &&
            d.range.end.line + 1 === marker.endLineNumber &&
            d.range.end.character + 1 === marker.endColumn &&
            d.message === marker.message
        );
    }
}
