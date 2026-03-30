// Monaco LSP Hub - Client Entry Point
//
// Architecture:
//   Browser (Monaco Editor) <--WebSocket--> Server (Express) <--stdio--> Language Server Process
//
// This file wires up Monaco Editor with LSP language servers via WebSocket.
// Each language tab creates a WebSocket connection to /lsp/<language> on the server,
// which spawns the corresponding language server process.

import loader from "@monaco-editor/loader";
import type * as Monaco from "monaco-editor";
import { languages, type LanguageConfig } from "./config.js";

// ── Load Monaco via @monaco-editor/loader ────────────────────────────────────
// Loads Monaco from CDN (no bundler config needed). We pass the local
// monaco-editor package for type resolution but load sources from CDN.

const monaco = await loader.init();

// Import lsp namespace from the loaded Monaco instance
type MonacoLsp = typeof import("monaco-editor/esm/vs/editor/editor.main.js")["lsp"];
const lsp: MonacoLsp = (monaco as any).lsp;


let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let currentClient: any = null;
let currentTransport: any = null;
let currentLanguage = "json";

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
}

// ── Language Client (LSP over WebSocket) ─────────────────────────────────────
//
// Uses Monaco Editor's built-in lsp namespace (v0.55.0+):
//   1. WebSocketTransport.connectTo() opens the WebSocket and wraps it as a transport
//   2. MonacoLspClient consumes the transport and registers LSP features with Monaco

async function connectLanguageClient(langConfig: LanguageConfig): Promise<void> {
    if (currentTransport) {
        currentTransport.close();
        currentTransport = null;
        currentClient = null;
    }

    setStatus(`Connecting to ${langConfig.serverName}...`);

    try {
        const url = getWebSocketUrl(langConfig.id);
        const transport = await lsp.WebSocketTransport.connectTo({ address: url });
        currentTransport = transport;

        const client = new lsp.MonacoLspClient(transport);
        currentClient = client;

        setStatus(`Connected to ${langConfig.serverName}`, "connected");

        transport.state.onChange(() => {
            if (transport.state.value.state === "closed") {
                setStatus(`${langConfig.serverName} disconnected`, "error");
            }
        });
    } catch (err) {
        console.error("[LSP] Connection error:", err);
        setStatus(`Failed to connect to ${langConfig.serverName}`, "error");
        throw err;
    }
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

// ── Initialization ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
    document.querySelectorAll(".tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            const lang = tab.getAttribute("data-lang");
            if (lang) switchLanguage(lang);
        });
    });

    await switchLanguage("json");
}

main().catch(console.error);
