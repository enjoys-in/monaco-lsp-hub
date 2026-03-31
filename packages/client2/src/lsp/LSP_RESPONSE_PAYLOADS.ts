// ═══════════════════════════════════════════════════════════════════════════════
// LSP Response Payloads — What the server sends back for each method
// ═══════════════════════════════════════════════════════════════════════════════
//
// This file documents the exact JSON-RPC response payload (`result` field)
// the LSP server returns for every method the client can request.
//
// Example: when client sends textDocument/hover, server responds with:
//   { "jsonrpc": "2.0", "id": 8, "result": { <-- THIS IS WHAT'S BELOW --> } }
//
// Each section matches a Monaco feature (the list from monaco.languages).
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Shared Building Blocks (used across many responses)
// ─────────────────────────────────────────────────────────────────────────────

interface Position {
    line: number;       // 0-based line number
    character: number;  // 0-based UTF-16 offset
}

interface Range {
    start: Position;
    end: Position;
}

interface Location {
    uri: string;        // e.g. "file:///workspace/main.py"
    range: Range;
}

interface LocationLink {
    originSelectionRange?: Range;   // where the user clicked
    targetUri: string;
    targetRange: Range;             // full range of target symbol
    targetSelectionRange: Range;    // name range of target symbol
}

interface TextEdit {
    range: Range;
    newText: string;
}

interface Command {
    title: string;
    command: string;
    arguments?: any[];
}

interface MarkupContent {
    kind: "plaintext" | "markdown";
    value: string;
}

type MarkedString = string | { language: string; value: string };

// ═══════════════════════════════════════════════════════════════════════════════
// 1. hover — textDocument/hover
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: user hovers over a symbol
// Server returns: documentation/type info as markdown
//
// Example response:
// {
//   "contents": { "kind": "markdown", "value": "```go\nfunc main()\n```" },
//   "range": { "start": { "line": 7, "character": 5 }, "end": { "line": 7, "character": 9 } }
// }

interface HoverResponse {
    contents: MarkupContent | MarkedString | MarkedString[];
    range?: Range;
}

type HoverResult = HoverResponse | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 2. completion — textDocument/completion
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: user types or presses Ctrl+Space
// Server returns: list of completion suggestions
//
// Example response (list form):
// {
//   "isIncomplete": false,
//   "items": [
//     { "label": "println", "kind": 3, "detail": "func println(a ...any)" }
//   ]
// }

interface CompletionItem {
    label: string;
    labelDetails?: { detail?: string; description?: string };
    kind?: CompletionItemKind;
    tags?: CompletionItemTag[];
    detail?: string;
    documentation?: string | MarkupContent;
    deprecated?: boolean;
    preselect?: boolean;
    sortText?: string;
    filterText?: string;
    insertText?: string;
    insertTextFormat?: 1 /* PlainText */ | 2 /* Snippet */;
    insertTextMode?: 1 /* asIs */ | 2 /* adjustIndentation */;
    textEdit?: TextEdit | InsertReplaceEdit;
    textEditText?: string;
    additionalTextEdits?: TextEdit[];
    commitCharacters?: string[];
    command?: Command;
    data?: any;  // opaque data for resolve
}

interface InsertReplaceEdit {
    newText: string;
    insert: Range;
    replace: Range;
}

interface CompletionList {
    isIncomplete: boolean;
    itemDefaults?: {
        commitCharacters?: string[];
        editRange?: Range | { insert: Range; replace: Range };
        insertTextFormat?: 1 | 2;
        insertTextMode?: 1 | 2;
        data?: any;
    };
    items: CompletionItem[];
}

type CompletionResult = CompletionItem[] | CompletionList | null;

// completionItem/resolve — returns a fully resolved CompletionItem
type CompletionResolveResult = CompletionItem;

enum CompletionItemKind {
    Text = 1, Method = 2, Function = 3, Constructor = 4, Field = 5,
    Variable = 6, Class = 7, Interface = 8, Module = 9, Property = 10,
    Unit = 11, Value = 12, Enum = 13, Keyword = 14, Snippet = 15,
    Color = 16, File = 17, Reference = 18, Folder = 19, EnumMember = 20,
    Constant = 21, Struct = 22, Event = 23, Operator = 24, TypeParameter = 25,
}

