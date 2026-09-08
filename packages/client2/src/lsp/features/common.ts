import * as monaco from 'monaco-editor';
import {
    CodeActionKind,
    CodeActionTriggerKind,
    Command,
    CompletionItemKind,
    CompletionItemTag,
    CompletionTriggerKind,
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticTag,
    DocumentHighlightKind,
    DocumentSelector,
    FoldingRangeKind,
    InlayHintKind,
    InsertTextFormat,
    Location,
    LocationLink,
    MarkupContent,
    Range,
    SignatureHelpTriggerKind,
    SymbolKind,
    SymbolTag,
    WorkspaceEdit,
} from '../types';
import { LspConnection } from '../LspConnection';

// ============================================================================
// Code Action Kind
// ============================================================================

export const lspCodeActionKindToMonacoCodeActionKind = new Map<CodeActionKind, string>([
    [CodeActionKind.Empty, ''],
    [CodeActionKind.QuickFix, 'quickfix'],
    [CodeActionKind.Refactor, 'refactor'],
    [CodeActionKind.RefactorExtract, 'refactor.extract'],
    [CodeActionKind.RefactorInline, 'refactor.inline'],
    [CodeActionKind.RefactorRewrite, 'refactor.rewrite'],
    [CodeActionKind.Source, 'source'],
    [CodeActionKind.SourceOrganizeImports, 'source.organizeImports'],
    [CodeActionKind.SourceFixAll, 'source.fixAll'],
]);

export function toMonacoCodeActionKind(kind: CodeActionKind | undefined): string | undefined {
    if (!kind) {
        return undefined;
    }
    return lspCodeActionKindToMonacoCodeActionKind.get(kind) ?? kind;
}

// ============================================================================
// Code Action Trigger Kind
// ============================================================================

export const monacoCodeActionTriggerTypeToLspCodeActionTriggerKind = new Map<monaco.languages.CodeActionTriggerType, CodeActionTriggerKind>([
    [monaco.languages.CodeActionTriggerType.Invoke, CodeActionTriggerKind.Invoked],
    [monaco.languages.CodeActionTriggerType.Auto, CodeActionTriggerKind.Automatic],
]);

export function toLspCodeActionTriggerKind(monacoTrigger: monaco.languages.CodeActionTriggerType): CodeActionTriggerKind {
    return monacoCodeActionTriggerTypeToLspCodeActionTriggerKind.get(monacoTrigger) ?? CodeActionTriggerKind.Invoked;
}

// ============================================================================
// Completion Item Kind
// ============================================================================

export const lspCompletionItemKindToMonacoCompletionItemKind = new Map<CompletionItemKind, monaco.languages.CompletionItemKind>([
    [CompletionItemKind.Text, monaco.languages.CompletionItemKind.Text],
    [CompletionItemKind.Method, monaco.languages.CompletionItemKind.Method],
    [CompletionItemKind.Function, monaco.languages.CompletionItemKind.Function],
    [CompletionItemKind.Constructor, monaco.languages.CompletionItemKind.Constructor],
    [CompletionItemKind.Field, monaco.languages.CompletionItemKind.Field],
    [CompletionItemKind.Variable, monaco.languages.CompletionItemKind.Variable],
    [CompletionItemKind.Class, monaco.languages.CompletionItemKind.Class],
    [CompletionItemKind.Interface, monaco.languages.CompletionItemKind.Interface],
    [CompletionItemKind.Module, monaco.languages.CompletionItemKind.Module],
    [CompletionItemKind.Property, monaco.languages.CompletionItemKind.Property],
    [CompletionItemKind.Unit, monaco.languages.CompletionItemKind.Unit],
    [CompletionItemKind.Value, monaco.languages.CompletionItemKind.Value],
    [CompletionItemKind.Enum, monaco.languages.CompletionItemKind.Enum],
    [CompletionItemKind.Keyword, monaco.languages.CompletionItemKind.Keyword],
    [CompletionItemKind.Snippet, monaco.languages.CompletionItemKind.Snippet],
    [CompletionItemKind.Color, monaco.languages.CompletionItemKind.Color],
    [CompletionItemKind.File, monaco.languages.CompletionItemKind.File],
    [CompletionItemKind.Reference, monaco.languages.CompletionItemKind.Reference],
    [CompletionItemKind.Folder, monaco.languages.CompletionItemKind.Folder],
    [CompletionItemKind.EnumMember, monaco.languages.CompletionItemKind.EnumMember],
    [CompletionItemKind.Constant, monaco.languages.CompletionItemKind.Constant],
    [CompletionItemKind.Struct, monaco.languages.CompletionItemKind.Struct],
    [CompletionItemKind.Event, monaco.languages.CompletionItemKind.Event],
    [CompletionItemKind.Operator, monaco.languages.CompletionItemKind.Operator],
    [CompletionItemKind.TypeParameter, monaco.languages.CompletionItemKind.TypeParameter],
]);

