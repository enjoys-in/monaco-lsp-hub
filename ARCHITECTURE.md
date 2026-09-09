# Architecture — Request Flow

How a single LSP request travels from the browser to a language server and back.

## Overview

```
Browser (Monaco Editor)
    │
    │  WebSocket: ws://host:9601/lsp/python
    ▼
┌──────────────────────────────────────────────────────────────┐
│  Server (packages/server)                                    │
│                                                              │
│  main.ts ─► launcher.ts ─► jsonrpc.ts ─► interceptor.ts     │
│                                │                             │
│                                ▼                             │
│                        Language Server                       │
│                     (pyright-langserver)                      │
│                         stdin / stdout                        │
└──────────────────────────────────────────────────────────────┘
```

## Step-by-Step Flow

### 1. WebSocket Connection

**File:** [`packages/server/src/main.ts`](packages/server/src/main.ts)

Browser opens a WebSocket to `ws://host:9601/lsp/python`.

```
httpServer.on("upgrade") → extracts pathname "/lsp/python"
                         → resolveServer("/lsp/python") looks up config
                         → wss.handleUpgrade() accepts the WebSocket
                         → launchLanguageServer(ws, serverConfig, transport, "python")
```

The **URL path is the selector** — each path maps to a different language server binary:

| Path | Server | Binary |
|------|--------|--------|
| `/lsp/python` | Pyright | `pyright-langserver --stdio` |
| `/lsp/typescript` | TypeScript | `typescript-language-server --stdio` |
| `/lsp/go` | gopls | `gopls serve` |
| `/lsp/rust` | rust-analyzer | `rust-analyzer` |
| `/lsp/json` | JSON | `vscode-json-language-server --stdio` |

Full mapping defined in [`packages/server/src/config/servers.ts`](packages/server/src/config/servers.ts).

### 2. Launch Language Server

**File:** [`packages/server/src/launcher.ts`](packages/server/src/launcher.ts) — `launchLanguageServer()`

```
launchLanguageServer(ws, config, transport, langId)
    │
    ├── createWorkspace()           → creates temp dir (e.g. /tmp/lsp-xyz/)
    ├── scaffoldWorkspace()         → writes project files (go.mod, Cargo.toml, etc.)
    ├── createInterceptor(workspace) → URI rewriting + file sync handlers
    │
    └── new JsonRpcTransportBridge({
            ws,                      ← browser WebSocket
            command: "pyright-langserver",  ← from config
            args: ["--stdio"],
            processClientMessage,    ← interceptor (client → server)
            processServerMessage,    ← interceptor (server → client)
        })
```

### 3. Transport Bridge — Spawn & Connect

**File:** [`packages/server/src/transport/jsonrpc.ts`](packages/server/src/transport/jsonrpc.ts) — `JsonRpcTransportBridge.start()`

```
start()
    │
    ├── toIWebSocket(ws)            → adapts ws to IWebSocket interface
    ├── new WebSocketMessageReader   → reads JSON-RPC from browser
    ├── new WebSocketMessageWriter   → writes JSON-RPC to browser
    │
    └── createServerProcess(         → spawns the language server binary
            "Python (Pyright)",        as a child process, wraps
            "pyright-langserver",      stdin/stdout with Content-Length
            ["--stdio"]                framed JSON-RPC readers/writers
        )
        │
        └── Returns serverConn:
              .writer → writes to child process stdin
              .reader → reads from child process stdout
```

