// Transport layer types — Strategy pattern for WebSocket ↔ stdio bridging

import type { WebSocket } from "ws";
import type { ChildProcess, SpawnOptions } from "child_process";
import type { LspMessage } from "../lsp/types.js";
import type { ServerRequestArbiter } from "../lsp/server-requests.js";

export type TransportType = "raw" | "jsonrpc";

export interface TransportBridge {
    start(): void;
    dispose(): void;
}

/** Interceptors applied to messages flowing in each direction */
export interface MessageHandlers {
    processClientMessage: (msg: LspMessage) => LspMessage;
    processServerMessage: (msg: LspMessage) => LspMessage;
    /**
     * Builds the arbiter that decides which server→client requests the hub
     * answers itself. The transport owns the only channel to the server's
     * stdin, so it hands that channel over rather than the arbiter reaching
     * for one.
     */
    createArbiter?: (sendToServer: (msg: LspMessage) => void) => ServerRequestArbiter;
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
    /**
     * Called when the language server's stdout closes — i.e. the process died
     * or never started. The transport owns the process in this mode, so this is
     * the only signal the session has that the server is gone.
     */
    onServerExit?: (reason: string) => void;
}
