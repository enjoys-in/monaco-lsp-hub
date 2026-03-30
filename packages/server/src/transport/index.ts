// Transport factory — creates the appropriate transport bridge

export type {
    TransportType,
    TransportBridge,
    MessageHandlers,
    RawTransportOptions,
    JsonRpcTransportOptions,
} from "./types.js";
export { RawTransportBridge } from "./raw.js";
export { JsonRpcTransportBridge } from "./jsonrpc.js";
