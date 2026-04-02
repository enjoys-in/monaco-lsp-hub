// Monaco LSP Hub — entry point
// HTTP server + WebSocket upgrade handler

import express from "express";
import { createServer } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import path from "path";
import { fileURLToPath } from "url";

import {
    LANGUAGE_SERVERS,
    resolveServer,
    getAvailableLanguages,
    getLanguageDetails,
    getMissingSystemServers,
} from "./config/servers.js";
import { launchLanguageServer } from "./launcher.js";
import type { TransportType } from "./transport/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

// ── Express App ──────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);

app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

app.get("/api/languages", (_req, res) => {
    res.json(getAvailableLanguages());
});

app.get("/api/languages/details", (_req, res) => {
    res.json(getLanguageDetails());
});

const distPath = process.env.CLIENT_DIST_PATH
    ? path.resolve(process.env.CLIENT_DIST_PATH)
    : path.resolve(PKG_ROOT, "..", "client", "dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
});

// ── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const pathname = url.pathname;

    const serverConfig = resolveServer(pathname);
    if (!serverConfig) {
        console.warn(`[WS] No language server for path: ${pathname}`);
        socket.destroy();
        return;
    }

    // Select transport: ?transport=jsonrpc | raw (default: jsonrpc)
    const transport = (url.searchParams.get("transport") ?? "jsonrpc") as TransportType;

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        const langId = pathname.replace("/lsp/", "");
        launchLanguageServer(ws, serverConfig, transport, langId);
    });
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "9601", 10);

httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  Monaco LSP Hub running at http://localhost:${PORT}\n`);
    console.log("  Available language servers:");
    for (const [wsPath, config] of Object.entries(LANGUAGE_SERVERS)) {
        console.log(`    ${config.name.padEnd(24)} ws://localhost:${PORT}${wsPath}`);
    }
    const missing = getMissingSystemServers();
    if (missing.length > 0) {
        console.log("\n  Not found on PATH (optional):");
        for (const msg of missing) {
            console.log(`    - ${msg}`);
        }
    }
    console.log();
});
