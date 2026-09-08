// Monaco LSP Hub - Client Entry Point
//
// Architecture:
//   Browser (Monaco Editor) <--WebSocket--> Server (Express) <--stdio--> Language Server Process

import loader from "@monaco-editor/loader";
import type * as Monaco from "monaco-editor";
import { languages, workspaceFileName, type LanguageConfig } from "./config.js";
import { showToast } from "./toast.js";
import { initExplorer, addFile, clearFiles, setActiveFile, updateDiagnostics, type FileEntry } from "./explorer.js";
import { createInterceptingTransport } from "./lsp-transport.js";

const monaco = await loader.init();

type MonacoLsp = typeof import("monaco-editor/esm/vs/editor/editor.main.js")["lsp"];
const lsp: MonacoLsp = (monaco as any).lsp;

let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let currentClient: any = null;
let currentTransport: any = null;
let currentLanguage = "";

/**
 * Guards against overlapping language switches.
 *
 * Each switch spawns a fresh server, and two fast tab clicks used to race:
 * the second closed a transport that was still null, then both assigned
 * `currentTransport`, leaving the first socket open forever.
 */
let switchGeneration = 0;

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

function modelUri(fileName: string): Monaco.Uri {
    return monaco.Uri.parse(`file:///workspace/${fileName}`);
}

function initEditor(langConfig: LanguageConfig): void {
    const container = document.getElementById("editor-container")!;
    const uri = modelUri(workspaceFileName(langConfig));

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

    // Rebuild the explorer for this language — entries from the previous one
    // point at models that no longer exist.
    clearFiles();

    const mainFile: FileEntry = {
        name: workspaceFileName(langConfig),
        uri: uri.toString(),
        languageId: langConfig.languageId,
    };
    addFile(mainFile);

    // Scaffold files get a real model each, so clicking one in the explorer
    // actually opens it. They used to be listed without ever being created,
    // which made those rows silently dead.
    if (langConfig.scaffold) {
        for (const sf of langConfig.scaffold) {
            const sfUri = modelUri(sf.name);
            if (!monaco.editor.getModel(sfUri)) {
                monaco.editor.createModel(sf.content, guessLanguageId(sf.name), sfUri);
            }
            addFile({ name: sf.name, uri: sfUri.toString(), languageId: guessLanguageId(sf.name) });
        }
    }

    setActiveFile(uri.toString());
}

function disposeWorkspaceModels(): void {
    for (const model of monaco.editor.getModels()) {
        model.dispose();
    }
}

function guessLanguageId(filename: string): string {
    if (filename === "Dockerfile") return "dockerfile";
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
        json: "json", toml: "toml", mod: "go", yml: "yaml", yaml: "yaml",
        xml: "xml", py: "python", ts: "typescript", js: "javascript",
    };
    return map[ext] ?? "plaintext";
}

// ── Language Client (LSP over WebSocket) ─────────────────────────────────────

function disconnectLanguageClient(): void {
    currentClient?.dispose?.();
    currentClient = null;
    currentTransport?.close?.();
    currentTransport = null;
}

async function connectLanguageClient(langConfig: LanguageConfig, generation: number): Promise<void> {
    disconnectLanguageClient();

    setStatus(`Connecting to ${langConfig.serverName}...`);

    const url = getWebSocketUrl(langConfig.id);
    let rawTransport: any;
    try {
        rawTransport = await lsp.WebSocketTransport.connectTo({ address: url });
    } catch (err) {
        if (generation !== switchGeneration) return;
        console.error("[LSP] Connection error:", err);
        setStatus(`Failed to connect to ${langConfig.serverName}`, "error");
        showToast({ message: `Failed to connect to ${langConfig.serverName}`, type: "error" });
        throw err;
    }

    // A newer switch started while we were connecting — this socket is already
    // obsolete, so close it instead of installing it as the current one.
    if (generation !== switchGeneration) {
        rawTransport.close?.();
        return;
    }

    const transport = createInterceptingTransport(rawTransport);

    currentTransport = rawTransport;
    currentClient = new lsp.MonacoLspClient(transport);

    setStatus(`Connected to ${langConfig.serverName}`, "connected");
    showToast({ message: `Connected to ${langConfig.serverName}`, type: "info", duration: 2000 });

    rawTransport.state.onChange(() => {
        // Only the live connection may write the status bar; a late close event
        // from a previous language would otherwise report the wrong server.
        if (generation !== switchGeneration) return;
        if (rawTransport.state.value.state === "closed") {
            setStatus(`${langConfig.serverName} disconnected`, "error");
        }
    });

    // Scaffold files are per *connection*, not per language: every switch gets
    // a fresh server process with a fresh temp workspace, so a cached "already
    // sent" flag meant the second visit to a language ran without its go.mod
    // or tsconfig.json. Sending them inline also removes the timer that could
    // deliver them to whichever server happened to be connected 500ms later.
    sendScaffoldFiles(langConfig, rawTransport);
}

// ── Scaffold: send project files to server ───────────────────────────────────

function sendScaffoldFiles(langConfig: LanguageConfig, transport: any): void {
    if (!langConfig.scaffold) return;

    for (const sf of langConfig.scaffold) {
        transport.send({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: {
                    uri: `file:///workspace/${sf.name}`,
                    languageId: guessLanguageId(sf.name),
                    version: 1,
                    text: sf.content,
                },
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

    const generation = ++switchGeneration;
    currentLanguage = langId;

    document.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.toggle("active", tab.getAttribute("data-lang") === langId);
    });

    // Drop the previous language's client (and its providers) *before* touching
    // models, so its didClose notifications go out on a live socket.
    disconnectLanguageClient();
    disposeWorkspaceModels();
    initEditor(langConfig);

    try {
        await connectLanguageClient(langConfig, generation);
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
            if (lang) void switchLanguage(lang);
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

    // Single source of truth for the diagnostics panel. There used to be a
    // second path on publishDiagnostics with a 100ms timer that raced this one.
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
