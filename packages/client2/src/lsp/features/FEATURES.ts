/**
 * LSP Feature Reference — Maps each feature to its LSP method, Monaco provider, and conversion flow.
 *
 * Each feature follows the same pattern:
 *   1. Register client capabilities (what the client supports)
 *   2. Register a capability handler (fires when server reports support)
 *   3. Handler calls `monaco.languages.registerXxxProvider(selector, provider)`
 *   4. Provider method: translates Monaco position → LSP params → calls server → converts LSP result → Monaco result
 *
 * ┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌─────────────┐
 * │ Monaco calls │ ──► │ Provider method   │ ──► │ LSP server call  │ ──► │ LSP result   │
 * │ provideXxx() │     │ translate()       │     │ textDocument/xxx │     │ (JSON-RPC)   │
 * └─────────────┘     └──────────────────┘     └──────────────────┘     └──────┬──────┘
 *                                                                               │
 *                     ┌──────────────────┐     ┌──────────────────┐            │
 *                     │ Monaco renders   │ ◄── │ Convert LSP→Monaco│ ◄──────────┘
 *                     │ (tooltip, list…) │     │ (common.ts)      │
 *                     └──────────────────┘     └──────────────────┘
 */

// ─────────────────────────────────────────────────────────────────────────────
// Feature Map — All 22 implemented features
// ─────────────────────────────────────────────────────────────────────────────

export interface LspFeatureDescriptor {
    /** Feature class name */
    feature: string;
    /** File path relative to features/ */
    file: string;
    /** Monaco registration call */
    monacoRegister: string;
    /** Monaco provider interface implemented */
    monacoProvider: string;
    /** Monaco provider method(s) called by the editor */
    monacoMethod: string;
    /** Monaco return type from the provider method */
    monacoReturnType: string;
    /** LSP server method called (on this._client.server) */
    lspMethod: string;
    /** LSP return type from the server */
    lspReturnType: string;
    /** Capability key in LspCapabilitiesRegistry */
    capabilityKey: string;
    /** ServerCapabilities field that enables this feature */
    serverCapField: string;
    /** Converter functions used from common.ts */
    converters: string[];
}

/**
 * Complete mapping of all 22 LSP features.
 *
 * Usage:
 *   - To understand what a feature does: look up its entry
 *   - To add a new feature: follow the same pattern
 *   - To debug: check the LSP method, expected return type, and converter
 */
