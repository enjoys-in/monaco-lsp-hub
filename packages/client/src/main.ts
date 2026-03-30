// Monaco LSP Hub - Client Entry Point
//
// Architecture:
//   Browser (Monaco Editor) <--WebSocket--> Server (Express) <--stdio--> Language Server Process

import loader from "@monaco-editor/loader";
import type * as Monaco from "monaco-editor";
import { languages, type LanguageConfig } from "./config.js";
import { showToast } from "./toast.js";
import { initExplorer, addFile, setActiveFile, updateDiagnostics, type FileEntry } from "./explorer.js";
import { createInterceptingTransport } from "./lsp-transport.js";

const monaco = await loader.init();

type MonacoLsp = typeof import("monaco-editor/esm/vs/editor/editor.main.js")["lsp"];
const lsp: MonacoLsp = (monaco as any).lsp;

let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let currentClient: any = null;
let currentTransport: any = null;
let currentLanguage = "";

// Track scaffold files sent per language
const scaffoldedLanguages = new Set<string>();

// ── WebSocket URL ────────────────────────────────────────────────────────────

function getWebSocketUrl(langId: string): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/lsp/${langId}`;
}

// ── Status Bar ───────────────────────────────────────────────────────────────

function setStatus(text: string, state: "info" | "connected" | "error" = "info"): void {
    const el = document.getElementById("status")!;
    el.textContent = text;
    el.className = state;
}

function updateStatusDiagnostics(): void {
    const markers = monaco.editor.getModelMarkers({});
    const errors = markers.filter((m: Monaco.editor.IMarkerData) => m.severity === monaco.MarkerSeverity.Error).length;
    const warnings = markers.filter((m: Monaco.editor.IMarkerData) => m.severity === monaco.MarkerSeverity.Warning).length;
    const el = document.getElementById("status-diagnostics")!;
    const parts: string[] = [];
    if (errors > 0) parts.push(`⊘ ${errors}`);
    if (warnings > 0) parts.push(`△ ${warnings}`);
    el.textContent = parts.join("  ");
    el.className = errors > 0 ? "error" : warnings > 0 ? "warning" : "";
}

// ── Create or Update Editor ──────────────────────────────────────────────────

function initEditor(langConfig: LanguageConfig): void {
    const container = document.getElementById("editor-container")!;
    const uri = monaco.Uri.parse(`file:///workspace/main.${langConfig.fileExtension}`);

    if (editor) {
        const oldModel = editor.getModel();
        let model = monaco.editor.getModel(uri);
        if (!model) {
            model = monaco.editor.createModel(langConfig.sampleCode, langConfig.languageId, uri);
        }
        editor.setModel(model);
        if (oldModel && oldModel !== model) {
            oldModel.dispose();
        }
    } else {
        const model = monaco.editor.createModel(langConfig.sampleCode, langConfig.languageId, uri);
        editor = monaco.editor.create(container, {
            model,
            theme: "vs-dark",
            fontSize: 14,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
            bracketPairColorization: { enabled: true },
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
        });
    }

    // Update explorer
    const mainFile: FileEntry = {
        name: `main.${langConfig.fileExtension}`,
        uri: uri.toString(),
        languageId: langConfig.languageId,
    };
    addFile(mainFile);
    setActiveFile(uri.toString());

    if (langConfig.scaffold) {
        for (const sf of langConfig.scaffold) {
            const sfUri = monaco.Uri.parse(`file:///workspace/${sf.name}`);
            addFile({ name: sf.name, uri: sfUri.toString(), languageId: guessLanguageId(sf.name) });
        }
    }
}

function guessLanguageId(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
        json: "json", toml: "toml", mod: "go", yml: "yaml", yaml: "yaml",
        xml: "xml", py: "python", ts: "typescript", js: "javascript",
    };
    return map[ext] ?? "plaintext";
}

// ── Language Client (LSP over WebSocket) ─────────────────────────────────────

