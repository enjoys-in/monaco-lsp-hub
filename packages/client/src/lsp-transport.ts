// LSP transport wrapper — wraps a WebSocket transport to intercept
// server→client notifications (window/showMessage, window/logMessage) and
// surface them as toasts, while still passing everything through to
// MonacoLspClient.
//
// Diagnostics are deliberately *not* intercepted here: the editor's
// onDidChangeMarkers event already reports them once the client has applied
// them, and mirroring publishDiagnostics on a timer raced that path.

import { showToast, lspMessageTypeToToast } from "./toast.js";

type LspMessage = {
    jsonrpc: "2.0";
    method?: string;
    params?: any;
    id?: number | string;
    result?: any;
    error?: any;
};

/**
 * Create a proxy transport that intercepts server messages before Monaco sees them.
 * Returns the proxy transport (pass this to MonacoLspClient instead of the raw transport).
 */
export function createInterceptingTransport(transport: any): any {
    const proxy = Object.create(transport);

    // Intercept setListener to wrap the message listener
    const originalSetListener = transport.setListener.bind(transport);
    proxy.setListener = (listener: ((msg: any) => void) | undefined) => {
        if (!listener) {
            originalSetListener(undefined);
            return;
        }

        originalSetListener((message: LspMessage) => {
            if (message.params) {
                switch (message.method) {
                    case "window/showMessage":
                        showToast({
                            message: message.params.message,
                            type: lspMessageTypeToToast(message.params.type),
                        });
                        break;

                    case "window/showMessageRequest":
                        showToast({
                            message: message.params.message,
                            type: lspMessageTypeToToast(message.params.type),
                            duration: 0, // sticky
                        });
                        break;

                    case "window/logMessage": {
                        const levels = ["", "error", "warn", "info", "log"];
                        const level = levels[message.params.type] ?? "log";
                        (console as any)[level]?.(`[LSP] ${message.params.message}`);
                        break;
                    }
                }
            }

            // Always pass through to Monaco's listener
            listener(message);
        });
    };

    // Proxy send/close/state to the original transport. `close` is assigned
    // only when it exists — writing `undefined` would shadow the prototype's
    // method and make the proxy unclosable.
    proxy.send = transport.send.bind(transport);
    if (typeof transport.close === "function") {
        proxy.close = transport.close.bind(transport);
    }

    Object.defineProperty(proxy, "state", {
        get: () => transport.state,
    });

    proxy.toString = () => `InterceptingTransport(${transport.toString()})`;

    return proxy;
}
