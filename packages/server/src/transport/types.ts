// Transport layer types — Strategy pattern for WebSocket ↔ stdio bridging

import type { WebSocket } from "ws";
import type { ChildProcess, SpawnOptions } from "child_process";
import type { LspMessage } from "../lsp/types.js";

export type TransportType = "raw" | "jsonrpc";

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
