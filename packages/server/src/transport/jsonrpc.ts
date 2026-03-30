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
            const transformed = processClientMessage(message as any);
            serverConn.writer.write(transformed).catch(() => {});
        });

        // Forward: process → WS (server → client) with interception
        serverConn.reader.listen((message) => {
            const transformed = processServerMessage(message as any);
            this.wsWriter!.write(transformed).catch(() => {});
        });
    }

    dispose(): void {
        this.wsReader?.dispose();
        this.wsWriter?.dispose();
        this.serverConnection?.dispose();
    }
}