export function toMonacoCompletionItemKind(kind: CompletionItemKind | undefined): monaco.languages.CompletionItemKind {
    if (!kind) {
        return monaco.languages.CompletionItemKind.Text;
    }
    return lspCompletionItemKindToMonacoCompletionItemKind.get(kind) ?? monaco.languages.CompletionItemKind.Text;
}

// ============================================================================
// Completion Item Tag
// ============================================================================

export const lspCompletionItemTagToMonacoCompletionItemTag = new Map<CompletionItemTag, monaco.languages.CompletionItemTag>([
    [CompletionItemTag.Deprecated, monaco.languages.CompletionItemTag.Deprecated],
]);

export function toMonacoCompletionItemTag(tag: CompletionItemTag): monaco.languages.CompletionItemTag | undefined {
    return lspCompletionItemTagToMonacoCompletionItemTag.get(tag);
}

// ============================================================================
// Completion Trigger Kind
// ============================================================================

export const monacoCompletionTriggerKindToLspCompletionTriggerKind = new Map<monaco.languages.CompletionTriggerKind, CompletionTriggerKind>([
    [monaco.languages.CompletionTriggerKind.Invoke, CompletionTriggerKind.Invoked],
    [monaco.languages.CompletionTriggerKind.TriggerCharacter, CompletionTriggerKind.TriggerCharacter],
    [monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions, CompletionTriggerKind.TriggerForIncompleteCompletions],
]);

export function toLspCompletionTriggerKind(monacoKind: monaco.languages.CompletionTriggerKind): CompletionTriggerKind {
    return monacoCompletionTriggerKindToLspCompletionTriggerKind.get(monacoKind) ?? CompletionTriggerKind.Invoked;
}

// ============================================================================
// Insert Text Format
// ============================================================================

export const lspInsertTextFormatToMonacoInsertTextRules = new Map<InsertTextFormat, monaco.languages.CompletionItemInsertTextRule>([
    [InsertTextFormat.Snippet, monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet],
]);

export function toMonacoInsertTextRules(format: InsertTextFormat | undefined): monaco.languages.CompletionItemInsertTextRule | undefined {
    if (!format) {
        return undefined;
    }
    return lspInsertTextFormatToMonacoInsertTextRules.get(format);
}

// ============================================================================
// Symbol Kind
// ============================================================================

export const lspSymbolKindToMonacoSymbolKind = new Map<SymbolKind, monaco.languages.SymbolKind>([
    [SymbolKind.File, monaco.languages.SymbolKind.File],
    [SymbolKind.Module, monaco.languages.SymbolKind.Module],
    [SymbolKind.Namespace, monaco.languages.SymbolKind.Namespace],
    [SymbolKind.Package, monaco.languages.SymbolKind.Package],
    [SymbolKind.Class, monaco.languages.SymbolKind.Class],
    [SymbolKind.Method, monaco.languages.SymbolKind.Method],
    [SymbolKind.Property, monaco.languages.SymbolKind.Property],
    [SymbolKind.Field, monaco.languages.SymbolKind.Field],
    [SymbolKind.Constructor, monaco.languages.SymbolKind.Constructor],
    [SymbolKind.Enum, monaco.languages.SymbolKind.Enum],
    [SymbolKind.Interface, monaco.languages.SymbolKind.Interface],
    [SymbolKind.Function, monaco.languages.SymbolKind.Function],
    [SymbolKind.Variable, monaco.languages.SymbolKind.Variable],
    [SymbolKind.Constant, monaco.languages.SymbolKind.Constant],
    [SymbolKind.String, monaco.languages.SymbolKind.String],
    [SymbolKind.Number, monaco.languages.SymbolKind.Number],
    [SymbolKind.Boolean, monaco.languages.SymbolKind.Boolean],
    [SymbolKind.Array, monaco.languages.SymbolKind.Array],
    [SymbolKind.Object, monaco.languages.SymbolKind.Object],
    [SymbolKind.Key, monaco.languages.SymbolKind.Key],
    [SymbolKind.Null, monaco.languages.SymbolKind.Null],
    [SymbolKind.EnumMember, monaco.languages.SymbolKind.EnumMember],
    [SymbolKind.Struct, monaco.languages.SymbolKind.Struct],
    [SymbolKind.Event, monaco.languages.SymbolKind.Event],
    [SymbolKind.Operator, monaco.languages.SymbolKind.Operator],
    [SymbolKind.TypeParameter, monaco.languages.SymbolKind.TypeParameter],
]);

