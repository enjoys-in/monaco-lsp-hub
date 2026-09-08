// Raw WebSocket transport: manual Content-Length framing for stdio.
//
// Framing is done on Buffers, never on strings: Content-Length counts *bytes*,
// while a JS string is indexed in UTF-16 code units. Mixing the two desyncs the
// stream on the first non-ASCII byte (a hover with "→" in it) and never
// recovers. Decoding per chunk has the same problem in reverse — a multi-byte
// sequence can straddle a chunk boundary.

import type { WebSocket } from "ws";
import { AUTO_RESPOND_METHODS, type TransportBridge, type RawTransportOptions } from "./types.js";
import type { LspMessage } from "../lsp/types.js";

const HEADER_SEPARATOR = "\r\n\r\n";

export class RawTransportBridge implements TransportBridge {
    private stdoutBuffer: Buffer = Buffer.alloc(0);
    private disposed = false;
    private onWsMessage?: (data: Buffer | string) => void;
    private onStdoutData?: (chunk: Buffer) => void;

    constructor(private opts: RawTransportOptions) { }

    start(): void {
        const { ws, serverProcess, processClientMessage, processServerMessage } = this.opts;

        // WebSocket → stdin: parse JSON, intercept, re-serialize, frame with Content-Length
        this.onWsMessage = (data: Buffer | string) => {
            if (this.disposed) return;
            if (!serverProcess.stdin || serverProcess.stdin.destroyed) return;
            const raw = typeof data === "string" ? data : data.toString("utf-8");
            try {
                const parsed = JSON.parse(raw);
                const transformed = processClientMessage(parsed);
                this.writeToServer(JSON.stringify(transformed));
            } catch {
                this.writeToServer(raw);
            }
        };
        ws.on("message", this.onWsMessage);

        // stdout → WebSocket: parse Content-Length frames, intercept, send JSON
        this.onStdoutData = (chunk: Buffer) => {
            if (this.disposed) return;
            this.stdoutBuffer = this.stdoutBuffer.length === 0
                ? chunk
                : Buffer.concat([this.stdoutBuffer, chunk]);
            this.drainBuffer(ws, processServerMessage);
        };
        serverProcess.stdout?.on("data", this.onStdoutData);
    }

    /** Frame a JSON payload with a byte-accurate Content-Length header */
    private writeToServer(json: string): void {
        const { serverProcess } = this.opts;
        if (!serverProcess.stdin || serverProcess.stdin.destroyed) return;
        const body = Buffer.from(json, "utf-8");
        serverProcess.stdin.write(`Content-Length: ${body.length}${HEADER_SEPARATOR}`);
        serverProcess.stdin.write(body);
    }

    private drainBuffer(
        ws: WebSocket,
        processServerMessage: (msg: LspMessage) => LspMessage,
    ): void {
        while (true) {
            const headerEnd = this.stdoutBuffer.indexOf(HEADER_SEPARATOR);
            if (headerEnd === -1) break;

            const header = this.stdoutBuffer.subarray(0, headerEnd).toString("ascii");
            const match = header.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
                this.stdoutBuffer = this.stdoutBuffer.subarray(headerEnd + HEADER_SEPARATOR.length);
                continue;
            }

            const contentLength = parseInt(match[1], 10);
            const bodyStart = headerEnd + HEADER_SEPARATOR.length;
            // Byte comparison: both sides are Buffer lengths.
            if (this.stdoutBuffer.length < bodyStart + contentLength) break;

            const body = this.stdoutBuffer.subarray(bodyStart, bodyStart + contentLength);
            this.stdoutBuffer = this.stdoutBuffer.subarray(bodyStart + contentLength);

            if (ws.readyState !== ws.OPEN) continue;

            const text = body.toString("utf-8");
            try {
                const parsed: LspMessage = JSON.parse(text);

                // Auto-respond to server→client requests the client can't handle
                if (parsed.id !== undefined && parsed.method && AUTO_RESPOND_METHODS.has(parsed.method)) {
                    this.writeToServer(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: null }));
                    continue;
                }

                const transformed = processServerMessage(parsed);
                ws.send(JSON.stringify(transformed));
            } catch {
                ws.send(text);
            }
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        const { ws, serverProcess } = this.opts;
        if (this.onWsMessage) ws.off("message", this.onWsMessage);
        if (this.onStdoutData) serverProcess.stdout?.off("data", this.onStdoutData);
        this.onWsMessage = undefined;
        this.onStdoutData = undefined;
        this.stdoutBuffer = Buffer.alloc(0);
    }
}