The language server binary communicates via the standard [LSP base protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#baseProtocol):

```
Content-Length: 152\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

### 4. Message Flow — Client to Server (C→S)

**Files:** `jsonrpc.ts` → [`packages/server/src/lsp/interceptor.ts`](packages/server/src/lsp/interceptor.ts) — `processClientMessage()`

```
Browser sends:
  {"method":"textDocument/hover","params":{"textDocument":{"uri":"file:///workspace/main.py"},...}}
      │
      ▼
wsReader.listen(message)                    ← jsonrpc.ts line 70
      │
      ▼
processClientMessage(msg)                   ← interceptor.ts
      │
      ├── initialize: rewrites rootUri/rootPath to temp dir, and replaces
      │   processId with the hub's (servers that monitor it exit otherwise)
      ├── rewriteToServer(params)             → file:///workspace/main.py
      │                                       → file:///tmp/lsp-xyz/main.py
      │   Normalizes the URI on the way through and remembers the client's
      │   own spelling, so responses can be handed back byte-identically.
      ├── didOpen: syncs file content to disk, scaffolds for the real filename
      ├── didChange: applies incremental edits to disk (disk-backed baseline)
      └── didClose: schedules file removal
      │
      ▼
serverConn.writer.write(transformed)        ← writes to pyright stdin
```

### 5. Message Flow — Server to Client (S→C)

**Files:** `jsonrpc.ts` → `interceptor.ts` — `processServerMessage()`

```
Pyright writes to stdout:
  {"jsonrpc":"2.0","id":8,"result":{"contents":{"kind":"markdown","value":"..."}}}
      │
      ▼
serverConn.reader.listen(message)           ← jsonrpc.ts line 80
      │
      ├── Arbiter check (lsp/server-requests.ts):
      │   • workspace/*/refresh — answered immediately, never forwarded
      │   • workspace/configuration, client/registerCapability,
      │     window/workDoneProgress/create, workspace/applyEdit, …
      │     forwarded, then answered with a protocol-valid default if the
      │     client stays silent for 1.5s. A late client reply is dropped so
      │     the server never sees two responses for one id.
      │
      ▼
processServerMessage(msg)                   ← interceptor.ts
      │
      ├── rewriteToClient(result)            → file:///tmp/lsp-xyz/main.py
      │                                      → file:///workspace/main.py
      ├── restores the client's original URI spelling via the alias map
      └── scrubs bare temp paths out of message text (diagnostics, hovers)
      │
      ▼
wsWriter.write(transformed)                 ← sends back to browser WebSocket
```

### 6. Client Receives Response

**Client 1** ([`packages/client/src/main.ts`](packages/client/src/main.ts)):
Monaco's native `monaco.lsp.LanguageClient` handles everything automatically — parses the response, updates the editor UI.

**Client 2** ([`packages/client2/src/lsp/`](packages/client2/src/lsp/)):
`@hediet/json-rpc` dispatches the response to the matching pending request promise. The feature class (e.g. `LspHoverFeature`) converts LSP types to Monaco types and returns to Monaco's provider API.

```
wsWriter.write(response)
    │
    ▼  (browser WebSocket)
TypedChannel receives response, resolves promise
    │
    ▼
LspHoverFeature.provideHover() gets result
    │
    ├── Converts MarkupContent → monaco.IMarkdownString
    ├── Converts LSP Range → Monaco Range (via translateBackRange)
    └── Returns monaco.languages.Hover to Monaco
    │
    ▼
Monaco renders the hover tooltip
```

## Complete Request Lifecycle Example

A hover request on `main.py` line 7, character 11:

```
1. Browser → WS:     {"id":8,"method":"textDocument/hover",
                       "params":{"textDocument":{"uri":"file:///workspace/main.py"},
                                 "position":{"line":7,"character":11}}}

2. wsReader          Receives JSON-RPC message from WebSocket frame

3. interceptor       Rewrites URI:
                     file:///workspace/main.py → file:///tmp/lsp-abc/main.py

4. serverConn        Writes to pyright stdin:
   .writer           Content-Length: 153\r\n\r\n{"id":8,...,"uri":"file:///tmp/lsp-abc/main.py",...}

5. pyright           Processes the request, analyzes the Python AST

6. serverConn        Reads from pyright stdout:
   .reader           {"id":8,"result":{"contents":{"kind":"markdown","value":"..."}}}

7. interceptor       Rewrites URI back:
                     file:///tmp/lsp-abc/main.py → file:///workspace/main.py

8. wsWriter          Sends JSON-RPC response over WebSocket frame

9. Browser           Monaco renders hover tooltip with markdown content
```

## Transport Modes

The server supports two transport strategies, selected via `?transport=` query param:

| Mode | File | How it works |
|------|------|-------------|
| `jsonrpc` (default) | [`transport/jsonrpc.ts`](packages/server/src/transport/jsonrpc.ts) | `vscode-ws-jsonrpc` handles spawn + Content-Length framing |
| `raw` | [`transport/raw.ts`](packages/server/src/transport/raw.ts) | Manual `child_process.spawn` + hand-written Content-Length parser |

Both modes use the same interceptor for URI rewriting and file synchronization,
and the same arbiter for server→client requests.

## Single-file sessions

The hub is built for one file per session, not a checked-out project — the
common case when the editor's files live behind SFTP rather than on disk.

* The workspace holds whatever the client sends and nothing more. `didOpen` on a
  new URI is the only way a file gets there.
* Scaffolding follows the **real** filename. `Cargo.toml`'s `[[bin]] path` is
  rewritten from the first source document the client opens, because a session
  editing `render.rs` has no `main.rs` for the pre-spawn guess to point at.
* A project file the client sends itself always wins over the hub's stand-in.
* URIs round-trip byte-identically. Clients differ on how much they encode, and
  a name containing a space, `%` or `#` — ordinary over SFTP — is normalized for
  the language server and restored for the client, which matches diagnostics to
  its documents by string equality.
* Unresolved-import diagnostics are passed through as the server reports them.
  With one file and no dependency tree they are expected, not filtered.

## Session liveness

Idle LSP sessions are normal — a user reading code sends nothing for minutes —
and the proxies in front of a cloud deployment close idle WebSockets at around
60s. The launcher pings every 25s and terminates a socket that misses two
consecutive pongs. This is separate from `lib/keep-me-alive.ts`, which pings the
HTTP health endpoint to keep the *process* warm and does nothing for sockets.

## Key Files Reference

| File | Purpose |
|------|---------|
| [`server/src/main.ts`](packages/server/src/main.ts) | HTTP server, WebSocket upgrade handler |
| [`server/src/config/servers.ts`](packages/server/src/config/servers.ts) | Language server registry (path → binary mapping) |
| [`server/src/launcher.ts`](packages/server/src/launcher.ts) | Workspace creation, interceptor setup, transport init |
| [`server/src/lsp/interceptor.ts`](packages/server/src/lsp/interceptor.ts) | URI rewriting, file sync to disk |
| [`server/src/lsp/workspace.ts`](packages/server/src/lsp/workspace.ts) | Temp directory management, URI translation and normalization |
| [`server/src/lsp/scaffold.ts`](packages/server/src/lsp/scaffold.ts) | Project file scaffolding for the real filename (Cargo.toml, go.mod, …) |
| [`server/src/transport/jsonrpc.ts`](packages/server/src/transport/jsonrpc.ts) | JSON-RPC transport bridge (WebSocket ↔ stdio) |
| [`server/src/transport/raw.ts`](packages/server/src/transport/raw.ts) | Raw transport bridge with manual framing |
| [`server/src/transport/types.ts`](packages/server/src/transport/types.ts) | Transport interfaces |
| [`server/src/lsp/server-requests.ts`](packages/server/src/lsp/server-requests.ts) | Answers server→client requests a client leaves unanswered |
