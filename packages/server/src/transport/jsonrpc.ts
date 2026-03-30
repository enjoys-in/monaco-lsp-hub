// JSON-RPC transport: uses vscode-ws-jsonrpc for WebSocket framing
// and vscode-ws-jsonrpc/server for process stdio framing + spawning.

import type { WebSocket } from "ws";
import {
    WebSocketMessageReader,
    WebSocketMessageWriter,
    type IWebSocket,
} from "vscode-ws-jsonrpc";
import { createServerProcess, type IConnection } from "vscode-ws-jsonrpc/server";
import { AUTO_RESPOND_METHODS, type TransportBridge, type JsonRpcTransportOptions } from "./types.js";
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
        dispose: () => ws.close(),
    };
}

export class JsonRpcTransportBridge implements TransportBridge {
    private wsReader?: WebSocketMessageReader;
    private wsWriter?: WebSocketMessageWriter;
    private serverConnection?: IConnection;

    constructor(private opts: JsonRpcTransportOptions) {}

    start(): void {
        const {
            ws,
            serverName,
            command,
            args,
            spawnOptions,
            processClientMessage,
            processServerMessage,
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

        // Forward: WS → process (client → server) with interception
        this.wsReader.listen((message) => {
            const msg = message as LspMessage;
            console.log(`[JsonRpc:${serverName}] C→S: ${msg.method ?? `response:${msg.id}`}`);
            const transformed = processClientMessage(msg);
            serverConn.writer.write(transformed).catch((err) => {
                console.error(`[JsonRpc:${serverName}] Write to server failed:`, err);
            });
        });

        // Forward: process → WS (server → client) with interception
        serverConn.reader.listen((message) => {
            const msg = message as LspMessage;
            console.log(`[JsonRpc:${serverName}] S→C: ${msg.method ?? `response:${msg.id}`}`);

            // Auto-respond to server→client requests the client can't handle
            if (msg.id !== undefined && msg.method && AUTO_RESPOND_METHODS.has(msg.method)) {
                console.log(`[JsonRpc:${serverName}] Auto-respond: ${msg.method}`);
                serverConn.writer.write({ jsonrpc: "2.0", id: msg.id, result: null } as LspMessage).catch(() => {});
                return;
            }

            const transformed = processServerMessage(msg);
            this.wsWriter!.write(transformed).catch((err) => {
                console.error(`[JsonRpc:${serverName}] Write to WS failed:`, err);
            });
        });

        serverConn.reader.onError((err) => {
            console.error(`[JsonRpc:${serverName}] Server reader error:`, err);
        });
        serverConn.reader.onClose(() => {
            console.log(`[JsonRpc:${serverName}] Server reader closed`);
        });
    }

    dispose(): void {
        this.wsReader?.dispose();
        this.wsWriter?.dispose();
        this.serverConnection?.dispose();
    }
}