export function toMonacoSymbolKind(kind: SymbolKind): monaco.languages.SymbolKind {
    return lspSymbolKindToMonacoSymbolKind.get(kind) ?? monaco.languages.SymbolKind.File;
}

// ============================================================================
// Symbol Tag
// ============================================================================

export const lspSymbolTagToMonacoSymbolTag = new Map<SymbolTag, monaco.languages.SymbolTag>([
    [SymbolTag.Deprecated, monaco.languages.SymbolTag.Deprecated],
]);

export function toMonacoSymbolTag(tag: SymbolTag): monaco.languages.SymbolTag | undefined {
    return lspSymbolTagToMonacoSymbolTag.get(tag);
}

// ============================================================================
// Document Highlight Kind
// ============================================================================

export const lspDocumentHighlightKindToMonacoDocumentHighlightKind = new Map<DocumentHighlightKind, monaco.languages.DocumentHighlightKind>([
    [DocumentHighlightKind.Text, monaco.languages.DocumentHighlightKind.Text],
    [DocumentHighlightKind.Read, monaco.languages.DocumentHighlightKind.Read],
    [DocumentHighlightKind.Write, monaco.languages.DocumentHighlightKind.Write],
]);

export function toMonacoDocumentHighlightKind(kind: DocumentHighlightKind | undefined): monaco.languages.DocumentHighlightKind {
    if (!kind) {
        return monaco.languages.DocumentHighlightKind.Text;
    }
    return lspDocumentHighlightKindToMonacoDocumentHighlightKind.get(kind) ?? monaco.languages.DocumentHighlightKind.Text;
}

// ============================================================================
// Folding Range Kind
// ============================================================================

export const lspFoldingRangeKindToMonacoFoldingRangeKind = new Map<FoldingRangeKind, monaco.languages.FoldingRangeKind>([
    [FoldingRangeKind.Comment, monaco.languages.FoldingRangeKind.Comment],
    [FoldingRangeKind.Imports, monaco.languages.FoldingRangeKind.Imports],
    [FoldingRangeKind.Region, monaco.languages.FoldingRangeKind.Region],
]);

export function toMonacoFoldingRangeKind(kind: FoldingRangeKind | undefined): monaco.languages.FoldingRangeKind | undefined {
    if (!kind) {
        return undefined;
    }
    return lspFoldingRangeKindToMonacoFoldingRangeKind.get(kind);
}

// ============================================================================
// Diagnostic Severity
// ============================================================================

export const monacoMarkerSeverityToLspDiagnosticSeverity = new Map<monaco.MarkerSeverity, DiagnosticSeverity>([
    [monaco.MarkerSeverity.Error, DiagnosticSeverity.Error],
    [monaco.MarkerSeverity.Warning, DiagnosticSeverity.Warning],
    [monaco.MarkerSeverity.Info, DiagnosticSeverity.Information],
    [monaco.MarkerSeverity.Hint, DiagnosticSeverity.Hint],
]);

export function toLspDiagnosticSeverity(severity: monaco.MarkerSeverity): DiagnosticSeverity {
    return monacoMarkerSeverityToLspDiagnosticSeverity.get(severity) ?? DiagnosticSeverity.Error;
}

