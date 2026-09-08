// Language server launcher — spawns a language server process and bridges
// it to a WebSocket connection using the selected transport strategy.
//
// • "raw"    — caller spawns the process, transport does manual Content-Length framing
// • "jsonrpc"— transport uses vscode-ws-jsonrpc/server's createServerProcess
//              which handles spawn + Content-Length framing automatically

import type { WebSocket } from "ws";
import { spawn, type ChildProcess } from "child_process";

import type { ServerConfig } from "./config/servers.js";
import {
    RawTransportBridge,
    JsonRpcTransportBridge,
    type TransportType,
    type TransportBridge,
} from "./transport/index.js";
import { createWorkspace, type Workspace } from "./lsp/workspace.js";
import { createInterceptor } from "./lsp/interceptor.js";
import { scaffoldWorkspace } from "./lsp/scaffold.js";
import type { LspMessage } from "./lsp/types.js";

/** Map language path IDs to file extensions for pre-scaffolding */
const LANG_TO_EXT: Record<string, string> = {
    rust: "rs", go: "go", typescript: "ts", javascript: "js", python: "py", java: "java",
    typescriptreact: "ts", javascriptreact: "js",
};

/** Grace period between SIGTERM and SIGKILL for a language server */
const KILL_GRACE_MS = 2000;
/** Delay before removing the workspace, so a dying server stops writing to it */
const WORKSPACE_RM_DELAY_MS = 250;

/** Teardown hooks for every live session, so shutdown can reclaim them all */
const liveSessions = new Set<(reason: string, code?: number) => void>();

/** Number of language server sessions currently running */
export function getActiveSessionCount(): number {
    return liveSessions.size;
}

/**
 * Stop every running session and remove its temp workspace.
 *
 * Called on SIGINT/SIGTERM: a hard shutdown otherwise leaves one
 * `lsp-workspace-*` directory behind per open connection, since teardown
 * normally hangs off the socket's close event.
 */
export function closeAllSessions(reason: string): void {
    for (const close of [...liveSessions]) {
        close(reason, 1012);
    }
}

export function launchLanguageServer(
    ws: WebSocket,
    config: ServerConfig,
    transportType: TransportType,
    langId?: string,
): void {
    console.log(`[LSP] Starting ${config.name} (transport: ${transportType})...`);

    const workspace = createWorkspace();
    console.log(`[LSP] Temp workspace: ${workspace.dir}`);

    // Pre-scaffold project files before spawning (rust-analyzer needs Cargo.toml at init)
    if (langId) {
        const ext = LANG_TO_EXT[langId];
        if (ext) {
            const result = scaffoldWorkspace(workspace.dir, `file:///workspace/main.${ext}`);
            if (result) {
                console.log(`[LSP] Pre-scaffolded ${result.language}: ${result.created.join(", ")}`);
            }
        }
    }

    const interceptor = createInterceptor(workspace);
    const handlers = {
        processClientMessage: (msg: LspMessage) => interceptor.processClientMessage(msg),
        processServerMessage: (msg: LspMessage) => interceptor.processServerMessage(msg),
    };

    let transport: TransportBridge;
    let serverProcess: ChildProcess | undefined;
    let closed = false;

    // ── Teardown ─────────────────────────────────────────────────────────────
    // One idempotent path for every way a session can end: client disconnect,
    // socket error, server crash, or failed spawn.
    const closeSession = (reason: string, code = 1000): void => {
        if (closed) return;
        closed = true;
        liveSessions.delete(closeSession);

        try {
            transport.dispose();
        } catch (err) {
            console.error(`[LSP] ${config.name} transport dispose failed:`, err);
        }

        if (serverProcess && serverProcess.exitCode === null && serverProcess.signalCode === null) {
            const sigkill = setTimeout(() => {
                try { serverProcess?.kill("SIGKILL"); } catch { /* already gone */ }
            }, KILL_GRACE_MS);
            serverProcess.once("exit", () => clearTimeout(sigkill));
            try { serverProcess.kill(); } catch { /* already gone */ }
        }

        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
            ws.close(code, reason);
        }

        setTimeout(() => workspace.cleanup(), WORKSPACE_RM_DELAY_MS);
    };

    if (transportType === "jsonrpc") {
        // jsonrpc mode: createServerProcess inside the transport handles spawn.
        // The process handle isn't exposed, so stdout closing is the exit signal.
        transport = new JsonRpcTransportBridge({
            ws,
            serverName: config.name,
            command: config.command,
            args: config.args,
            spawnOptions: {
                cwd: workspace.dir,
                shell: process.platform === "win32",
            },
            onServerExit: (reason) => {
                console.log(`[LSP] ${reason}`);
                closeSession(reason, 1011);
            },
            ...handlers,
        });
    } else {
        // raw mode: we spawn the process ourselves
        try {
            serverProcess = spawn(config.command, config.args, {
                stdio: ["pipe", "pipe", "pipe"],
                cwd: workspace.dir,
                shell: process.platform === "win32",
            });
        } catch (err) {
            console.error(`[LSP] Failed to start ${config.name}:`, err);
            workspace.cleanup();
            ws.close(1011, `Failed to start ${config.name}`);
            return;
        }
        console.log(`[LSP] ${config.name} started (PID: ${serverProcess.pid})`);

        transport = new RawTransportBridge({
            ws,
            serverProcess,
            ...handlers,
        });
    }

    liveSessions.add(closeSession);

    // A throw here (bad spawn arguments, missing transport dependency) used to
    // escape into the WS upgrade callback and take down the whole hub.
    try {
        transport.start();
    } catch (err) {
        console.error(`[LSP] Failed to start ${config.name} transport:`, err);
        closeSession(`Failed to start ${config.name}`, 1011);
        return;
    }

    // ── Stderr logging (raw mode only — jsonrpc mode has the process inside) ─
    serverProcess?.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (!text) return;
        // Truncate noisy stderr (e.g. Pyright dumps minified source maps)
        const line = text.length > 500 ? text.substring(0, 500) + "... [truncated]" : text;
        console.error(`[LSP:${config.name}:stderr]`, line);
    });

    // ── Session lifecycle ────────────────────────────────────────────────────

    ws.on("close", () => {
        console.log(`[LSP] Client disconnected, stopping ${config.name}`);
        closeSession("client disconnected");
    });

    ws.on("error", (err) => {
        console.error(`[LSP:${config.name}:ws-error]`, err.message);
        closeSession("websocket error", 1011);
    });

    serverProcess?.on("exit", (code, signal) => {
        console.log(`[LSP] ${config.name} exited (code: ${code}, signal: ${signal})`);
        closeSession(`${config.name} server exited`, 1011);
    });

    serverProcess?.on("error", (err) => {
        console.error(`[LSP] ${config.name} process error:`, err.message);
        closeSession(`${config.name} process error`, 1011);
    });
}
