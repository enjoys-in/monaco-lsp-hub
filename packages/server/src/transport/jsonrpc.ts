// JSON-RPC transport: uses vscode-ws-jsonrpc for WebSocket framing
// and vscode-ws-jsonrpc/server for process stdio framing + spawning.

import type { WebSocket } from "ws";
import {
    WebSocketMessageReader,
    WebSocketMessageWriter,
    type IWebSocket,
} from "vscode-ws-jsonrpc";
import { createServerProcess, type IConnection } from "vscode-ws-jsonrpc/server";
import type { TransportBridge, JsonRpcTransportOptions } from "./types.js";
import type { ServerRequestArbiter } from "../lsp/server-requests.js";
import type { LspMessage } from "../lsp/types.js";

/** Adapt a `ws` WebSocket into the IWebSocket interface expected by vscode-ws-jsonrpc */
function toIWebSocket(ws: WebSocket): IWebSocket {
    return {
        send: (content) =>
            ws.send(content, (err) => {
                if (err) console.error("[JsonRpc] WS send error:", err.message);
            }),
        onMessage: (cb) =>
            ws.on("message", (data) =>
                cb(typeof data === "string" ? data : data.toString()),
            ),
        onError: (cb) =>
            ws.on("error", (err) => cb(err.message)),
        onClose: (cb) =>
            ws.on("close", (code, reason) => cb(code, reason?.toString() ?? "")),
        // Closing the socket is the session's job, not the writer's: doing it
        // here discarded the close code the launcher had already chosen, so a
        // crashed server was indistinguishable from a clean shutdown.
        dispose: () => { },
    };
}

export class JsonRpcTransportBridge implements TransportBridge {
    private wsReader?: WebSocketMessageReader;
    private wsWriter?: WebSocketMessageWriter;
    private serverConnection?: IConnection;
    private arbiter?: ServerRequestArbiter;
    private disposed = false;

    constructor(private opts: JsonRpcTransportOptions) { }

    start(): void {
        const {
            ws,
            serverName,
            command,
            args,
            spawnOptions,
            processClientMessage,
            processServerMessage,
            createArbiter,
            onServerExit,
        } = this.opts;

        // WebSocket side — JSON-RPC message reader/writer over WS frames
        const socket = toIWebSocket(ws);
        this.wsReader = new WebSocketMessageReader(socket);
        this.wsWriter = new WebSocketMessageWriter(socket);

        // Process side — createServerProcess spawns the binary and wraps
        // stdin/stdout with Content-Length-framed readers/writers automatically
        this.serverConnection = createServerProcess(serverName, command, args, spawnOptions);

        if (!this.serverConnection) {
            throw new Error(`Failed to create server process for ${serverName}`);
        }

        const serverConn = this.serverConnection;

        const writeToServer = (msg: LspMessage): void => {
            serverConn.writer.write(msg).catch((err) => {
                console.error(`[JsonRpc:${serverName}] Write to server failed:`, err);
            });
        };

        this.arbiter = createArbiter?.(writeToServer);

        // Forward: WS → process (client → server) with interception
        this.wsReader.listen((message) => {
            if (this.disposed) return;
            const msg = message as LspMessage;
            if (this.arbiter?.handleClientMessage(msg) === "drop") return;
            writeToServer(processClientMessage(msg));
        });

        // Forward: process → WS (server → client) with interception
        serverConn.reader.listen((message) => {
            if (this.disposed) return;
            const msg = message as LspMessage;

            // Requests the hub answers on the client's behalf never reach it
            if (this.arbiter?.handleServerMessage(msg) === "answered") return;

            const transformed = processServerMessage(msg);

            this.wsWriter!.write(transformed).catch((err) => {
                console.error(`[JsonRpc:${serverName}] Write to WS failed:`, err);
            });
        });

        serverConn.reader.onError((err) => {
            console.error(`[JsonRpc:${serverName}] Server reader error:`, err);
        });

        // stdout closing means the process is gone — either it crashed or the
        // binary was never there. Without this the socket stays open and every
        // client request hangs forever against a dead server.
        serverConn.reader.onClose(() => {
            if (this.disposed) return;
            console.log(`[JsonRpc:${serverName}] Server reader closed`);
            onServerExit?.(`${serverName} server exited`);
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.arbiter?.dispose();
        this.wsReader?.dispose();
        this.wsWriter?.dispose();
        // Kills the child process (createServerProcess wires dispose → kill).
        this.serverConnection?.dispose();
    }
}
