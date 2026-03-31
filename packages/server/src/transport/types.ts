// Transport layer types — Strategy pattern for WebSocket ↔ stdio bridging

import type { WebSocket } from "ws";
import type { ChildProcess, SpawnOptions } from "child_process";
import type { LspMessage } from "../lsp/types.js";

export type TransportType = "raw" | "jsonrpc";

/** Server→client requests the client doesn't handle — auto-respond with null result */
export const AUTO_RESPOND_METHODS = new Set([
    "workspace/diagnostic/refresh",
    "workspace/semanticTokens/refresh",
    "workspace/inlineValue/refresh",
    "workspace/codeLens/refresh",
    "workspace/foldingRange/refresh",
]);

export interface TransportBridge {
    start(): void;
    dispose(): void;
}

/** Interceptors applied to messages flowing in each direction */
export interface MessageHandlers {
    processClientMessage: (msg: LspMessage) => LspMessage;
    processServerMessage: (msg: LspMessage) => LspMessage;
}

/** Options for the raw transport (caller spawns the process) */
export interface RawTransportOptions extends MessageHandlers {
    ws: WebSocket;
    serverProcess: ChildProcess;
}

/** Options for the jsonrpc transport (transport spawns via createServerProcess) */
export interface JsonRpcTransportOptions extends MessageHandlers {
    ws: WebSocket;
    serverName: string;
    command: string;
    args: string[];
    spawnOptions: SpawnOptions;
}
