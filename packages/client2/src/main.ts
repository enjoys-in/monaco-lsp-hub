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
import { languages, workspaceFileName, type LanguageConfig } from "./config";
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

/** Guards overlapping switches — see the same mechanism in the client package. */
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

// ── Create or Update Editor ──────────────────────────────────────────────────

/** URI of the one document the current connection serves */
let currentDocumentUri = "";

function initEditor(langConfig: LanguageConfig): void {
    const container = document.getElementById("editor-container")!;
    const uri = monaco.Uri.parse(`file:///workspace/${workspaceFileName(langConfig)}`);
    currentDocumentUri = uri.toString();

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

function disconnectLanguageClient(): void {
    // Disposing the client unregisters its Monaco providers and closes its
    // documents. Closing only the transport left a full set of providers behind
    // on a dead socket, one set per language visited.
    currentClient?.dispose();
    currentClient = null;
    currentTransport?.close();
    currentTransport = null;
}

async function connectLanguageClient(langConfig: LanguageConfig, generation: number): Promise<void> {
    disconnectLanguageClient();

    setStatus(`Connecting to ${langConfig.serverName}...`);

    const url = getWebSocketUrl(langConfig.id);
    let transport: WebSocketTransport;
    try {
        transport = await WebSocketTransport.connectTo({ address: url });
    } catch (err) {
        if (generation !== switchGeneration) return;
        console.error("[LSP] Connection error:", err);
        setStatus(`Failed to connect to ${langConfig.serverName}`, "error");
        throw err;
    }

    // A newer switch won the race while we were connecting.
    if (generation !== switchGeneration) {
        transport.close();
        return;
    }

    currentTransport = transport;

    const client = new MonacoLspClient(transport, {
        // One server, one file: the session's workspace holds this document and
        // nothing else, so the client registers its providers for this
        // document's language only. Left unscoped, a server that advertises a
        // capability without a document selector — the normal case — registers
        // as `'*'` and starts answering for every other model on the page.
        scope: { uri: currentDocumentUri, languageId: langConfig.languageId },
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
        onInitializeError(error) {
            if (generation !== switchGeneration) return;
            console.error("[LSP] Handshake failed:", error);
            setStatus(`${langConfig.serverName} failed to initialize`, "error");
        },
    });
    currentClient = client;

    transport.state.onChange(() => {
        if (generation !== switchGeneration) return;
        if (transport.state.value.state === "closed") {
            setStatus(`${langConfig.serverName} disconnected`, "error");
        }
    });

    // "Connected" now means the initialize handshake actually completed — it
    // used to be reported the moment the socket opened, while every request
    // sent in that window was answered with an error.
    try {
        await client.ready;
    } catch {
        return;
    }
    if (generation !== switchGeneration) return;

    setStatus(`Connected to ${langConfig.serverName}`, "connected");
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

    // Tear the old client down first, so its didClose notifications still have
    // a live socket to go out on.
    disconnectLanguageClient();
    initEditor(langConfig);

    try {
        await connectLanguageClient(langConfig, generation);
    } catch (err) {
        console.error("Failed to connect language client:", err);
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

    await switchLanguage("go");
}

main().catch(console.error);
