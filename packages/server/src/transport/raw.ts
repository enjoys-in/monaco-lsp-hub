// Raw WebSocket transport: manual Content-Length framing for stdio

import type { WebSocket } from "ws";
import type { TransportBridge, RawTransportOptions } from "./types.js";

export class RawTransportBridge implements TransportBridge {
    private stdoutBuffer = "";

    constructor(private opts: RawTransportOptions) {}

    start(): void {
        const { ws, serverProcess, processClientMessage, processServerMessage } = this.opts;

        // WebSocket → stdin: parse JSON, intercept, re-serialize, frame with Content-Length
        ws.on("message", (data: Buffer | string) => {
            if (!serverProcess.stdin || serverProcess.stdin.destroyed) return;
            try {
                const parsed = JSON.parse(data.toString());
                const transformed = processClientMessage(parsed);
                const json = JSON.stringify(transformed);
                const byteLen = Buffer.byteLength(json, "utf-8");
                serverProcess.stdin.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
            } catch {
                const raw = data.toString();
                const byteLen = Buffer.byteLength(raw, "utf-8");
                serverProcess.stdin.write(`Content-Length: ${byteLen}\r\n\r\n${raw}`);
            }
        });

        // stdout → WebSocket: parse Content-Length frames, intercept, send JSON
        serverProcess.stdout?.on("data", (chunk: Buffer) => {
            this.stdoutBuffer += chunk.toString();
            this.drainBuffer(ws, processServerMessage);
        });
    }

    private drainBuffer(
        ws: WebSocket,
        processServerMessage: (msg: any) => any,
    ): void {
        while (true) {
            const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) break;

            const header = this.stdoutBuffer.substring(0, headerEnd);
            const match = header.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
                this.stdoutBuffer = this.stdoutBuffer.substring(headerEnd + 4);
                continue;
            }

            const contentLength = parseInt(match[1], 10);
            const bodyStart = headerEnd + 4;
            if (this.stdoutBuffer.length < bodyStart + contentLength) break;

            const body = this.stdoutBuffer.substring(bodyStart, bodyStart + contentLength);
            this.stdoutBuffer = this.stdoutBuffer.substring(bodyStart + contentLength);

            if (ws.readyState === ws.OPEN) {
                try {
                    const parsed = JSON.parse(body);
                    const transformed = processServerMessage(parsed);
                    ws.send(JSON.stringify(transformed));
                } catch {
                    ws.send(body);
                }
            }
        }
    }

    dispose(): void {
        this.stdoutBuffer = "";
    }
}