export const LSP_FEATURES: LspFeatureDescriptor[] = [

    // ── Navigation ───────────────────────────────────────────────────────

    {
        feature: "LspDefinitionFeature",
        file: "LspDefinitionFeature.ts",
        monacoRegister: "monaco.languages.registerDefinitionProvider",
        monacoProvider: "monaco.languages.DefinitionProvider",
        monacoMethod: "provideDefinition",
        monacoReturnType: "Definition | LocationLink[] | null",
        lspMethod: "textDocumentDefinition",
        lspReturnType: "Location | Location[] | LocationLink[] | null",
        capabilityKey: "capabilities.textDocumentDefinition",
        serverCapField: "definitionProvider",
        converters: ["toMonacoLocation"],
    },
    {
        feature: "LspDeclarationFeature",
        file: "LspDeclarationFeature.ts",
        monacoRegister: "monaco.languages.registerDeclarationProvider",
        monacoProvider: "monaco.languages.DeclarationProvider",
        monacoMethod: "provideDeclaration",
        monacoReturnType: "Definition | LocationLink[] | null",
        lspMethod: "textDocumentDeclaration",
        lspReturnType: "Location | Location[] | LocationLink[] | null",
        capabilityKey: "capabilities.textDocumentDeclaration",
        serverCapField: "declarationProvider",
        converters: ["toMonacoLocation"],
    },
    {
        feature: "LspTypeDefinitionFeature",
        file: "LspTypeDefinitionFeature.ts",
        monacoRegister: "monaco.languages.registerTypeDefinitionProvider",
        monacoProvider: "monaco.languages.TypeDefinitionProvider",
        monacoMethod: "provideTypeDefinition",
        monacoReturnType: "Definition | LocationLink[] | null",
        lspMethod: "textDocumentTypeDefinition",
        lspReturnType: "Location | Location[] | LocationLink[] | null",
        capabilityKey: "capabilities.textDocumentTypeDefinition",
        serverCapField: "typeDefinitionProvider",
        converters: ["toMonacoLocation"],
    },
    {
        feature: "LspImplementationFeature",
        file: "LspImplementationFeature.ts",
        monacoRegister: "monaco.languages.registerImplementationProvider",
        monacoProvider: "monaco.languages.ImplementationProvider",
        monacoMethod: "provideImplementation",
        monacoReturnType: "Definition | LocationLink[] | null",
        lspMethod: "textDocumentImplementation",
        lspReturnType: "Location | Location[] | LocationLink[] | null",
        capabilityKey: "capabilities.textDocumentImplementation",
        serverCapField: "implementationProvider",
        converters: ["toMonacoLocation"],
    },
    {
        feature: "LspReferencesFeature",
        file: "LspReferencesFeature.ts",
        monacoRegister: "monaco.languages.registerReferenceProvider",
        monacoProvider: "monaco.languages.ReferenceProvider",
        monacoMethod: "provideReferences",
        monacoReturnType: "Location[] | null",
        lspMethod: "textDocumentReferences",
        lspReturnType: "Location[] | null",
        capabilityKey: "capabilities.textDocumentReferences",
        serverCapField: "referencesProvider",
        converters: [],
    },

    // ── Intelligence ─────────────────────────────────────────────────────

    {
        feature: "LspHoverFeature",
        file: "LspHoverFeature.ts",
        monacoRegister: "monaco.languages.registerHoverProvider",
        monacoProvider: "monaco.languages.HoverProvider",
        monacoMethod: "provideHover",
        monacoReturnType: "Hover | null",
        lspMethod: "textDocumentHover",
        lspReturnType: "Hover | null  (contents: MarkupContent | MarkedString | MarkedString[])",
        capabilityKey: "capabilities.textDocumentHover",
        serverCapField: "hoverProvider",
        converters: ["toMonacoMarkdownString (local)"],
    },
    {
        feature: "LspCompletionFeature",
        file: "LspCompletionFeature.ts",
        monacoRegister: "monaco.languages.registerCompletionItemProvider",
        monacoProvider: "monaco.languages.CompletionItemProvider",
        monacoMethod: "provideCompletionItems + resolveCompletionItem",
        monacoReturnType: "CompletionList",
        lspMethod: "textDocumentCompletion + completionItemResolve",
        lspReturnType: "CompletionItem[] | CompletionList | null",
        capabilityKey: "capabilities.textDocumentCompletion",
        serverCapField: "completionProvider",
        converters: ["toMonacoCompletionItemKind", "toMonacoCompletionItemTag", "toLspCompletionTriggerKind", "toMonacoInsertTextRules", "toMonacoCommand"],
    },
    {
        feature: "LspSignatureHelpFeature",
        file: "LspSignatureHelpFeature.ts",
        monacoRegister: "monaco.languages.registerSignatureHelpProvider",
        monacoProvider: "monaco.languages.SignatureHelpProvider",
        monacoMethod: "provideSignatureHelp",
        monacoReturnType: "SignatureHelpResult | null",
        lspMethod: "textDocumentSignatureHelp",
        lspReturnType: "SignatureHelp | null",
        capabilityKey: "capabilities.textDocumentSignatureHelp",
        serverCapField: "signatureHelpProvider",
        converters: ["toLspSignatureHelpTriggerKind"],
    },

    // ── Diagnostics ──────────────────────────────────────────────────────

    {
        feature: "LspDiagnosticsFeature",
        file: "LspDiagnosticsFeature.ts",
        monacoRegister: "monaco.editor.setModelMarkers (push) — no registerXxxProvider",
        monacoProvider: "N/A — handles textDocument/publishDiagnostics notification + pull via textDocumentDiagnostic",
        monacoMethod: "N/A — notification-driven + pull-driven",
        monacoReturnType: "monaco.editor.IMarkerData[] (via setModelMarkers)",
        lspMethod: "textDocument/publishDiagnostics (push) + textDocumentDiagnostic (pull)",
        lspReturnType: "PublishDiagnosticsParams (push) | DocumentDiagnosticReport (pull)",
        capabilityKey: "capabilities.textDocumentDiagnostic (pull) + api.client notification (push)",
        serverCapField: "diagnosticProvider (pull)",
        converters: ["toDiagnosticMarker", "toMonacoDiagnosticSeverity", "toMonacoDiagnosticTag", "matchesDocumentSelector"],
    },

    // ── Symbols & Highlights ─────────────────────────────────────────────

    {
        feature: "LspDocumentSymbolFeature",
        file: "LspDocumentSymbolFeature.ts",
        monacoRegister: "monaco.languages.registerDocumentSymbolProvider",
        monacoProvider: "monaco.languages.DocumentSymbolProvider",
        monacoMethod: "provideDocumentSymbols",
        monacoReturnType: "DocumentSymbol[] | null",
        lspMethod: "textDocumentDocumentSymbol",
        lspReturnType: "DocumentSymbol[] | SymbolInformation[] | null",
        capabilityKey: "capabilities.textDocumentDocumentSymbol",
        serverCapField: "documentSymbolProvider",
        converters: ["toMonacoSymbolKind", "toMonacoSymbolTag"],
    },
    {
        feature: "LspDocumentHighlightFeature",
        file: "LspDocumentHighlightFeature.ts",
        monacoRegister: "monaco.languages.registerDocumentHighlightProvider",
        monacoProvider: "monaco.languages.DocumentHighlightProvider",
        monacoMethod: "provideDocumentHighlights",
        monacoReturnType: "DocumentHighlight[] | null",
        lspMethod: "textDocumentDocumentHighlight",
        lspReturnType: "DocumentHighlight[] | null",
        capabilityKey: "capabilities.textDocumentDocumentHighlight",
        serverCapField: "documentHighlightProvider",
        converters: ["toMonacoDocumentHighlightKind"],
    },

    // ── Code Actions & Lens ──────────────────────────────────────────────

    {
        feature: "LspCodeActionFeature",
        file: "LspCodeActionFeature.ts",
        monacoRegister: "monaco.languages.registerCodeActionProvider",
        monacoProvider: "monaco.languages.CodeActionProvider",
        monacoMethod: "provideCodeActions + resolveCodeAction",
        monacoReturnType: "CodeActionList | null",
        lspMethod: "textDocumentCodeAction + codeActionResolve",
        lspReturnType: "(Command | CodeAction)[] | null",
        capabilityKey: "capabilities.textDocumentCodeAction",
        serverCapField: "codeActionProvider",
        converters: ["toMonacoCodeActionKind", "toLspDiagnosticSeverity", "toLspCodeActionTriggerKind", "toMonacoCommand"],
    },
    {
        feature: "LspCodeLensFeature",
        file: "LspCodeLensFeature.ts",
        monacoRegister: "monaco.languages.registerCodeLensProvider",
        monacoProvider: "monaco.languages.CodeLensProvider",
        monacoMethod: "provideCodeLenses + resolveCodeLens",
        monacoReturnType: "CodeLensList | null",
        lspMethod: "textDocumentCodeLens + codeLensResolve",
        lspReturnType: "CodeLens[] | null",
        capabilityKey: "capabilities.textDocumentCodeLens",
        serverCapField: "codeLensProvider",
        converters: ["toMonacoCommand"],
    },

    // ── Formatting ───────────────────────────────────────────────────────

    {
        feature: "LspFormattingFeature",
        file: "LspFormattingFeature.ts",
        monacoRegister: "monaco.languages.registerDocumentFormattingEditProvider",
        monacoProvider: "monaco.languages.DocumentFormattingEditProvider",
        monacoMethod: "provideDocumentFormattingEdits",
        monacoReturnType: "TextEdit[] | null",
        lspMethod: "textDocumentFormatting",
        lspReturnType: "TextEdit[] | null",
        capabilityKey: "capabilities.textDocumentFormatting",
        serverCapField: "documentFormattingProvider",
        converters: [],
    },
    {
        feature: "LspRangeFormattingFeature",
        file: "LspRangeFormattingFeature.ts",
        monacoRegister: "monaco.languages.registerDocumentRangeFormattingEditProvider",
        monacoProvider: "monaco.languages.DocumentRangeFormattingEditProvider",
        monacoMethod: "provideDocumentRangeFormattingEdits",
        monacoReturnType: "TextEdit[] | null",
        lspMethod: "textDocumentRangeFormatting",
        lspReturnType: "TextEdit[] | null",
        capabilityKey: "capabilities.textDocumentRangeFormatting",
        serverCapField: "documentRangeFormattingProvider",
        converters: [],
    },
    {
        feature: "LspOnTypeFormattingFeature",
        file: "LspOnTypeFormattingFeature.ts",
        monacoRegister: "monaco.languages.registerOnTypeFormattingEditProvider",
        monacoProvider: "monaco.languages.OnTypeFormattingEditProvider",
        monacoMethod: "provideOnTypeFormattingEdits",
        monacoReturnType: "TextEdit[] | null",
        lspMethod: "textDocumentOnTypeFormatting",
        lspReturnType: "TextEdit[] | null",
        capabilityKey: "capabilities.textDocumentOnTypeFormatting",
        serverCapField: "documentOnTypeFormattingProvider",
        converters: [],
    },

    // ── Rename ───────────────────────────────────────────────────────────

    {
        feature: "LspRenameFeature",
        file: "LspRenameFeature.ts",
        monacoRegister: "monaco.languages.registerRenameProvider",
        monacoProvider: "monaco.languages.RenameProvider",
        monacoMethod: "provideRenameEdits + resolveRenameLocation",
        monacoReturnType: "WorkspaceEdit | null (rename) + RenameLocation | null (prepare)",
        lspMethod: "textDocumentRename + textDocumentPrepareRename",
        lspReturnType: "WorkspaceEdit | null (rename) + Range | {range,placeholder} | null (prepare)",
        capabilityKey: "capabilities.textDocumentRename",
        serverCapField: "renameProvider",
        converters: ["toMonacoWorkspaceEdit (local)"],
    },

    // ── Links & Folding ──────────────────────────────────────────────────

    {
        feature: "LspDocumentLinkFeature",
        file: "LspDocumentLinkFeature.ts",
        monacoRegister: "monaco.languages.registerLinkProvider",
        monacoProvider: "monaco.languages.LinkProvider",
        monacoMethod: "provideLinks + resolveLink",
        monacoReturnType: "ILinksList | null",
        lspMethod: "textDocumentDocumentLink",
        lspReturnType: "DocumentLink[] | null",
        capabilityKey: "capabilities.textDocumentDocumentLink",
        serverCapField: "documentLinkProvider",
        converters: [],
    },
    {
        feature: "LspFoldingRangeFeature",
        file: "LspFoldingRangeFeature.ts",
        monacoRegister: "monaco.languages.registerFoldingRangeProvider",
        monacoProvider: "monaco.languages.FoldingRangeProvider",
        monacoMethod: "provideFoldingRanges",
        monacoReturnType: "FoldingRange[] | null",
        lspMethod: "textDocumentFoldingRange",
        lspReturnType: "FoldingRange[] | null",
        capabilityKey: "capabilities.textDocumentFoldingRange",
        serverCapField: "foldingRangeProvider",
        converters: ["toMonacoFoldingRangeKind"],
    },
    {
        feature: "LspSelectionRangeFeature",
        file: "LspSelectionRangeFeature.ts",
        monacoRegister: "monaco.languages.registerSelectionRangeProvider",
        monacoProvider: "monaco.languages.SelectionRangeProvider",
        monacoMethod: "provideSelectionRanges",
        monacoReturnType: "SelectionRange[][] | null",
        lspMethod: "textDocumentSelectionRange",
        lspReturnType: "SelectionRange[] | null",
        capabilityKey: "capabilities.textDocumentSelectionRange",
        serverCapField: "selectionRangeProvider",
        converters: [],
    },

    // ── Semantic Tokens & Inlay Hints ────────────────────────────────────

    {
        feature: "LspSemanticTokensFeature",
        file: "LspSemanticTokensFeature.ts",
        monacoRegister: "monaco.languages.registerDocumentSemanticTokensProvider",
        monacoProvider: "monaco.languages.DocumentSemanticTokensProvider",
        monacoMethod: "provideDocumentSemanticTokens + getLegend + releaseDocumentSemanticTokens",
        monacoReturnType: "SemanticTokens | SemanticTokensEdits | null",
        lspMethod: "textDocumentSemanticTokensFull + textDocumentSemanticTokensFullDelta",
        lspReturnType: "SemanticTokens | SemanticTokensDelta | null",
        capabilityKey: "capabilities.textDocumentSemanticTokensFull",
        serverCapField: "semanticTokensProvider",
        converters: [],
    },
    {
        feature: "LspInlayHintsFeature",
        file: "LspInlayHintsFeature.ts",
        monacoRegister: "monaco.languages.registerInlayHintsProvider",
        monacoProvider: "monaco.languages.InlayHintsProvider",
        monacoMethod: "provideInlayHints + resolveInlayHint",
        monacoReturnType: "InlayHintList | null",
        lspMethod: "textDocumentInlayHint + inlayHintResolve",
        lspReturnType: "InlayHint[] | null",
        capabilityKey: "capabilities.textDocumentInlayHint",
        serverCapField: "inlayHintProvider",
        converters: ["toMonacoInlayHintKind", "toMonacoCommand"],
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities registered but NO feature file yet
// ─────────────────────────────────────────────────────────────────────────────

export interface UnimplementedCapability {
    capabilityKey: string;
    serverCapField: string;
    monacoRegister: string | null;
    notes: string;
}

export const UNIMPLEMENTED_CAPABILITIES: UnimplementedCapability[] = [
    {
        capabilityKey: "capabilities.textDocumentDocumentColor",
        serverCapField: "colorProvider",
        monacoRegister: "monaco.languages.registerColorProvider",
        notes: "Color picker (CSS, etc.) — easy to add, Monaco has direct support",
    },
    {
        capabilityKey: "capabilities.textDocumentLinkedEditingRange",
        serverCapField: "linkedEditingRangeProvider",
        monacoRegister: "monaco.languages.registerLinkedEditingRangeProvider",
        notes: "Linked editing (e.g. rename HTML open+close tags simultaneously)",
    },
    {
        capabilityKey: "capabilities.textDocumentPrepareCallHierarchy",
        serverCapField: "callHierarchyProvider",
        monacoRegister: null,
        notes: "Call hierarchy — needs custom panel UI (incoming/outgoing calls)",
    },
    {
        capabilityKey: "capabilities.textDocumentInlineValue",
        serverCapField: "inlineValueProvider",
        monacoRegister: "monaco.languages.registerInlineValuesProvider",
        notes: "Debug inline values — shown next to variables during debugging",
    },
    {
        capabilityKey: "capabilities.textDocumentDiagnostic",
        serverCapField: "diagnosticProvider",
        monacoRegister: null,
        notes: "Pull-model diagnostics (LSP 3.17) — already partial in LspDiagnosticsFeature",
    },
    {
        capabilityKey: "capabilities.textDocumentMoniker",
        serverCapField: "monikerProvider",
        monacoRegister: null,
        notes: "Cross-project symbol linking — rarely used by servers",
    },
    {
        capabilityKey: "capabilities.textDocumentPrepareTypeHierarchy",
        serverCapField: "typeHierarchyProvider",
        monacoRegister: null,
        notes: "Type hierarchy — needs custom panel UI (supertypes/subtypes)",
    },
    {
        capabilityKey: "capabilities.workspaceSymbol",
        serverCapField: "workspaceSymbolProvider",
        monacoRegister: null,
        notes: "Workspace-wide symbol search — needs search input UI",
    },
    {
        capabilityKey: "capabilities.workspaceExecuteCommand",
        serverCapField: "executeCommandProvider",
        monacoRegister: null,
        notes: "Execute server commands — needed for code action resolution",
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Converter functions in common.ts
// ─────────────────────────────────────────────────────────────────────────────

export interface ConverterDescriptor {
    name: string;
    direction: "LSP→Monaco" | "Monaco→LSP" | "Utility";
    from: string;
    to: string;
}

export const CONVERTERS: ConverterDescriptor[] = [
    // LSP → Monaco
    { name: "toMonacoLocation",              direction: "LSP→Monaco", from: "Location | LocationLink",     to: "monaco.languages.Location | LocationLink" },
    { name: "toMonacoLanguageSelector",      direction: "LSP→Monaco", from: "DocumentSelector | null",     to: "monaco.languages.LanguageSelector" },
    { name: "toMonacoCompletionItemKind",    direction: "LSP→Monaco", from: "CompletionItemKind (number)", to: "monaco.languages.CompletionItemKind" },
    { name: "toMonacoCompletionItemTag",     direction: "LSP→Monaco", from: "CompletionItemTag",           to: "monaco.languages.CompletionItemTag" },
    { name: "toMonacoInsertTextRules",       direction: "LSP→Monaco", from: "InsertTextFormat",            to: "CompletionItemInsertTextRule" },
    { name: "toMonacoSymbolKind",            direction: "LSP→Monaco", from: "SymbolKind (1-based)",        to: "monaco.languages.SymbolKind (0-based)" },
    { name: "toMonacoSymbolTag",             direction: "LSP→Monaco", from: "SymbolTag",                   to: "monaco.languages.SymbolTag" },
    { name: "toMonacoDocumentHighlightKind", direction: "LSP→Monaco", from: "DocumentHighlightKind",       to: "monaco.languages.DocumentHighlightKind" },
    { name: "toMonacoFoldingRangeKind",      direction: "LSP→Monaco", from: "FoldingRangeKind (string)",   to: "monaco.languages.FoldingRangeKind" },
    { name: "toMonacoDiagnosticSeverity",    direction: "LSP→Monaco", from: "DiagnosticSeverity (number)", to: "monaco.MarkerSeverity" },
    { name: "toMonacoDiagnosticTag",         direction: "LSP→Monaco", from: "DiagnosticTag",               to: "monaco.MarkerTag" },
    { name: "toMonacoCodeActionKind",        direction: "LSP→Monaco", from: "CodeActionKind (string)",     to: "string (same)" },
    { name: "toMonacoInlayHintKind",         direction: "LSP→Monaco", from: "InlayHintKind",               to: "monaco.languages.InlayHintKind" },
    { name: "toMonacoCommand",               direction: "LSP→Monaco", from: "Command",                     to: "monaco.languages.Command" },
    { name: "toDiagnosticMarker",            direction: "LSP→Monaco", from: "Diagnostic",                  to: "monaco.editor.IMarkerData" },

    // Monaco → LSP
    { name: "toLspCompletionTriggerKind",    direction: "Monaco→LSP", from: "CompletionTriggerKind",       to: "LSP CompletionTriggerKind" },
    { name: "toLspCodeActionTriggerKind",    direction: "Monaco→LSP", from: "CodeActionTriggerType",       to: "CodeActionTriggerKind" },
    { name: "toLspDiagnosticSeverity",       direction: "Monaco→LSP", from: "MarkerSeverity",              to: "DiagnosticSeverity" },
    { name: "toLspSignatureHelpTriggerKind", direction: "Monaco→LSP", from: "SignatureHelpTriggerKind",    to: "LSP SignatureHelpTriggerKind" },

    // Utility
    { name: "matchesDocumentSelector",       direction: "Utility",    from: "model + DocumentSelector",    to: "boolean" },
];
