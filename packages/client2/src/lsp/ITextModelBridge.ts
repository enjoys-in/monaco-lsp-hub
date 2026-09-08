import * as monaco from 'monaco-editor';
import { Position, Range, TextDocumentIdentifier } from './types';

export interface ITextModelBridge {
	translate(
		textModel: monaco.editor.ITextModel,
		monacoPos: monaco.Position
	): {
		textDocument: TextDocumentIdentifier;
		position: Position;
	};

	translateRange(textModel: monaco.editor.ITextModel, monacoRange: monaco.Range): Range;

	/**
	 * Throws when no model is open for `textDocument`. Only safe for results
	 * that are known to belong to the document the request was made against —
	 * for anything that can point at another file use `toMonacoPosition` /
	 * `resolveUri`, which never throw.
	 */
	translateBack(
		textDocument: TextDocumentIdentifier,
		position: Position
	): {
		textModel: monaco.editor.ITextModel;
		position: monaco.Position;
	};

	/** Throws when no model is open — see `translateBack`. */
	translateBackRange(
		textDocument: TextDocumentIdentifier,
		range: Range
	): {
		textModel: monaco.editor.ITextModel;
		range: monaco.Range;
	};

	// ── Tolerant conversions ────────────────────────────────────────────────
	// Language servers routinely answer with files the editor has never opened
	// (stdlib sources, node_modules, other project files). Positions are pure
	// arithmetic and need no model, so these always succeed and a definition
	// into an unopened file stops being a thrown-away result.

	/** The open model for an LSP URI, or undefined when nothing is open for it. */
	findTextModel(textDocument: TextDocumentIdentifier): monaco.editor.ITextModel | undefined;

	/** Monaco URI for an LSP URI, whether or not a model is open for it. */
	resolveUri(uri: string): monaco.Uri;

	/** LSP → Monaco position (1-based), no model required. */
	toMonacoPosition(position: Position): monaco.Position;

	/** LSP → Monaco range (1-based), no model required. */
	toMonacoRange(range: Range): monaco.Range;
}

export function assertTargetTextModel<T extends { textModel: monaco.editor.ITextModel }>(
	input: T,
	expectedTextModel: monaco.editor.ITextModel
): T {
	if (input.textModel !== expectedTextModel) {
		throw new Error(`Expected text model to be ${expectedTextModel}, but got ${input.textModel}`);
	}
	return input;
}
