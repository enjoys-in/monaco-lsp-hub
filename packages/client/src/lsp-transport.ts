// LSP transport wrapper — wraps a WebSocket transport to intercept
// server→client notifications (window/showMessage, publishDiagnostics, etc.)
// while still passing everything through to MonacoLspClient.

import { showToast, lspMessageTypeToToast } from "./toast.js";

type LspMessage = {
    jsonrpc: "2.0";
    method?: string;
    params?: any;
    id?: number | string;
    result?: any;
    error?: any;
};

export type DiagnosticCallback = (uri: string, diagnostics: any[]) => void;

/**
 * Create a proxy transport that intercepts server messages before Monaco sees them.
 * Returns the proxy transport (pass this to MonacoLspClient instead of the raw transport).
 */
export function createInterceptingTransport(
    transport: any,
    callbacks: {
        onDiagnostics?: DiagnosticCallback;
    } = {},
): any {
    const proxy = Object.create(transport);

    // Intercept setListener to wrap the message listener
    const originalSetListener = transport.setListener.bind(transport);
    proxy.setListener = (listener: ((msg: any) => void) | undefined) => {
        if (!listener) {
            originalSetListener(undefined);
            return;
        }

        originalSetListener((message: LspMessage) => {
            // Intercept window/showMessage
            if (message.method === "window/showMessage" && message.params) {
                const { type, message: text } = message.params;
                showToast({
                    message: text,
                    type: lspMessageTypeToToast(type),
                });
            }

            // Intercept window/showMessageRequest — show as toast with actions
            if (message.method === "window/showMessageRequest" && message.params) {
                const { type, message: text } = message.params;
                showToast({
                    message: text,
                    type: lspMessageTypeToToast(type),
                    duration: 0, // sticky
                });
            }

            // Intercept window/logMessage — log to console
            if (message.method === "window/logMessage" && message.params) {
                const { type, message: text } = message.params;
                const levels = ["", "error", "warn", "info", "log"];
                const level = levels[type] ?? "log";
                (console as any)[level]?.(`[LSP] ${text}`);
            }

            // Intercept textDocument/publishDiagnostics
            if (message.method === "textDocument/publishDiagnostics" && message.params) {
                callbacks.onDiagnostics?.(
                    message.params.uri,
                    message.params.diagnostics ?? [],
                );
            }

            // Always pass through to Monaco's listener
            listener(message);
        });
    };

    // Proxy send/state/toString to the original transport
    proxy.send = transport.send.bind(transport);
    proxy.close = transport.close?.bind(transport);

    Object.defineProperty(proxy, "state", {
        get: () => transport.state,
    });

    proxy.toString = () => `InterceptingTransport(${transport.toString()})`;

    return proxy;
}