enum CompletionItemTag { Deprecated = 1 }

// ═══════════════════════════════════════════════════════════════════════════════
// 3. signatureHelp — textDocument/signatureHelp
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: user types ( or , inside function arguments
// Server returns: function signature with highlighted active parameter
//
// Example response:
// {
//   "signatures": [{
//     "label": "fmt.Printf(format string, a ...any)",
//     "parameters": [
//       { "label": [11, 24] },
//       { "label": [26, 35] }
//     ]
//   }],
//   "activeSignature": 0,
//   "activeParameter": 0
// }

interface SignatureHelp {
    signatures: SignatureInformation[];
    activeSignature?: number;
    activeParameter?: number;
}

interface SignatureInformation {
    label: string;
    documentation?: string | MarkupContent;
    parameters?: ParameterInformation[];
    activeParameter?: number;
}

interface ParameterInformation {
    label: string | [number, number];  // string or [startOffset, endOffset] into signature label
    documentation?: string | MarkupContent;
}

type SignatureHelpResult = SignatureHelp | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 4. definition — textDocument/definition
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: user Ctrl+Click or F12 on a symbol
// Server returns: location(s) where the symbol is defined
//
// Example response:
// { "uri": "file:///workspace/utils.go", "range": { "start": { "line": 10, "character": 5 }, ... } }
// OR array of locations, OR array of LocationLinks

type DefinitionResult = Location | Location[] | LocationLink[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 5. declaration — textDocument/declaration
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: "Go to Declaration" command
// Server returns: same shape as definition

type DeclarationResult = Location | Location[] | LocationLink[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 6. typeDefinition — textDocument/typeDefinition
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: "Go to Type Definition" — jumps to the type of a variable
// Server returns: same shape as definition

type TypeDefinitionResult = Location | Location[] | LocationLink[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 7. implementation — textDocument/implementation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: "Go to Implementation" — finds concrete implementations
// Server returns: same shape as definition

type ImplementationResult = Location | Location[] | LocationLink[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 8. references — textDocument/references
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: "Find All References" (Shift+F12)
// Server returns: all locations where the symbol is referenced
//
// Example response:
// [
//   { "uri": "file:///workspace/main.go", "range": { ... } },
//   { "uri": "file:///workspace/handler.go", "range": { ... } }
// ]

type ReferencesResult = Location[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 9. documentHighlight — textDocument/documentHighlight
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: cursor placed on a symbol — highlights all occurrences in the file
// Server returns: highlighted ranges with read/write classification
//
// Example response:
// [
//   { "range": { ... }, "kind": 2 },  // Read
//   { "range": { ... }, "kind": 3 }   // Write
// ]

interface DocumentHighlight {
    range: Range;
    kind?: DocumentHighlightKind;
}

enum DocumentHighlightKind {
    Text = 1,   // neutral occurrence
    Read = 2,   // read access
    Write = 3,  // write access
}

type DocumentHighlightResult = DocumentHighlight[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 10. documentSymbol — textDocument/documentSymbol
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: outline panel, breadcrumbs, Ctrl+Shift+O
// Server returns: hierarchical symbols OR flat symbol list
//
// Example response (hierarchical):
// [{
//   "name": "User", "kind": 23, "range": { ... }, "selectionRange": { ... },
//   "children": [
//     { "name": "Name", "kind": 8, "range": { ... }, "selectionRange": { ... } }
//   ]
// }]

interface DocumentSymbol {
    name: string;
    detail?: string;
    kind: SymbolKind;
    tags?: SymbolTag[];
    deprecated?: boolean;
    range: Range;
    selectionRange: Range;
    children?: DocumentSymbol[];
}

interface SymbolInformation {
    name: string;
    kind: SymbolKind;
    tags?: SymbolTag[];
    containerName?: string;
    deprecated?: boolean;
    location: Location;
}

enum SymbolKind {
    File = 1, Module = 2, Namespace = 3, Package = 4, Class = 5,
    Method = 6, Property = 7, Field = 8, Constructor = 9, Enum = 10,
    Interface = 11, Function = 12, Variable = 13, Constant = 14,
    String = 15, Number = 16, Boolean = 17, Array = 18, Object = 19,
    Key = 20, Null = 21, EnumMember = 22, Struct = 23, Event = 24,
    Operator = 25, TypeParameter = 26,
}

enum SymbolTag { Deprecated = 1 }

type DocumentSymbolResult = DocumentSymbol[] | SymbolInformation[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 11. codeActions — textDocument/codeAction
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: lightbulb icon, Ctrl+. quick fix menu
// Server returns: available code actions (quick fixes, refactors)
//
// Example response:
// [{
//   "title": "Organize Imports",
//   "kind": "source.organizeImports",
//   "edit": { "changes": { "file:///workspace/main.py": [{ "range": ..., "newText": ... }] } }
// }]

interface CodeAction {
    title: string;
    kind?: string;  // CodeActionKind: "quickfix" | "refactor" | "source" | ...
    diagnostics?: Diagnostic[];
    isPreferred?: boolean;
    disabled?: { reason: string };
    edit?: WorkspaceEdit;
    command?: Command;
    data?: any;  // opaque data for resolve
}

interface Diagnostic {
    range: Range;
    severity?: 1 /* Error */ | 2 /* Warning */ | 3 /* Info */ | 4 /* Hint */;
    code?: number | string;
    codeDescription?: { href: string };
    source?: string;
    message: string;
    tags?: (1 /* Unnecessary */ | 2 /* Deprecated */)[];
    relatedInformation?: { location: Location; message: string }[];
    data?: any;
}

interface WorkspaceEdit {
    changes?: { [uri: string]: TextEdit[] };
    documentChanges?: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[];
    changeAnnotations?: { [id: string]: ChangeAnnotation };
}

interface TextDocumentEdit {
    textDocument: { uri: string; version: number | null };
    edits: (TextEdit | AnnotatedTextEdit)[];
}

interface AnnotatedTextEdit extends TextEdit {
    annotationId: string;
}

interface ChangeAnnotation {
    label: string;
    needsConfirmation?: boolean;
    description?: string;
}

interface CreateFile { kind: "create"; uri: string; options?: { overwrite?: boolean; ignoreIfExists?: boolean } }
interface RenameFile { kind: "rename"; oldUri: string; newUri: string; options?: { overwrite?: boolean; ignoreIfExists?: boolean } }
interface DeleteFile { kind: "delete"; uri: string; options?: { recursive?: boolean; ignoreIfNotExists?: boolean } }

type CodeActionResult = (Command | CodeAction)[] | null;

// codeAction/resolve — returns fully resolved CodeAction (with edit populated)
type CodeActionResolveResult = CodeAction;

// ═══════════════════════════════════════════════════════════════════════════════
// 12. codeLens — textDocument/codeLens
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: automatically — shows inline metadata above functions
// Server returns: lenses (range + optional command, resolved lazily)
//
// Example response:
// [{ "range": { ... }, "command": { "title": "3 references", "command": "editor.showReferences" } }]

interface CodeLens {
    range: Range;
    command?: Command;     // may be null initially — resolved via codeLens/resolve
    data?: any;
}

type CodeLensResult = CodeLens[] | null;

// codeLens/resolve — returns CodeLens with command filled in
type CodeLensResolveResult = CodeLens;

// ═══════════════════════════════════════════════════════════════════════════════
// 13. links — textDocument/documentLink
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: automatically — makes URLs and file paths clickable
// Server returns: link ranges with optional target URIs
//
// Example response:
// [{ "range": { ... }, "target": "https://docs.docker.com/engine/reference/builder/#from" }]

interface DocumentLink {
    range: Range;
    target?: string;       // may be null initially — resolved via documentLink/resolve
    tooltip?: string;
    data?: any;
}

type DocumentLinkResult = DocumentLink[] | null;

// documentLink/resolve — returns DocumentLink with target filled in
type DocumentLinkResolveResult = DocumentLink;

// ═══════════════════════════════════════════════════════════════════════════════
// 14. color — textDocument/documentColor
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: automatically in CSS/HTML — shows color swatches inline
// Server returns: color values at ranges + presentation options
//
// Example response (documentColor):
// [{ "range": { ... }, "color": { "red": 1, "green": 0, "blue": 0, "alpha": 1 } }]

interface Color {
    red: number;    // 0.0 – 1.0
    green: number;
    blue: number;
    alpha: number;
}

interface ColorInformation {
    range: Range;
    color: Color;
}

type DocumentColorResult = ColorInformation[];

// textDocument/colorPresentation — user picks a new color, server returns text edits
interface ColorPresentation {
    label: string;                      // e.g. "rgb(255, 0, 0)"
    textEdit?: TextEdit;
    additionalTextEdits?: TextEdit[];
}

type ColorPresentationResult = ColorPresentation[];

// ═══════════════════════════════════════════════════════════════════════════════
// 15. formatting — textDocument/formatting
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: Shift+Alt+F or format on save
// Server returns: text edits to apply to the entire document
//
// Example response:
// [{ "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 5, "character": 0 } }, "newText": "..." }]

type FormattingResult = TextEdit[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 16. documentRangeFormatting — textDocument/rangeFormatting
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: format selection
// Server returns: text edits for the selected range only

type RangeFormattingResult = TextEdit[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 17. onTypeFormatting — textDocument/onTypeFormatting
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: user types a trigger character (e.g. ;, }, \n)
// Server returns: text edits to auto-format

type OnTypeFormattingResult = TextEdit[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 18. rename — textDocument/rename + textDocument/prepareRename
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: F2 on a symbol
// prepareRename: validates the symbol can be renamed, returns the word range
// rename: returns a WorkspaceEdit with all changes across files
//
// Example prepareRename response:
// { "range": { ... }, "placeholder": "oldName" }
//
// Example rename response:
// { "changes": { "file:///workspace/main.go": [{ "range": ..., "newText": "newName" }] } }

type PrepareRenameResult = Range
    | { range: Range; placeholder: string }
    | { defaultBehavior: boolean }
    | null;

type RenameResult = WorkspaceEdit | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 19. foldingRange — textDocument/foldingRange
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: automatically — provides collapsible regions in the gutter
// Server returns: line ranges that can fold
//
// Example response:
// [{ "startLine": 5, "endLine": 10, "kind": "region" }]

interface FoldingRange {
    startLine: number;
    startCharacter?: number;
    endLine: number;
    endCharacter?: number;
    kind?: "comment" | "imports" | "region";
    collapsedText?: string;
}

type FoldingRangeResult = FoldingRange[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 20. selectionRange — textDocument/selectionRange
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: "Expand Selection" (Shift+Alt+Right)
// Server returns: nested selection ranges (innermost → outermost)
//
// Example response:
// [{
//   "range": { ... },   // word
//   "parent": {
//     "range": { ... }, // expression
//     "parent": {
//       "range": { ... } // statement
//     }
//   }
// }]

interface SelectionRange {
    range: Range;
    parent?: SelectionRange;  // each level expands outward
}

type SelectionRangeResult = SelectionRange[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 21. semanticTokens — textDocument/semanticTokens/full
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: automatically — provides rich syntax highlighting
// Server returns: encoded token array (5 integers per token)
//   [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
//
// Example response:
// { "resultId": "1", "data": [0, 5, 3, 0, 0, 1, 0, 4, 1, 0] }

interface SemanticTokens {
    resultId?: string;
    data: number[];  // flat array: groups of 5 integers per token
}

type SemanticTokensFullResult = SemanticTokens | null;

// textDocument/semanticTokens/full/delta — sends only changes since last request
interface SemanticTokensDelta {
    resultId?: string;
    edits: SemanticTokensEdit[];
}

interface SemanticTokensEdit {
    start: number;
    deleteCount: number;
    data?: number[];
}

type SemanticTokensDeltaResult = SemanticTokens | SemanticTokensDelta | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 22. rangeSemanticTokens — textDocument/semanticTokens/range
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: for visible range only (performance optimization)
// Server returns: same format as full semantic tokens, but for a range

type RangeSemanticTokensResult = SemanticTokens | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 23. inlayHints — textDocument/inlayHint
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: automatically — shows inline type annotations, parameter names
// Server returns: hints at specific positions
//
// Example response:
// [{
//   "position": { "line": 3, "character": 10 },
//   "label": ": string",
//   "kind": 1,            // 1=Type, 2=Parameter
//   "paddingLeft": true
// }]

interface InlayHint {
    position: Position;
    label: string | InlayHintLabelPart[];
    kind?: 1 /* Type */ | 2 /* Parameter */;
    textEdits?: TextEdit[];
    tooltip?: string | MarkupContent;
    paddingLeft?: boolean;
    paddingRight?: boolean;
    data?: any;
}

interface InlayHintLabelPart {
    value: string;
    tooltip?: string | MarkupContent;
    location?: Location;
    command?: Command;
}

type InlayHintResult = InlayHint[] | null;

// inlayHint/resolve — returns InlayHint with tooltip/location resolved
type InlayHintResolveResult = InlayHint;

// ═══════════════════════════════════════════════════════════════════════════════
// 24. inlineCompletions — textDocument/inlineCompletion (proposed LSP 3.18)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: ghost text / Copilot-style inline suggestions
// Server returns: inline completion items
//
// Example response:
// { "items": [{ "insertText": "fmt.Println(\"hello\")", "range": { ... } }] }

interface InlineCompletionItem {
    insertText: string | { kind: "snippet"; value: string };
    filterText?: string;
    range?: Range;
    command?: Command;
}

interface InlineCompletionList {
    items: InlineCompletionItem[];
}

type InlineCompletionResult = InlineCompletionList | InlineCompletionItem[] | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 25. linkedEditingRange — textDocument/linkedEditingRange
// ═══════════════════════════════════════════════════════════════════════════════
//
// Triggered: cursor on HTML tag name — edits both open and close tag
// Server returns: linked ranges that should be edited together
//
// Example response:
// { "ranges": [{ "start": { "line": 0, "character": 1 }, ... }, { "start": { "line": 5, "character": 2 }, ... }] }

interface LinkedEditingRanges {
    ranges: Range[];
    wordPattern?: string;  // regex for valid edits
}

type LinkedEditingRangeResult = LinkedEditingRanges | null;

// ═══════════════════════════════════════════════════════════════════════════════
// 26. languageConfiguration — NOT an LSP method
// ═══════════════════════════════════════════════════════════════════════════════
//
// This is a Monaco-only concept (monaco.languages.setLanguageConfiguration).
// It controls bracket matching, auto-closing pairs, comments, indentation rules.
// It does NOT come from the LSP server — it's configured statically in the client.

// ═══════════════════════════════════════════════════════════════════════════════
// 27. themes — NOT an LSP method
// ═══════════════════════════════════════════════════════════════════════════════
//
// Monaco themes (monaco.editor.defineTheme) are client-side only.
// Semantic token types/modifiers from the LSP server map to theme colors,
// but the theme itself is not an LSP response.

// ═══════════════════════════════════════════════════════════════════════════════
// 28. commands — NOT a document method
// ═══════════════════════════════════════════════════════════════════════════════
//
// workspace/executeCommand — executes a server command (often from CodeAction/CodeLens)
// Server returns: any | null (command-specific result)
//
// Example: a CodeLens with command "editor.showReferences" — client executes locally.
// Some commands are sent to the server for execution.

type ExecuteCommandResult = any | null;

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// SERVER → CLIENT (reverse direction)
// These are requests/notifications the LSP server sends TO the client.
// The client must handle them and return the expected response.
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// 29. workspace/applyEdit — Server asks client to apply a WorkspaceEdit
// ═══════════════════════════════════════════════════════════════════════════════
//
// Direction: server → client (REQUEST — expects a response)
// Triggered: server wants to modify files (e.g. from a code action, rename refactor)
// Server sends: the edit to apply
// Client returns: whether it was applied successfully
//
// Example server request:
// {
//   "label": "Rename symbol",
//   "edit": {
//     "changes": {
//       "file:///workspace/main.py": [
//         { "range": { "start": { "line": 3, "character": 4 }, "end": { "line": 3, "character": 7 } }, "newText": "newName" },
//         { "range": { "start": { "line": 10, "character": 12 }, "end": { "line": 10, "character": 15 } }, "newText": "newName" }
//       ]
//     }
//   }
// }
//
// Client response:
// { "applied": true }

interface ApplyWorkspaceEditParams {
    label?: string;         // human-readable label (shown in undo stack)
    edit: WorkspaceEdit;    // the edits to apply across files
}

interface ApplyWorkspaceEditResult {
    applied: boolean;
    failureReason?: string;
    failedChange?: number;  // index of the change that failed
}

// ═══════════════════════════════════════════════════════════════════════════════
// 30. workspace/configuration — Server pulls config settings from client
// ═══════════════════════════════════════════════════════════════════════════════
//
// Direction: server → client (REQUEST — expects a response)
// Triggered: server needs settings (e.g. Pyright asks for python.analysis.*)
// Server sends: list of config sections it wants
// Client returns: array of config objects (one per item, same order)
//
// Example server request:
// {
//   "items": [
//     { "scopeUri": "file:///workspace", "section": "python.analysis" },
//     { "scopeUri": "file:///workspace", "section": "python" }
//   ]
// }
//
// Client response (array, one entry per item):
// [ { "typeCheckingMode": "basic" }, { "pythonPath": "/usr/bin/python3" } ]
//
// If the client has no config, return empty objects: [ {}, {} ]

interface ConfigurationParams {
    items: ConfigurationItem[];
}

interface ConfigurationItem {
    scopeUri?: string;  // the scope (file/folder URI) to get config for
    section?: string;   // the config section name (e.g. "python.analysis")
}

type ConfigurationResult = any[];  // one value per ConfigurationItem, in order

// ═══════════════════════════════════════════════════════════════════════════════
// 31. window/workDoneProgress/create — Server registers a progress token
// ═══════════════════════════════════════════════════════════════════════════════
//
// Direction: server → client (REQUEST — expects null response)
// Triggered: server wants to report progress for a long-running operation
// Server sends: a progress token to use in subsequent $/progress notifications
// Client returns: null (just acknowledges)
//
// Example server request:
// { "token": "pyright-indexing-1" }
//
// Client response: null

interface WorkDoneProgressCreateParams {
    token: string | number;  // the progress token to track
}

type WorkDoneProgressCreateResult = null;

// ═══════════════════════════════════════════════════════════════════════════════
// 32. $/progress — Server reports progress updates
// ═══════════════════════════════════════════════════════════════════════════════
//
// Direction: server → client (NOTIFICATION — no response)
// Triggered: server reports indexing/analysis progress
// Lifecycle: begin → report (0..n) → end
//
// Example begin:
// { "token": "pyright-indexing-1", "value": { "kind": "begin", "title": "Indexing", "percentage": 0 } }
//
// Example report:
// { "token": "pyright-indexing-1", "value": { "kind": "report", "message": "src/main.py", "percentage": 45 } }
//
// Example end:
// { "token": "pyright-indexing-1", "value": { "kind": "end", "message": "Indexing complete" } }

interface ProgressParams {
    token: string | number;
    value: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd;
}

interface WorkDoneProgressBegin {
    kind: 'begin';
    title: string;          // e.g. "Indexing" or "Analyzing"
    cancellable?: boolean;
    message?: string;       // e.g. "3/25 files"
    percentage?: number;    // 0–100
}

interface WorkDoneProgressReport {
    kind: 'report';
    cancellable?: boolean;
    message?: string;
    percentage?: number;
}

interface WorkDoneProgressEnd {
    kind: 'end';
    message?: string;       // e.g. "Indexing complete"
}

// ═══════════════════════════════════════════════════════════════════════════════
// 33. textDocument/publishDiagnostics — Server pushes diagnostics to client
// ═══════════════════════════════════════════════════════════════════════════════
//
// Direction: server → client (NOTIFICATION — no response)
// Triggered: server finishes analyzing a file and reports errors/warnings
// This is the PUSH model — server sends diagnostics whenever they change
//
// Example notification:
// {
//   "uri": "file:///workspace/main.py",
//   "version": 3,
//   "diagnostics": [
//     {
//       "range": { "start": { "line": 5, "character": 0 }, "end": { "line": 5, "character": 10 } },
//       "severity": 1,
//       "source": "Pyright",
//       "message": "\"foo\" is not defined"
//     }
//   ]
// }

interface PublishDiagnosticsParams {
    uri: string;
    version?: number;
    diagnostics: Diagnostic[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 34. textDocument/diagnostic — Client PULLS diagnostics from server
// ═══════════════════════════════════════════════════════════════════════════════
//
// Direction: client → server (REQUEST)
// Triggered: client requests diagnostics (pull model, LSP 3.17)
// Alternative to push (publishDiagnostics) — client controls when to fetch
//
// Example request params:
// { "textDocument": { "uri": "file:///workspace/main.py" } }
//
// Example response (full report):
// {
//   "kind": "full",
//   "resultId": "abc123",
//   "items": [
//     { "range": { ... }, "severity": 1, "message": "..." }
//   ]
// }
//
// Example response (unchanged):
// { "kind": "unchanged", "resultId": "abc123" }

interface FullDocumentDiagnosticReport {
    kind: 'full';
    resultId?: string;
    items: Diagnostic[];
}

interface UnchangedDocumentDiagnosticReport {
    kind: 'unchanged';
    resultId: string;
}

type DocumentDiagnosticResult = FullDocumentDiagnosticReport | UnchangedDocumentDiagnosticReport;

// ═══════════════════════════════════════════════════════════════════════════════
// 35. window/showMessage — Server shows a message to the user
// ═══════════════════════════════════════════════════════════════════════════════
//
// Direction: server → client (NOTIFICATION — no response)
// Triggered: server wants to display an info/warning/error message
//
// Example: { "type": 3, "message": "Pyright analysis complete" }

interface ShowMessageParams {
    type: MessageType;
    message: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 36. window/showMessageRequest — Server shows a message with action buttons
// ═══════════════════════════════════════════════════════════════════════════════
//
// Direction: server → client (REQUEST — expects selected action or null)
// Triggered: server needs user to choose between options
//
// Example request:
// { "type": 1, "message": "Update config?", "actions": [{ "title": "Yes" }, { "title": "No" }] }
//
// Client response: { "title": "Yes" } or null if dismissed

interface ShowMessageRequestParams {
    type: MessageType;
    message: string;
    actions?: MessageActionItem[];
}

interface MessageActionItem {
    title: string;
}

type ShowMessageRequestResult = MessageActionItem | null;

enum MessageType {
    Error = 1,
    Warning = 2,
    Info = 3,
    Log = 4,
    Debug = 5,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 37. window/logMessage — Server logs a message
// ═══════════════════════════════════════════════════════════════════════════════
//
// Direction: server → client (NOTIFICATION — no response)
// Triggered: server wants to log debug/info output
//
// Example: { "type": 4, "message": "[pyright] Searching for imports..." }

interface LogMessageParams {
    type: MessageType;
    message: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Summary Table
// ═══════════════════════════════════════════════════════════════════════════════
//
// ┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
// │ CLIENT → SERVER (requests the client sends, responses it receives)                                     │
// ├──────────────────────────┬──────────────────────────────────┬───────────────────────────────────────────┤
// │ Monaco Feature           │ LSP Method                       │ Response Payload (result field)            │
// ├──────────────────────────┼──────────────────────────────────┼───────────────────────────────────────────┤
// │ hover                    │ textDocument/hover               │ Hover | null                              │
// │ completion               │ textDocument/completion          │ CompletionItem[] | CompletionList | null  │
// │  └─ resolve              │ completionItem/resolve           │ CompletionItem                            │
// │ signatureHelp            │ textDocument/signatureHelp       │ SignatureHelp | null                      │
// │ definition               │ textDocument/definition          │ Location | Location[] | LocationLink[]    │
// │ declaration              │ textDocument/declaration         │ Location | Location[] | LocationLink[]    │
// │ typeDefinition           │ textDocument/typeDefinition      │ Location | Location[] | LocationLink[]    │
// │ implementation           │ textDocument/implementation      │ Location | Location[] | LocationLink[]    │
// │ references               │ textDocument/references          │ Location[] | null                         │
// │ documentHighlight        │ textDocument/documentHighlight   │ DocumentHighlight[] | null                │
// │ documentSymbol           │ textDocument/documentSymbol      │ DocumentSymbol[] | SymbolInformation[]    │
// │ codeActions              │ textDocument/codeAction          │ (Command | CodeAction)[] | null           │
// │  └─ resolve              │ codeAction/resolve               │ CodeAction                                │
// │ codeLens                 │ textDocument/codeLens            │ CodeLens[] | null                         │
// │  └─ resolve              │ codeLens/resolve                 │ CodeLens                                  │
// │ links                    │ textDocument/documentLink        │ DocumentLink[] | null                     │
// │  └─ resolve              │ documentLink/resolve             │ DocumentLink                              │
// │ color                    │ textDocument/documentColor       │ ColorInformation[]                        │
// │  └─ presentations        │ textDocument/colorPresentation   │ ColorPresentation[]                       │
// │ formatting               │ textDocument/formatting          │ TextEdit[] | null                         │
// │ documentRangeFormatting  │ textDocument/rangeFormatting     │ TextEdit[] | null                         │
// │ onTypeFormatting         │ textDocument/onTypeFormatting    │ TextEdit[] | null                         │
// │ rename                   │ textDocument/rename              │ WorkspaceEdit | null                      │
// │  └─ prepare              │ textDocument/prepareRename       │ Range | {range,placeholder} | null        │
// │ foldingRange             │ textDocument/foldingRange        │ FoldingRange[] | null                     │
// │ selectionRange           │ textDocument/selectionRange      │ SelectionRange[] | null                   │
// │ semanticTokens           │ textDocument/semanticTokens/full │ SemanticTokens | null                     │
// │  └─ delta                │ .../semanticTokens/full/delta    │ SemanticTokens | SemanticTokensDelta      │
// │ rangeSemanticTokens      │ .../semanticTokens/range         │ SemanticTokens | null                     │
// │ inlayHints               │ textDocument/inlayHint           │ InlayHint[] | null                        │
// │  └─ resolve              │ inlayHint/resolve                │ InlayHint                                 │
// │ inlineCompletions        │ textDocument/inlineCompletion    │ InlineCompletionList | null               │
// │ linkedEditingRange       │ textDocument/linkedEditingRange  │ LinkedEditingRanges | null                │
// │ diagnostics (pull)       │ textDocument/diagnostic          │ FullReport | UnchangedReport              │
// │ commands                 │ workspace/executeCommand          │ any | null                                │
// │ languageConfiguration    │ —  (client-side only)            │ —                                         │
// │ themes                   │ —  (client-side only)            │ —                                         │
// ├──────────────────────────┴──────────────────────────────────┴───────────────────────────────────────────┤
// │ SERVER → CLIENT (requests/notifications the server sends, client handles)                               │
// ├──────────────────────────┬──────────────────────────────────┬───────────────────────────────────────────┤
// │ Feature                  │ LSP Method                       │ Payload / Client Response                  │
// ├──────────────────────────┼──────────────────────────────────┼───────────────────────────────────────────┤
// │ applyEdit                │ workspace/applyEdit              │ REQ → {applied, failureReason?}           │
// │ configuration            │ workspace/configuration          │ REQ → any[] (one per item)                │
// │ progressCreate           │ window/workDoneProgress/create   │ REQ → null                                │
// │ progress                 │ $/progress                       │ NOTIF: {token, value: begin|report|end}   │
// │ diagnostics (push)       │ textDocument/publishDiagnostics  │ NOTIF: {uri, diagnostics[]}               │
// │ showMessage              │ window/showMessage               │ NOTIF: {type, message}                    │
// │ showMessageRequest       │ window/showMessageRequest        │ REQ → MessageActionItem | null            │
// │ logMessage               │ window/logMessage                │ NOTIF: {type, message}                    │
// └──────────────────────────┴──────────────────────────────────┴───────────────────────────────────────────┘
//
// Note: "result" is the value inside the JSON-RPC response:
//   { "jsonrpc": "2.0", "id": <number>, "result": <THE PAYLOAD ABOVE> }
//
// Notifications have no "id" and no response:
//   { "jsonrpc": "2.0", "method": "...", "params": <THE PAYLOAD ABOVE> }

export type {};
