// Copyright (c) 2024 Monaco LSP Hub
// WebSocket server that routes connections to language server processes

import express from "express";
import { createServer } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import { spawn, execSync, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import fs from "fs";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

// ── Language Server Configurations ───────────────────────────────────────────
// Each entry maps a WebSocket path to a language server command.
// All servers communicate via stdio (stdin/stdout).

interface ServerConfig {
    name: string;
    command: string;
    args: string[];
}

function resolveServerBin(_pkg: string, bin: string): string {
    // Resolve the binary from this package's own node_modules
    return path.resolve(PKG_ROOT, "node_modules", ".bin", bin);
}

/** Try to find a binary on the system PATH. Returns the path or null. */
function findSystemBin(bin: string): string | null {
    try {
        const cmd = process.platform === "win32" ? "where" : "which";
        const result = execSync(`${cmd} ${bin}`, { encoding: "utf-8", timeout: 5000 }).trim();
        // "where" on Windows may return multiple lines
        return result.split(/\r?\n/)[0] || null;
    } catch {
        return null;
    }
}

// ── npm-installed language servers ───────────────────────────────────────────

const NPM_SERVERS: Record<string, ServerConfig> = {
    // ── vscode-langservers-extracted ─────────────────────────────────────────
    "/lsp/json": {
        name: "JSON",
        command: resolveServerBin("vscode-langservers-extracted", "vscode-json-language-server"),
        args: ["--stdio"],
    },
    "/lsp/html": {
        name: "HTML",
        command: resolveServerBin("vscode-langservers-extracted", "vscode-html-language-server"),
        args: ["--stdio"],
    },
    "/lsp/css": {
        name: "CSS",
        command: resolveServerBin("vscode-langservers-extracted", "vscode-css-language-server"),
        args: ["--stdio"],
    },
    "/lsp/markdown": {
        name: "Markdown",
        command: resolveServerBin("vscode-langservers-extracted", "vscode-markdown-language-server"),
        args: ["--stdio"],
    },
    "/lsp/eslint": {
        name: "ESLint",
        command: resolveServerBin("vscode-langservers-extracted", "vscode-eslint-language-server"),
        args: ["--stdio"],
    },

    // ── Standalone npm servers ───────────────────────────────────────────────
    "/lsp/yaml": {
        name: "YAML",
        command: resolveServerBin("yaml-language-server", "yaml-language-server"),
        args: ["--stdio"],
    },
    "/lsp/typescript": {
        name: "TypeScript",
        command: resolveServerBin("typescript-language-server", "typescript-language-server"),
        args: ["--stdio"],
    },
    "/lsp/python": {
        name: "Python (Pyright)",
        command: resolveServerBin("pyright", "pyright-langserver"),
        args: ["--stdio"],
    },
    "/lsp/shellscript": {
        name: "Bash",
        command: resolveServerBin("bash-language-server", "bash-language-server"),
        args: ["start"],
    },
    "/lsp/dockerfile": {
        name: "Dockerfile",
        command: resolveServerBin("dockerfile-language-server-nodejs", "docker-langserver"),
        args: ["--stdio"],
    },
    "/lsp/svelte": {
        name: "Svelte",
        command: resolveServerBin("svelte-language-server", "svelteserver"),
        args: ["--stdio"],
    },
    "/lsp/graphql": {
        name: "GraphQL",
        command: resolveServerBin("graphql-language-service-cli", "graphql-lsp"),
        args: ["server", "-m", "stream"],
    },
    "/lsp/sql": {
        name: "SQL",
        command: resolveServerBin("sql-language-server", "sql-language-server"),
        args: ["up", "--method", "stdio"],
    },
    "/lsp/ansible": {
        name: "Ansible",
        command: resolveServerBin("@ansible/ansible-language-server", "ansible-language-server"),
        args: ["--stdio"],
    },
};

// ── System-installed language servers (auto-detected from PATH) ──────────────

interface SystemServerDef {
    name: string;
    bin: string;
    args: string[];
}

const SYSTEM_SERVER_DEFS: Record<string, SystemServerDef> = {
    // ── Compiled-language servers (prebuilt binaries) ─────────────────────────
    "/lsp/rust": { name: "Rust (rust-analyzer)", bin: "rust-analyzer", args: [] },
    "/lsp/go": { name: "Go (gopls)", bin: "gopls", args: ["serve"] },
    "/lsp/c": { name: "C/C++ (clangd)", bin: "clangd", args: [] },
    "/lsp/lua": { name: "Lua", bin: "lua-language-server", args: [] },
    "/lsp/zig": { name: "Zig (zls)", bin: "zls", args: [] },

    // ── JVM-based servers (require JRE) ──────────────────────────────────────
    "/lsp/java": { name: "Java (Eclipse JDT LS)", bin: "jdtls", args: [] },
    "/lsp/kotlin": { name: "Kotlin", bin: "kotlin-language-server", args: [] },
    "/lsp/scala": { name: "Scala (Metals)", bin: "metals", args: [] },

    // ── Data/config format servers ───────────────────────────────────────────
    "/lsp/toml": { name: "TOML (Taplo)", bin: "taplo", args: ["lsp", "stdio"] },
    "/lsp/xml": { name: "XML (LemMinX)", bin: "lemminx", args: [] },

    // ── Infrastructure/DevOps ────────────────────────────────────────────────
    "/lsp/terraform": { name: "Terraform", bin: "terraform-ls", args: ["serve"] },
    "/lsp/nix": { name: "Nix (nil)", bin: "nil", args: [] },

    // ── Functional languages ─────────────────────────────────────────────────
    "/lsp/clojure": { name: "Clojure", bin: "clojure-lsp", args: [] },

    // ── Documentation/markup ─────────────────────────────────────────────────
    "/lsp/latex": { name: "LaTeX (texlab)", bin: "texlab", args: [] },

    // ── Dart ─────────────────────────────────────────────────────────────────
    "/lsp/dart": { name: "Dart", bin: "dart", args: ["language-server", "--protocol=lsp"] },

    // ── Python-based servers (pip-installed) ─────────────────────────────────
    "/lsp/pylsp": { name: "Python (pylsp)", bin: "pylsp", args: [] },
    "/lsp/cmake": { name: "CMake", bin: "cmake-language-server", args: [] },
    "/lsp/restructuredtext": { name: "reStructuredText (esbonio)", bin: "esbonio", args: [] },
    "/lsp/nginx": { name: "Nginx", bin: "nginx-language-server", args: [] },

    // ── Ruby ─────────────────────────────────────────────────────────────────
    "/lsp/ruby": { name: "Ruby (Solargraph)", bin: "solargraph", args: ["stdio"] },

    // ── PHP ──────────────────────────────────────────────────────────────────
    "/lsp/php": { name: "PHP (phpactor)", bin: "phpactor", args: ["language-server"] },
};

// ── Aliases: multiple language IDs mapping to the same server ────────────────
const PATH_ALIASES: Record<string, string> = {
    // TypeScript/JavaScript variants → typescript-language-server
    "/lsp/javascript": "/lsp/typescript",
    "/lsp/typescriptreact": "/lsp/typescript",
    "/lsp/javascriptreact": "/lsp/typescript",

    // C++ / Objective-C → clangd
    "/lsp/cpp": "/lsp/c",
    "/lsp/objective-c": "/lsp/c",

    // CSS variants → vscode-css-language-server
    "/lsp/scss": "/lsp/css",
    "/lsp/less": "/lsp/css",

    // JSON variants
    "/lsp/jsonc": "/lsp/json",

    // YAML variants
    "/lsp/yml": "/lsp/yaml",

    // Shell variants → bash-language-server
    "/lsp/bash": "/lsp/shellscript",
    "/lsp/sh": "/lsp/shellscript",
    "/lsp/zsh": "/lsp/shellscript",
    "/lsp/shell": "/lsp/shellscript",

    // Terraform/HCL
    "/lsp/hcl": "/lsp/terraform",

    // Docker Compose → Dockerfile server (best effort)
    "/lsp/dockercompose": "/lsp/dockerfile",

    // SQL variants
    "/lsp/mysql": "/lsp/sql",
    "/lsp/pgsql": "/lsp/sql",

    // Protobuf (mapped to marksman as placeholder — no good standalone LSP)
    // Users can replace with buf-language-server when available
};

function detectSystemServers(): Record<string, ServerConfig> {
    const found: Record<string, ServerConfig> = {};
    for (const [wsPath, def] of Object.entries(SYSTEM_SERVER_DEFS)) {
        const binPath = findSystemBin(def.bin);
        if (binPath) {
            found[wsPath] = { name: def.name, command: binPath, args: def.args };
        }
    }
    return found;
}

const SYSTEM_SERVERS = detectSystemServers();
const LANGUAGE_SERVERS: Record<string, ServerConfig> = { ...NPM_SERVERS, ...SYSTEM_SERVERS };

// Resolve aliases to actual server configs
function resolveServer(pathname: string): ServerConfig | undefined {
    if (LANGUAGE_SERVERS[pathname]) return LANGUAGE_SERVERS[pathname];
    const target = PATH_ALIASES[pathname];
    if (target && LANGUAGE_SERVERS[target]) return LANGUAGE_SERVERS[target];
    return undefined;
}

// ── Express App ──────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);

// API: let the client know which language servers are available
app.get("/api/languages", (_req, res) => {
    const direct = Object.keys(LANGUAGE_SERVERS).map((p) => p.replace("/lsp/", ""));
    const aliased = Object.keys(PATH_ALIASES)
        .filter((p) => LANGUAGE_SERVERS[PATH_ALIASES[p]])
        .map((p) => p.replace("/lsp/", ""));
    res.json([...direct, ...aliased]);
});

// In production, serve the built client from the client package
const distPath = process.env.CLIENT_DIST_PATH
    ? path.resolve(process.env.CLIENT_DIST_PATH)
    : path.resolve(PKG_ROOT, "..", "client", "dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
});

// ── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const pathname = url.pathname;

    const serverConfig = resolveServer(pathname);
    if (!serverConfig) {
        console.warn(`[WS] No language server for path: ${pathname}`);
        socket.destroy();
        return;
    }

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        launchLanguageServer(ws, serverConfig);
    });
});

// ── Language Server Launcher ─────────────────────────────────────────────────
// Spawns a language server process and bridges WebSocket <-> stdio.
// Each WebSocket connection gets its own language server process with a temp workspace.
// This allows cloud-hosted deployments (no persistent filesystem) to work —
// file content from the editor is synced to a real temp directory on disk.

const VIRTUAL_ROOT = "file:///workspace";

function launchLanguageServer(ws: WebSocket, config: ServerConfig): void {
    console.log(`[LSP] Starting ${config.name} language server...`);

    // Create a real temp workspace directory for this session
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-workspace-"));
    const workDirUri = pathToFileURL(workDir).href;
    console.log(`[LSP] Temp workspace: ${workDir}`);

    let serverProcess: ChildProcess;
    try {
        serverProcess = spawn(config.command, config.args, {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: workDir,
            shell: process.platform === "win32",
        });
    } catch (err) {
        console.error(`[LSP] Failed to start ${config.name}:`, err);
        fs.rmSync(workDir, { recursive: true, force: true });
        ws.close(1011, `Failed to start ${config.name}`);
        return;
    }

    console.log(`[LSP] ${config.name} started (PID: ${serverProcess.pid})`);

    // Map a virtual file URI to a real path in the temp workspace
    function virtualToReal(uri: string): string {
        if (uri.startsWith(VIRTUAL_ROOT)) {
            return workDirUri + uri.substring(VIRTUAL_ROOT.length);
        }
        return uri;
    }

    // Map a real temp workspace URI back to the virtual URI for the client
    function realToVirtual(uri: string): string {
        if (uri.startsWith(workDirUri)) {
            return VIRTUAL_ROOT + uri.substring(workDirUri.length);
        }
        return uri;
    }

    // Recursively rewrite URIs in an object (both directions)
    function rewriteUris(obj: any, rewriter: (uri: string) => string): any {
        if (typeof obj === "string") {
            // Rewrite if it looks like a file URI
            if (obj.startsWith("file://")) return rewriter(obj);
            return obj;
        }
        if (Array.isArray(obj)) return obj.map((v) => rewriteUris(v, rewriter));
        if (obj && typeof obj === "object") {
            const result: any = {};
            for (const [k, v] of Object.entries(obj)) {
                result[k] = rewriteUris(v, rewriter);
            }
            return result;
        }
        return obj;
    }

    // Sync file content to disk so the language server can read it
    function syncFileToDisk(uri: string, content: string): void {
        try {
            const realUri = virtualToReal(uri);
            const filePath = new URL(realUri);
            fs.mkdirSync(path.dirname(filePath.pathname), { recursive: true });
            fs.writeFileSync(filePath.pathname, content, "utf-8");
        } catch (err) {
            console.error(`[LSP:${config.name}] Failed to sync file:`, err);
        }
    }

    // Intercept and transform messages from client → language server
    function processClientMessage(raw: string): string {
        try {
            const msg = JSON.parse(raw);

            // Rewrite initialize: set rootUri/rootPath to real temp dir
            if (msg.method === "initialize" && msg.params) {
                msg.params.rootUri = workDirUri;
                msg.params.rootPath = workDir;
                if (msg.params.workspaceFolders) {
                    msg.params.workspaceFolders = [{ uri: workDirUri, name: "workspace" }];
                }
            }

            // Rewrite all file:// URIs from virtual → real
            if (msg.params) {
                msg.params = rewriteUris(msg.params, virtualToReal);
            }

            // Sync file content on didOpen
            if (msg.method === "textDocument/didOpen" && msg.params?.textDocument) {
                const { uri, text } = msg.params.textDocument;
                syncFileToDisk(uri, text);
            }

            // Sync full content on didChange (full sync)
            if (msg.method === "textDocument/didChange" && msg.params) {
                const { uri } = msg.params.textDocument;
                const changes = msg.params.contentChanges;
                // For full document sync, last change has the full text
                const fullChange = changes?.find((c: any) => c.range === undefined);
                if (fullChange) {
                    syncFileToDisk(uri, fullChange.text);
                }
            }

            return JSON.stringify(msg);
        } catch {
            return raw;
        }
    }

    // Intercept and transform messages from language server → client
    function processServerMessage(raw: string): string {
        try {
            const msg = JSON.parse(raw);
            // Rewrite all file:// URIs from real → virtual
            if (msg.result !== undefined) {
                msg.result = rewriteUris(msg.result, realToVirtual);
            }
            if (msg.params) {
                msg.params = rewriteUris(msg.params, realToVirtual);
            }
            return JSON.stringify(msg);
        } catch {
            return raw;
        }
    }

    // WebSocket → stdin: intercept, rewrite URIs, wrap with Content-Length header
    ws.on("message", (data: Buffer | string) => {
        if (serverProcess.stdin && !serverProcess.stdin.destroyed) {
            const message = processClientMessage(data.toString());
            const byteLength = Buffer.byteLength(message, "utf-8");
            serverProcess.stdin.write(`Content-Length: ${byteLength}\r\n\r\n${message}`);
        }
    });

    // stdout → WebSocket: parse LSP frames, rewrite URIs, send JSON bodies
    let stdoutBuffer = "";

    if (serverProcess.stdout) {
        serverProcess.stdout.on("data", (chunk: Buffer) => {
            stdoutBuffer += chunk.toString();

            while (true) {
                const headerEnd = stdoutBuffer.indexOf("\r\n\r\n");
                if (headerEnd === -1) break;

                const headerPart = stdoutBuffer.substring(0, headerEnd);
                const match = headerPart.match(/Content-Length:\s*(\d+)/i);
                if (!match) {
                    stdoutBuffer = stdoutBuffer.substring(headerEnd + 4);
                    continue;
                }

                const contentLength = parseInt(match[1], 10);
                const bodyStart = headerEnd + 4;

                if (stdoutBuffer.length < bodyStart + contentLength) break;

                const body = stdoutBuffer.substring(bodyStart, bodyStart + contentLength);
                stdoutBuffer = stdoutBuffer.substring(bodyStart + contentLength);

                if (ws.readyState === ws.OPEN) {
                    ws.send(processServerMessage(body));
                }
            }
        });
    }

    // Log stderr for debugging
    if (serverProcess.stderr) {
        serverProcess.stderr.on("data", (data: Buffer) => {
            console.error(`[LSP:${config.name}:stderr]`, data.toString().trim());
        });
    }

    // Clean up on WebSocket close
    ws.on("close", () => {
        console.log(`[LSP] Client disconnected, killing ${config.name} (PID: ${serverProcess.pid})`);
        serverProcess.kill();
        fs.rm(workDir, { recursive: true, force: true }, () => {});
    });

    ws.on("error", (err) => {
        console.error(`[LSP:${config.name}:ws-error]`, err.message);
        serverProcess.kill();
    });

    // Clean up on server process exit
    serverProcess.on("exit", (code, signal) => {
        console.log(`[LSP] ${config.name} exited (code: ${code}, signal: ${signal})`);
        fs.rm(workDir, { recursive: true, force: true }, () => {});
        if (ws.readyState === ws.OPEN) {
            ws.close(1000, `${config.name} server exited`);
        }
    });

    serverProcess.on("error", (err) => {
        console.error(`[LSP] ${config.name} process error:`, err.message);
        if (ws.readyState === ws.OPEN) {
            ws.close(1011, `${config.name} process error`);
        }
    });
}

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "9601", 10);

httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  Monaco LSP Hub running at http://localhost:${PORT}\n`);
    console.log("  Available language servers:");
    for (const [path, config] of Object.entries(LANGUAGE_SERVERS)) {
        console.log(`    ${config.name.padEnd(24)} ws://localhost:${PORT}${path}`);
    }
    const missingSystem = Object.entries(SYSTEM_SERVER_DEFS)
        .filter(([p]) => !SYSTEM_SERVERS[p])
        .map(([, def]) => `${def.name} (install '${def.bin}' to enable)`);
    if (missingSystem.length > 0) {
        console.log("\n  Not found on PATH (optional):");
        for (const msg of missingSystem) {
            console.log(`    - ${msg}`);
        }
    }
    console.log();
});
