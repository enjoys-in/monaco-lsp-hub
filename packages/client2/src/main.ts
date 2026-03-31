// Monaco LSP Hub - Client2 Entry Point
//
// Uses @hediet/json-rpc-websocket transport + MonacoLspClient from
// microsoft/monaco-editor/monaco-lsp-client reference implementation.

import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { WebSocketTransport } from "@hediet/json-rpc-websocket";
import { MonacoLspClient } from "./lsp/LspClient";
import { languages, type LanguageConfig } from "./config";
import { showToast, lspMessageTypeToToast } from "./toast";

self.MonacoEnvironment = {
    getWorker(_, label) {
        if (label === "json") return new jsonWorker();
        if (label === "css" || label === "scss" || label === "less") return new cssWorker();
        if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
        if (label === "typescript" || label === "javascript") return new tsWorker();
        return new editorWorker();
    },
};

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let currentClient: MonacoLspClient | null = null;
let currentTransport: WebSocketTransport | null = null;
let currentLanguage = "";

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

async function connectLanguageClient(langConfig: LanguageConfig): Promise<void> {
    if (currentTransport) {
        currentTransport.close();
        currentTransport = null;
        currentClient = null;
    }

    setStatus(`Connecting to ${langConfig.serverName}...`);

    try {
        const url = getWebSocketUrl(langConfig.id);
        const transport = await WebSocketTransport.connectTo({ address: url });
        currentTransport = transport;

        const client = new MonacoLspClient(transport, {

            onShowMessage(params) {
                showToast({
                    message: params.message,
                    type: lspMessageTypeToToast(params.type),
                });
            },
            onLogMessage(params) {
                const level = params.type <= 1 ? "error" : params.type === 2 ? "warn" : "log";
                (console as any)[level]("[LSP]", params.message);
                showToast({
                    message: params.message,
                    type: lspMessageTypeToToast(params.type),
                    duration: 3000,
                });
            },
        });
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

    await switchLanguage("go");
}

main().catch(console.error);