export const lspDiagnosticSeverityToMonacoMarkerSeverity = new Map<DiagnosticSeverity, monaco.MarkerSeverity>([
    [DiagnosticSeverity.Error, monaco.MarkerSeverity.Error],
    [DiagnosticSeverity.Warning, monaco.MarkerSeverity.Warning],
    [DiagnosticSeverity.Information, monaco.MarkerSeverity.Info],
    [DiagnosticSeverity.Hint, monaco.MarkerSeverity.Hint],
]);

export function toMonacoDiagnosticSeverity(severity: DiagnosticSeverity | undefined): monaco.MarkerSeverity {
    if (!severity) {
        return monaco.MarkerSeverity.Error;
    }
    return lspDiagnosticSeverityToMonacoMarkerSeverity.get(severity) ?? monaco.MarkerSeverity.Error;
}

// ============================================================================
// Diagnostic Tag
// ============================================================================

export const lspDiagnosticTagToMonacoMarkerTag = new Map<DiagnosticTag, monaco.MarkerTag>([
    [DiagnosticTag.Unnecessary, monaco.MarkerTag.Unnecessary],
    [DiagnosticTag.Deprecated, monaco.MarkerTag.Deprecated],
]);

export function toMonacoDiagnosticTag(tag: DiagnosticTag): monaco.MarkerTag | undefined {
    return lspDiagnosticTagToMonacoMarkerTag.get(tag);
}

// ============================================================================
// Signature Help Trigger Kind
// ============================================================================

export const monacoSignatureHelpTriggerKindToLspSignatureHelpTriggerKind = new Map<monaco.languages.SignatureHelpTriggerKind, SignatureHelpTriggerKind>([
    [monaco.languages.SignatureHelpTriggerKind.Invoke, SignatureHelpTriggerKind.Invoked],
    [monaco.languages.SignatureHelpTriggerKind.TriggerCharacter, SignatureHelpTriggerKind.TriggerCharacter],
    [monaco.languages.SignatureHelpTriggerKind.ContentChange, SignatureHelpTriggerKind.ContentChange],
]);

export function toLspSignatureHelpTriggerKind(monacoKind: monaco.languages.SignatureHelpTriggerKind): SignatureHelpTriggerKind {
    return monacoSignatureHelpTriggerKindToLspSignatureHelpTriggerKind.get(monacoKind) ?? SignatureHelpTriggerKind.Invoked;
}

// ============================================================================
// Command
// ============================================================================

export function toMonacoCommand(command: Command | undefined): monaco.languages.Command | undefined {
    if (!command) {
        return undefined;
    }
    return {
        id: command.command,
        title: command.title,
        arguments: command.arguments,
    };
}

// ============================================================================
// Inlay Hint Kind
// ============================================================================

export const lspInlayHintKindToMonacoInlayHintKind = new Map<InlayHintKind, monaco.languages.InlayHintKind>([
    [InlayHintKind.Type, monaco.languages.InlayHintKind.Type],
    [InlayHintKind.Parameter, monaco.languages.InlayHintKind.Parameter],
]);

export function toMonacoInlayHintKind(kind: InlayHintKind | undefined): monaco.languages.InlayHintKind {
    if (!kind) {
        return monaco.languages.InlayHintKind.Type;
    }
    return lspInlayHintKindToMonacoInlayHintKind.get(kind) ?? monaco.languages.InlayHintKind.Type;
}

// ============================================================================
// Markdown
// ============================================================================

/**
 * Server-supplied markdown (hover bodies, completion docs, inlay tooltips).
 *
 * `isTrusted` is deliberately false: it gates `command:` links, and a language
 * server is not a trusted authority for "run this editor command on click".
 */
export function toMarkdown(
    value: string | MarkupContent | undefined
): string | monaco.IMarkdownString | undefined {
    if (!value) {
        return undefined;
    }
    if (typeof value === 'string') {
        return { value, isTrusted: false };
    }
    return { value: value.value, isTrusted: false };
}

// ============================================================================
// Locations
// ============================================================================

/**
 * Convert an LSP Location / LocationLink to its Monaco equivalent.
 *
 * `sourceUri` is the document the request was made against. It matters because
 * `originSelectionRange` belongs to the *source* document while `targetRange`
 * belongs to the target — conflating them produced ranges from the wrong file.
 *
 * Nothing here needs an open model: definitions and references routinely point
 * at stdlib or dependency files the editor has never opened, and throwing on
 * those discarded every other result in the same response.
 */