async function connectLanguageClient(langConfig: LanguageConfig): Promise<void> {
    if (currentTransport) {
        currentTransport.close();
        currentTransport = null;
        currentClient = null;
    }

    setStatus(`Connecting to ${langConfig.serverName}...`);

    try {
        const url = getWebSocketUrl(langConfig.id);
        const rawTransport = await lsp.WebSocketTransport.connectTo({ address: url });

        const transport = createInterceptingTransport(rawTransport, {
            onDiagnostics: (uri) => {
                setTimeout(() => {
                    const model = monaco.editor.getModels().find((m: Monaco.editor.ITextModel) => m.uri.toString() === uri);
                    if (model) {
                        const markers = monaco.editor.getModelMarkers({ resource: model.uri });
                        const fileName = model.uri.path.split("/").pop() ?? "";
                        updateDiagnostics(uri, fileName, markers);
                        updateStatusDiagnostics();
                    }
                }, 100);
            },
        });

        currentTransport = rawTransport;
        const client = new lsp.MonacoLspClient(transport);
        currentClient = client;

        setStatus(`Connected to ${langConfig.serverName}`, "connected");
        showToast({ message: `Connected to ${langConfig.serverName}`, type: "info", duration: 2000 });

        rawTransport.state.onChange(() => {
            if (rawTransport.state.value.state === "closed") {
                setStatus(`${langConfig.serverName} disconnected`, "error");
            }
        });

        // Send scaffold files after connection
        if (langConfig.scaffold && !scaffoldedLanguages.has(langConfig.id)) {
            scaffoldedLanguages.add(langConfig.id);
            setTimeout(() => sendScaffoldFiles(langConfig), 500);
        }
    } catch (err) {
        console.error("[LSP] Connection error:", err);
        setStatus(`Failed to connect to ${langConfig.serverName}`, "error");
        showToast({ message: `Failed to connect to ${langConfig.serverName}`, type: "error" });
        throw err;
    }
}

// ── Scaffold: send project files to server ───────────────────────────────────

function sendScaffoldFiles(langConfig: LanguageConfig): void {
    if (!langConfig.scaffold || !currentTransport) return;

    for (const sf of langConfig.scaffold) {
        const uri = `file:///workspace/${sf.name}`;
        currentTransport.send({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: { uri, languageId: guessLanguageId(sf.name), version: 1, text: sf.content },
            },
        });
    }

    showToast({
        message: `Created ${langConfig.scaffold.map((f) => f.name).join(", ")}`,
        type: "info",
        duration: 3000,
    });
}

// ── Language Switching ───────────────────────────────────────────────────────

async function switchLanguage(langId: string): Promise<void> {
    if (langId === currentLanguage && currentClient) return;

    const langConfig = languages[langId];
    if (!langConfig) {
        console.error(`Unknown language: ${langId}`);
        return;
    }

    currentLanguage = langId;

    document.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.toggle("active", tab.getAttribute("data-lang") === langId);
    });

    initEditor(langConfig);

    try {
        await connectLanguageClient(langConfig);
    } catch (err) {
        console.error("Failed to connect language client:", err);
    }
}

// ── Open file in editor (from explorer click) ────────────────────────────────

function openFileInEditor(file: FileEntry): void {
    const uri = monaco.Uri.parse(file.uri);
    const model = monaco.editor.getModel(uri);
    if (model && editor) {
        editor.setModel(model);
        setActiveFile(file.uri);
    }
}

// ── Initialization ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
    document.querySelectorAll(".tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            const lang = tab.getAttribute("data-lang");
            if (lang) switchLanguage(lang);
        });
    });

    initExplorer({
        onFileClick: openFileInEditor,
        onDiagnosticClick: (diag) => {
            const uri = monaco.Uri.parse(diag.uri);
            const model = monaco.editor.getModel(uri);
            if (model && editor) {
                editor.setModel(model);
                setActiveFile(diag.uri);
                editor.revealLineInCenter(diag.line);
                editor.setPosition({ lineNumber: diag.line, column: diag.character });
                editor.focus();
            }
        },
    });

    monaco.editor.onDidChangeMarkers((uris: readonly Monaco.Uri[]) => {
        for (const uri of uris) {
            const markers = monaco.editor.getModelMarkers({ resource: uri });
            const fileName = uri.path.split("/").pop() ?? "";
            updateDiagnostics(uri.toString(), fileName, markers);
        }
        updateStatusDiagnostics();
    });

    await switchLanguage("json");
}

main().catch(console.error);
