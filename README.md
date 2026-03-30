# Monaco LSP Hub

A self-hosted, multi-language code editor powered by [Monaco Editor](https://microsoft.github.io/monaco-editor/) with full [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) support over WebSocket. Connect to **44+ language servers** from the browser — no extensions, no plugins, no local installs.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  ┌────────────────────┐  ┌────────────────────────────┐ │
│  │  client (port 9600)│  │  client2 (port 9602)       │ │
│  │  Monaco + native   │  │  Monaco + @hediet/json-rpc │ │
│  │  lsp namespace     │  │  + MonacoLspClient         │ │
│  └────────┬───────────┘  └─────────────┬──────────────┘ │
└───────────┼────────────────────────────┼────────────────┘
            │ WebSocket                  │ WebSocket
            │ ws://host:9601/lsp/{lang}  │
            ▼                            ▼
┌─────────────────────────────────────────────────────────┐
│  Server (port 9601)                                     │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ HTTP (Hono)  │  │ WS Proxy  │  │ LSP Interceptor  │ │
│  │ /api/*       │  │ upgrade → │──│ URI rewrite      │ │
│  │ static files │  │ spawn LSP │  │ file sync        │ │
│  └──────────────┘  └───────────┘  └──────────────────┘ │
│                         │                               │
│              ┌──────────┴──────────┐                    │
│              ▼                     ▼                    │
│     ┌──────────────┐    ┌──────────────────┐           │
│     │ npm servers  │    │ system servers   │           │
│     │ (node_modules)│   │ (prebuilt bins)  │           │
│     └──────────────┘    └──────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

## Supported Languages

### npm-based Language Servers

Installed via `node_modules` — always available.

| Language | Server | WebSocket Endpoint |
|---|---|---|
| JSON | vscode-json-language-server | `ws://host:9601/lsp/json` |
| HTML | vscode-html-language-server | `ws://host:9601/lsp/html` |
| CSS / SCSS / Less | vscode-css-language-server | `ws://host:9601/lsp/css` |
| Markdown | vscode-markdown-language-server | `ws://host:9601/lsp/markdown` |
| ESLint | vscode-eslint-language-server | `ws://host:9601/lsp/eslint` |
| YAML | yaml-language-server | `ws://host:9601/lsp/yaml` |
| TypeScript / JavaScript | typescript-language-server | `ws://host:9601/lsp/typescript` |
| Python (Pyright) | pyright-langserver | `ws://host:9601/lsp/python` |
| Bash / Shell | bash-language-server | `ws://host:9601/lsp/shellscript` |
| Dockerfile | docker-langserver | `ws://host:9601/lsp/dockerfile` |
| Svelte | svelteserver | `ws://host:9601/lsp/svelte` |
| GraphQL | graphql-lsp | `ws://host:9601/lsp/graphql` |
| SQL | sql-language-server | `ws://host:9601/lsp/sql` |
| Ansible | ansible-language-server | `ws://host:9601/lsp/ansible` |
| Vue | vue-language-server | `ws://host:9601/lsp/vue` |
| Astro | astro-ls | `ws://host:9601/lsp/astro` |
| Elm | elm-language-server | `ws://host:9601/lsp/elm` |
| Diagnostic | diagnostic-languageserver | `ws://host:9601/lsp/diagnostic` |
| Tailwind CSS | tailwindcss-language-server | `ws://host:9601/lsp/tailwindcss` |
| VimScript | vim-language-server | `ws://host:9601/lsp/vim` |
| Biome | biome lsp-proxy | `ws://host:9601/lsp/biome` |

### System-based Language Servers

Prebuilt binaries bundled in Docker — available when the binary is on `PATH`.

| Language | Server | WebSocket Endpoint |
|---|---|---|
| Rust | rust-analyzer | `ws://host:9601/lsp/rust` |
| Go | gopls | `ws://host:9601/lsp/go` |
| C / C++ | clangd | `ws://host:9601/lsp/c` |
| Lua | lua-language-server | `ws://host:9601/lsp/lua` |
| Zig | zls | `ws://host:9601/lsp/zig` |
| Java | Eclipse JDT LS | `ws://host:9601/lsp/java` |
| Kotlin | kotlin-language-server | `ws://host:9601/lsp/kotlin` |
| Scala | Metals | `ws://host:9601/lsp/scala` |
| TOML | Taplo | `ws://host:9601/lsp/toml` |
| XML | LemMinX | `ws://host:9601/lsp/xml` |
| Terraform / HCL | terraform-ls | `ws://host:9601/lsp/terraform` |
| Clojure | clojure-lsp | `ws://host:9601/lsp/clojure` |
| LaTeX | texlab | `ws://host:9601/lsp/latex` |
| Dart | Dart SDK | `ws://host:9601/lsp/dart` |
| Python (pylsp) | python-lsp-server | `ws://host:9601/lsp/pylsp` |
| CMake | cmake-language-server | `ws://host:9601/lsp/cmake` |
| reStructuredText | Esbonio | `ws://host:9601/lsp/restructuredtext` |
| Nginx | nginx-language-server | `ws://host:9601/lsp/nginx` |
| Ruby | Solargraph | `ws://host:9601/lsp/ruby` |
| PHP | phpactor | `ws://host:9601/lsp/php` |
| Helm | helm-ls | `ws://host:9601/lsp/helm` |
| Harper (grammar) | harper-ls | `ws://host:9601/lsp/harper` |

### Language Aliases

| Alias | Resolves To |
|---|---|
| `javascript`, `typescriptreact`, `javascriptreact` | `typescript` |
| `cpp`, `objective-c` | `c` |
| `scss`, `less` | `css` |
| `jsonc` | `json` |
| `yml` | `yaml` |
| `bash`, `sh`, `zsh`, `shell` | `shellscript` |
| `hcl` | `terraform` |
| `dockercompose` | `dockerfile` |
| `mysql`, `pgsql` | `sql` |

## Monaco Built-in LSP

Monaco Editor (v0.55+) includes a built-in `monaco.lsp` namespace that provides native LSP support without additional libraries. This project offers two client implementations:

### Client 1 — Native `monaco.lsp`

Uses Monaco's built-in LSP namespace to create a language client directly:

```typescript
import * as monaco from "monaco-editor";

const transport = monaco.lsp.WebSocketTransport.create(wsUrl);
const client = monaco.lsp.LanguageClient.create(transport);
```

The native namespace handles:
- Transport framing (WebSocket ↔ JSON-RPC)
- `textDocument/didOpen`, `didChange`, `didClose` synchronization
- Provider registration from server capabilities (completion, hover, diagnostics, etc.)
- Dynamic capability registration via `client/registerCapability`

### Client 2 — `@hediet/json-rpc` + MonacoLspClient

Alternative approach using `@hediet/json-rpc-websocket` for transport and a custom `MonacoLspClient` that manually registers 22 Monaco providers from LSP server capabilities:

- Completion, Hover, Signature Help
- Go to Definition, Declaration, Type Definition, Implementation
- References, Document Highlight, Document Symbol
- Rename, Code Action, Code Lens, Document Link
- Formatting, Range Formatting, On-Type Formatting
- Folding Range, Selection Range, Inlay Hints
- Semantic Tokens, Diagnostics

Both clients connect via the same WebSocket endpoint and protocol — raw JSON-RPC 2.0 messages per WebSocket frame.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/) (for production deployment)

### Local Development

```bash
# Install dependencies
bun install

# Run everything (server + clients)
bun run dev

# Or run individually:
bun run dev:server    # http://localhost:9601
bun run dev:client    # http://localhost:9600  (client 1)
bun run --cwd packages/client2 dev  # http://localhost:9602  (client 2)
```

> Note: System-based servers (Rust, Go, C/C++, etc.) require their binaries on PATH when running locally. npm-based servers work out of the box.

### Docker

```bash
# Build and run
docker compose up -d

# Access the editor
open http://localhost:9601
```

The Docker image bundles all 44 language servers in a single container using a multi-stage build:

1. **builder** — installs npm deps, builds client and server with Vite/Bun
2. **systools** — downloads prebuilt binaries and installs pip/gem servers on Debian bookworm
3. **production** — minimal `bun:1-slim` image with only runtime deps and built artifacts

## API

### `GET /api/languages`

Returns the list of available language servers:

```json
[
  { "id": "json", "name": "JSON" },
  { "id": "typescript", "name": "TypeScript" },
  { "id": "rust", "name": "Rust (rust-analyzer)" }
]
```

### `WebSocket /lsp/{languageId}`

Upgrade to a WebSocket connection for LSP communication. Each connection spawns a dedicated language server process with an isolated temp workspace.

Query parameters:
- `transport=jsonrpc` (default) — raw JSON-RPC messages per frame
- `transport=raw` — raw byte stream with Content-Length framing

## Project Structure

```
monaco-lsp-hub/
├── packages/
│   ├── client/          # Client 1: Monaco native lsp namespace
│   │   └── src/
│   │       ├── main.ts
│   │       ├── config.ts
│   │       └── lsp-transport.ts
│   ├── client2/         # Client 2: @hediet/json-rpc + MonacoLspClient
│   │   └── src/
│   │       ├── main.ts
│   │       ├── config.ts
│   │       ├── toast.ts
│   │       └── lsp/
│   │           ├── LspClient.ts
│   │           ├── LspConnection.ts
│   │           ├── TextDocumentSynchronizer.ts
│   │           ├── types.ts           # Full LSP contract (7500+ lines)
│   │           └── features/          # 22 Monaco provider registrations
│   └── server/          # LSP WebSocket proxy server
│       └── src/
│           ├── main.ts
│           ├── config/
│           │   └── servers.ts         # Language server registry
│           ├── lsp/
│           │   ├── interceptor.ts     # URI rewriting & file sync
│           │   ├── launcher.ts        # Process spawning
│           │   └── scaffold.ts        # Workspace scaffolding
│           └── workspace/             # Temp workspace management
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## How It Works

1. **Client connects** via WebSocket to `ws://host:9601/lsp/{lang}`
2. **Server resolves** the language ID to a server config (direct or alias)
3. **Temp workspace** is created per session with scaffolded project files (e.g., `Cargo.toml` for Rust, `go.mod` for Go)
4. **LSP process** is spawned with stdio transport
5. **Interceptor** sits between client and server:
   - Rewrites `file:///workspace/` URIs to the temp directory
   - Syncs file content from `textDocument/didOpen` and `didChange` to disk
   - Rewrites URIs back in server responses
6. **Client receives** standard LSP responses and registers Monaco providers

## License

MIT