export function toMonacoLocation(
    location: Location | LocationLink,
    client: LspConnection,
    sourceUri?: string
): monaco.languages.Location | monaco.languages.LocationLink {
    const bridge = client.bridge;

    if ('targetUri' in location) {
        return {
            uri: bridge.resolveUri(location.targetUri),
            range: bridge.toMonacoRange(location.targetRange),
            originSelectionRange: location.originSelectionRange
                ? bridge.toMonacoRange(location.originSelectionRange)
                : undefined,
            targetSelectionRange: location.targetSelectionRange
                ? bridge.toMonacoRange(location.targetSelectionRange)
                : undefined,
        };
    }

    return {
        uri: bridge.resolveUri(location.uri),
        range: bridge.toMonacoRange(location.range),
    };
}

// ============================================================================
// Workspace edits
// ============================================================================

export interface ConvertedWorkspaceEdit {
    edit: monaco.languages.WorkspaceEdit;
    /** create / rename / delete operations that were present in the LSP edit */
    fileOperations: string[];
}

/**
 * Convert an LSP WorkspaceEdit into a Monaco WorkspaceEdit.
 *
 * Text edits for files with no open model are kept (the URI resolves either
 * way), so an edit that touches a second file no longer throws away the whole
 * rename. File operations are reported separately rather than dropped in
 * silence: Monaco's standalone bulk-edit service rejects anything that isn't a
 * text edit, so they cannot be forwarded here — `MonacoLspClient` applies them
 * itself on the `workspace/applyEdit` path where it controls application.
 */
export function convertWorkspaceEdit(
    edit: WorkspaceEdit,
    client: LspConnection
): ConvertedWorkspaceEdit {
    const edits: monaco.languages.IWorkspaceTextEdit[] = [];
    const fileOperations: string[] = [];
    const bridge = client.bridge;

    if (edit.changes) {
        for (const [uri, textEdits] of Object.entries(edit.changes)) {
            const resource = bridge.resolveUri(uri);
            for (const textEdit of textEdits) {
                edits.push({
                    resource,
                    versionId: undefined,
                    textEdit: {
                        range: bridge.toMonacoRange(textEdit.range),
                        text: textEdit.newText,
                    },
                });
            }
        }
    }

    if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
            if ('textDocument' in change) {
                const resource = bridge.resolveUri(change.textDocument.uri);
                // versionId only means something for a document we actually
                // track; sending a server version for an unopened file makes
                // Monaco reject the edit as stale.
                const tracked = bridge.findTextModel({ uri: change.textDocument.uri });
                for (const textEdit of change.edits) {
                    edits.push({
                        resource,
                        versionId: tracked ? change.textDocument.version ?? undefined : undefined,
                        textEdit: {
                            range: bridge.toMonacoRange(textEdit.range),
                            text: textEdit.newText,
                        },
                    });
                }
            } else if ('kind' in change) {
                fileOperations.push(change.kind);
            }
        }
    }

    return { edit: { edits }, fileOperations };
}

/** Monaco-only view of the above, for providers that return an edit directly. */
export function toMonacoWorkspaceEdit(
    edit: WorkspaceEdit,
    client: LspConnection,
    context: string
): monaco.languages.WorkspaceEdit {
    const { edit: converted, fileOperations } = convertWorkspaceEdit(edit, client);
    if (fileOperations.length > 0) {
        console.warn(
            `[LSP] ${context}: dropping unsupported file operations (${fileOperations.join(', ')}) — ` +
            `the standalone editor can only apply text edits`
        );
    }
    return converted;
}

// ============================================================================
// Document selectors
// ============================================================================

export function toMonacoLanguageSelector(s: DocumentSelector | null): monaco.languages.LanguageSelector {
    if (!s || s.length === 0) {
        return '*';
    }
    return s.map<monaco.languages.LanguageFilter>(s => {
        if ('notebook' in s) {
            if (typeof s.notebook === 'string') {
                return { notebookType: s.notebook, language: s.language };
            } else {
                return { notebookType: s.notebook.notebookType, language: s.language, pattern: s.notebook.pattern, scheme: s.notebook.scheme };
            }
        } else {
            return { language: s.language, pattern: s.pattern, scheme: s.scheme };
        }
    });
}

