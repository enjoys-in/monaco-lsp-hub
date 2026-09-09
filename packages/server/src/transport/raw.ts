// Raw WebSocket transport: manual Content-Length framing for stdio.
//
// Framing is done on Buffers, never on strings: Content-Length counts *bytes*,
// while a JS string is indexed in UTF-16 code units. Mixing the two desyncs the
// stream on the first non-ASCII byte (a hover with "→" in it) and never
// recovers. Decoding per chunk has the same problem in reverse — a multi-byte
// sequence can straddle a chunk boundary.

import type { WebSocket } from "ws";
import type { TransportBridge, RawTransportOptions } from "./types.js";
import type { ServerRequestArbiter } from "../lsp/server-requests.js";
import type { LspMessage } from "../lsp/types.js";

const HEADER_SEPARATOR = "\r\n\r\n";

export class RawTransportBridge implements TransportBridge {
    private stdoutBuffer: Buffer = Buffer.alloc(0);
    private disposed = false;
    private arbiter?: ServerRequestArbiter;
    private onWsMessage?: (data: Buffer | string) => void;
    private onStdoutData?: (chunk: Buffer) => void;

    constructor(private opts: RawTransportOptions) { }

    start(): void {
        const { ws, serverProcess, processClientMessage, processServerMessage, createArbiter } = this.opts;

        this.arbiter = createArbiter?.((msg) => this.writeToServer(JSON.stringify(msg)));

        // WebSocket → stdin: parse JSON, intercept, re-serialize, frame with Content-Length
        this.onWsMessage = (data: Buffer | string) => {
            if (this.disposed) return;
            if (!serverProcess.stdin || serverProcess.stdin.destroyed) return;
            const raw = typeof data === "string" ? data : data.toString("utf-8");
            try {
                const parsed = JSON.parse(raw) as LspMessage;
                if (this.arbiter?.handleClientMessage(parsed) === "drop") return;
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

            const text = body.toString("utf-8");
            let parsed: LspMessage | undefined;
            try {
                parsed = JSON.parse(text) as LspMessage;
            } catch {
                if (ws.readyState === ws.OPEN) ws.send(text);
                continue;
            }

            // Runs even with the socket already closing: a server left waiting
            // on a reply it will never get keeps its worker busy until the
            // process is killed.
            if (this.arbiter?.handleServerMessage(parsed) === "answered") continue;

            if (ws.readyState !== ws.OPEN) continue;
            ws.send(JSON.stringify(processServerMessage(parsed)));
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
        this.arbiter?.dispose();
        this.arbiter = undefined;
        this.stdoutBuffer = Buffer.alloc(0);
    }
}
