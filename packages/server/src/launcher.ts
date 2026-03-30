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

/** Map language path IDs to file extensions for pre-scaffolding */
const LANG_TO_EXT: Record<string, string> = {
    rust: "rs", go: "go", typescript: "ts", javascript: "js", python: "py", java: "java",
};

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
        processClientMessage: (msg: any) => interceptor.processClientMessage(msg),
        processServerMessage: (msg: any) => interceptor.processServerMessage(msg),
    };

    let transport: TransportBridge;
    let serverProcess: ChildProcess | undefined;

    if (transportType === "jsonrpc") {
        // jsonrpc mode: createServerProcess inside the transport handles spawn
        transport = new JsonRpcTransportBridge({
            ws,
            serverName: config.name,
            command: config.command,
            args: config.args,
            spawnOptions: {
                cwd: workspace.dir,
                shell: process.platform === "win32",
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

    transport.start();

    // ── Stderr logging (raw mode only — jsonrpc mode has the process inside) ─
    serverProcess?.stderr?.on("data", (data: Buffer) => {
        console.error(`[LSP:${config.name}:stderr]`, data.toString().trim());
    });

    // ── Cleanup ──────────────────────────────────────────────────────────────

    const cleanup = () => {
        transport.dispose();
        serverProcess?.kill();
        workspace.cleanup();
    };

    ws.on("close", () => {
        console.log(`[LSP] Client disconnected, stopping ${config.name}`);
        cleanup();
    });

    ws.on("error", (err) => {
        console.error(`[LSP:${config.name}:ws-error]`, err.message);
        cleanup();
    });

    serverProcess?.on("exit", (code, signal) => {
        console.log(`[LSP] ${config.name} exited (code: ${code}, signal: ${signal})`);
        transport.dispose();
        workspace.cleanup();
        if (ws.readyState === ws.OPEN) {
            ws.close(1000, `${config.name} server exited`);
        }
    });

    serverProcess?.on("error", (err) => {
        console.error(`[LSP] ${config.name} process error:`, err.message);
        if (ws.readyState === ws.OPEN) {
            ws.close(1011, `${config.name} process error`);
        }
    });
}