/** Minimal glob support: `*` within a segment, `**` across segments, `?` for one char. */
function globToRegExp(pattern: string): RegExp {
    let out = '';
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === '*') {
            if (pattern[i + 1] === '*') {
                out += '.*';
                i++;
                if (pattern[i + 1] === '/') i++;
            } else {
                out += '[^/]*';
            }
        } else if (c === '?') {
            out += '[^/]';
        } else if ('\\^$+.()|{}[]'.includes(c)) {
            out += '\\' + c;
        } else {
            out += c;
        }
    }
    return new RegExp(`^${out}$`);
}

/**
 * Does `model` satisfy a document selector?
 *
 * All three parts of a filter are conjunctive per the spec. Only `language`
 * used to be checked, so a `{ scheme: 'file' }` filter matched every model and
 * a filter with a non-matching language plus a matching pattern was misjudged.
 */
export function matchesDocumentSelector(
    model: monaco.editor.ITextModel,
    selector: DocumentSelector | null
): boolean {
    if (!selector || selector.length === 0) {
        return true;
    }

    const languageId = model.getLanguageId();
    const scheme = model.uri.scheme;
    const fsPath = model.uri.path;

    return selector.some(filter => {
        if ('notebook' in filter) {
            return false;
        }
        if (filter.language && filter.language !== '*' && filter.language !== languageId) {
            return false;
        }
        if (filter.scheme && filter.scheme !== '*' && filter.scheme !== scheme) {
            return false;
        }
        if (filter.pattern) {
            try {
                if (!globToRegExp(filter.pattern).test(fsPath)) {
                    return false;
                }
            } catch {
                // An unparseable pattern shouldn't disable the feature.
            }
        }
        return true;
    });
}

// ============================================================================
// Diagnostics
// ============================================================================

export function toDiagnosticMarker(diagnostic: Diagnostic): monaco.editor.IMarkerData {
    const marker: monaco.editor.IMarkerData = {
        severity: toMonacoDiagnosticSeverity(diagnostic.severity),
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
        message: diagnostic.message,
        source: diagnostic.source,
        code: toMarkerCode(diagnostic),
    };

    if (diagnostic.tags) {
        marker.tags = diagnostic.tags.map(tag => toMonacoDiagnosticTag(tag)).filter((tag): tag is monaco.MarkerTag => tag !== undefined);
    }

    if (diagnostic.relatedInformation) {
        marker.relatedInformation = diagnostic.relatedInformation.map(info => ({
            resource: monaco.Uri.parse(info.location.uri),
            startLineNumber: info.location.range.start.line + 1,
            startColumn: info.location.range.start.character + 1,
            endLineNumber: info.location.range.end.line + 1,
            endColumn: info.location.range.end.character + 1,
            message: info.message,
        }));
    }

    return marker;
}

/** Keep `codeDescription.href` as a clickable code when the server sends one. */
function toMarkerCode(
    diagnostic: Diagnostic
): string | { value: string; target: monaco.Uri } | undefined {
    if (diagnostic.code === undefined || diagnostic.code === null) {
        return undefined;
    }
    const value = String(diagnostic.code);
    const href = diagnostic.codeDescription?.href;
    if (href) {
        try {
            return { value, target: monaco.Uri.parse(href) };
        } catch {
            return value;
        }
    }
    return value;
}

/**
 * Reconstruct an LSP diagnostic from a Monaco marker.
 *
 * Lossy by nature — a marker has no room for `data`, and `code` collapses to a
 * string — so callers should prefer the original diagnostic from
 * `LspConnection.diagnostics` and fall back to this only when the marker came
 * from somewhere else (a Monaco worker, say).
 */
export function toLspDiagnostic(
    marker: monaco.editor.IMarkerData,
    bridge: { translateRange(model: monaco.editor.ITextModel, range: monaco.Range): Range },
    model: monaco.editor.ITextModel
): Diagnostic {
    return {
        range: bridge.translateRange(model, monaco.Range.lift(marker)),
        message: marker.message,
        severity: toLspDiagnosticSeverity(marker.severity),
        source: marker.source,
        code: typeof marker.code === 'string' ? marker.code : marker.code?.value,
    };
}
