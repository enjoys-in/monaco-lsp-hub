// Arbiter for server→client requests.
//
// A language server that asks the client something and never gets an answer
// stalls. gopls, rust-analyzer and jdtls all send `workspace/configuration`
// and `window/workDoneProgress/create` during initialization and wait for the
// reply before reporting a single diagnostic — so a client that has no handler
// for them does not merely miss a feature, it hangs the whole session.
//
// The hub cannot know in advance which requests a given client handles, and
// answering on its behalf unconditionally would steal replies from clients that
// do. So each request is forwarded as normal and given a grace period; only if
// the client stays silent does the hub answer with a protocol-valid default,
// and the client's late reply (if it ever arrives) is dropped so the server
// never sees two responses for one id.

import type { LspMessage } from "./types.js";

/**
 * Server→client requests no client needs to see. These are pure invalidation
 * signals: the correct reply is an empty result, and forwarding them only gives
 * a client the chance to not answer.
 */
const AUTO_RESPOND_METHODS = new Set([
    "workspace/diagnostic/refresh",
    "workspace/semanticTokens/refresh",
    "workspace/inlineValue/refresh",
    "workspace/inlayHint/refresh",
    "workspace/codeLens/refresh",
    "workspace/foldingRange/refresh",
]);

/** How long a client gets to answer a server request before the hub steps in */
const CLIENT_REPLY_GRACE_MS = 1500;

/** How long an id stays remembered so a late client reply can be dropped */
const ANSWERED_ID_TTL_MS = 30_000;

export interface ServerRequestArbiter {
    /** Whether a server→client message should be forwarded to the client */
    handleServerMessage(msg: LspMessage): "forward" | "answered";
    /** Whether a client→server message should be forwarded to the server */
    handleClientMessage(msg: LspMessage): "forward" | "drop";
    dispose(): void;
}

export interface ArbiterOptions {
    serverName: string;
    /** Real (temp-dir) workspace URI — the arbiter writes past the interceptor */
    workspaceUri: string;
    sendToServer: (msg: LspMessage) => void;
}

/** Protocol-valid stand-in answers, by method */
function defaultResult(msg: LspMessage, workspaceUri: string): unknown {
    switch (msg.method) {
        case "workspace/configuration": {
            // One entry per requested item, or the server indexes past the end.
            //
            // `{}` and not `null`: an empty settings object means "no overrides,
            // use your defaults", while `null` reads as "that section does not
            // exist" and several servers then disable the feature it gates.
            // vscode-css-language-server, measured against this hub, publishes
            // no diagnostics at all for a `null` reply and works with `{}`.
            const items = (msg.params as { items?: unknown[] } | undefined)?.items;
            return Array.isArray(items) ? items.map(() => ({})) : [];
        }
        case "workspace/workspaceFolders":
            return [{ uri: workspaceUri, name: "workspace" }];
        case "workspace/applyEdit":
            return { applied: false, failureReason: "No client handler for workspace/applyEdit" };
        case "window/showMessageRequest":
            // null means "the user dismissed it without choosing an action".
            return null;
        default:
            // client/registerCapability, client/unregisterCapability,
            // window/workDoneProgress/create — all void results.
            return null;
    }
}

/** Server→client requests that are forwarded, but answered if the client is silent */
const FALLBACK_METHODS = new Set([
    "workspace/configuration",
    "workspace/workspaceFolders",
    "workspace/applyEdit",
    "window/showMessageRequest",
    "window/workDoneProgress/create",
    "client/registerCapability",
    "client/unregisterCapability",
]);

export function createServerRequestArbiter(opts: ArbiterOptions): ServerRequestArbiter {
    const { serverName, workspaceUri, sendToServer } = opts;

    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const answered = new Map<string, ReturnType<typeof setTimeout>>();
    let disposed = false;

    function respond(id: NonNullable<LspMessage["id"]>, result: unknown): void {
        sendToServer({ jsonrpc: "2.0", id, result } as LspMessage);
    }

    function handleServerMessage(msg: LspMessage): "forward" | "answered" {
        if (disposed) return "forward";

        // Notifications and responses are not ours to answer.
        if (msg.id === undefined || msg.id === null || !msg.method) return "forward";

        if (AUTO_RESPOND_METHODS.has(msg.method)) {
            respond(msg.id, null);
            return "answered";
        }

        if (!FALLBACK_METHODS.has(msg.method)) return "forward";

        const key = String(msg.id);
        const method = msg.method;
        const params = msg.params;

        // Ids are meant to be unique per request, but a server that recycles
        // one must not leave the previous timer armed against it.
        const superseded = pending.get(key);
        if (superseded) clearTimeout(superseded);

        const timer = setTimeout(() => {
            pending.delete(key);
            if (disposed) return;
            console.warn(
                `[LSP:${serverName}] Client did not answer ${method} in ${CLIENT_REPLY_GRACE_MS}ms — replying with a default`,
            );
            respond(msg.id!, defaultResult({ jsonrpc: "2.0", method, params }, workspaceUri));

            // Remember the id so the client's late reply can be discarded: two
            // responses for one id is a protocol violation the server may treat
            // as fatal.
            const expiry = setTimeout(() => answered.delete(key), ANSWERED_ID_TTL_MS);
            expiry.unref?.();
            answered.set(key, expiry);
        }, CLIENT_REPLY_GRACE_MS);
        timer.unref?.();
        pending.set(key, timer);

        return "forward";
    }

    function handleClientMessage(msg: LspMessage): "forward" | "drop" {
        if (disposed) return "forward";

        // Only responses matter here: id present, no method.
        if (msg.id === undefined || msg.id === null || msg.method !== undefined) return "forward";

        const key = String(msg.id);

        const timer = pending.get(key);
        if (timer) {
            clearTimeout(timer);
            pending.delete(key);
            return "forward";
        }

        const late = answered.get(key);
        if (late) {
            clearTimeout(late);
            answered.delete(key);
            console.warn(`[LSP:${serverName}] Dropping late client response for id ${key}`);
            return "drop";
        }

        return "forward";
    }

    function dispose(): void {
        if (disposed) return;
        disposed = true;
        for (const t of pending.values()) clearTimeout(t);
        for (const t of answered.values()) clearTimeout(t);
        pending.clear();
        answered.clear();
    }

    return { handleServerMessage, handleClientMessage, dispose };
}
