// Monaco LSP Hub — entry point
// HTTP server + WebSocket upgrade handler
//
// Connections are open by design: this is a public playground, so there is no
// auth on the LSP endpoints. The only limit is MAX_SESSIONS, because every
// connection spawns a real language server process (rust-analyzer, jdtls and
// gopls are hundreds of MB resident each) and an unbounded count OOMs the box.

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
import { launchLanguageServer, getActiveSessionCount, closeAllSessions } from "./launcher.js";
import { startKeepAlive, stopKeepAlive } from "./lib/keep-me-alive.js";
import type { TransportType } from "./transport/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS ?? "32", 10);

// ── Express App ──────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);

app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        uptime: process.uptime(),
        sessions: getActiveSessionCount(),
        maxSessions: MAX_SESSIONS,
        timestamp: new Date().toISOString(),
    });
});

app.get("/api/languages", (_req, res) => {
    res.json(getAvailableLanguages());
});

app.get("/api/languages/details", (_req, res) => {
    res.json(getLanguageDetails());
});

// Unknown /api routes are errors, not the SPA shell — without this they fall
// through to the catch-all below and answer index.html with a 200.
app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
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

/**
 * Refuse an upgrade.
 *
 * This closes the socket without an HTTP status line, which is what the `ws`
 * documentation prescribes anyway. Writing a real `404`/`503` response was
 * tried and does not work on this project's runtime: under Bun, bytes written
 * to the socket handed to the `upgrade` event are never delivered to the client
 * (the write reports success and the client sees an empty reply), even though
 * `ws.handleUpgrade`'s own 101 handshake goes through. The reason is logged
 * server-side instead.
 */
function rejectUpgrade(socket: Socket): void {
    socket.destroy();
}

httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const pathname = url.pathname;

    const serverConfig = resolveServer(pathname);
    if (!serverConfig) {
        console.warn(`[WS] No language server for path: ${pathname}`);
        rejectUpgrade(socket);
        return;
    }

    if (getActiveSessionCount() >= MAX_SESSIONS) {
        console.warn(`[WS] Session limit reached (${MAX_SESSIONS}), rejecting ${pathname}`);
        rejectUpgrade(socket);
        return;
    }

    // Select transport: ?transport=jsonrpc | raw (default: jsonrpc)
    const requested = url.searchParams.get("transport") ?? "jsonrpc";
    const transport: TransportType = requested === "raw" ? "raw" : "jsonrpc";

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        const langId = pathname.replace("/lsp/", "");
        try {
            launchLanguageServer(ws, serverConfig, transport, langId);
        } catch (err) {
            // Never let a session failure escape into the upgrade callback —
            // an unhandled throw here would take the whole hub down.
            console.error(`[WS] Failed to launch ${serverConfig.name}:`, err);
            if (ws.readyState === ws.OPEN) ws.close(1011, "Failed to start language server");
        }
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

    // Prevent Render cold starts by self-pinging
    const publicUrl = process.env.RENDER_EXTERNAL_URL;
    if (publicUrl) {
        startKeepAlive(publicUrl);
    }
});

// ── Shutdown ─────────────────────────────────────────────────────────────────

let shuttingDown = false;

function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n  ${signal} received — stopping ${getActiveSessionCount()} session(s)`);
    stopKeepAlive();
    closeAllSessions("server shutting down");
    httpServer.close();

    // Give the language servers their SIGTERM grace period and the workspace
    // removals a chance to land before the process goes away.
    setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
