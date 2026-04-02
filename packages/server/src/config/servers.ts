// Server definitions: NPM-installed, system-detected, and alias mappings

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "../..");

// ── Types ────────────────────────────────────────────────────────────────────

export interface ServerConfig {
    name: string;
    command: string;
    args: string[];
}

interface SystemServerDef {
    name: string;
    bin: string;
    args: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveNpmBin(_pkg: string, bin: string): string {
    // Primary: local node_modules (non-hoisted / production standalone install)
    const local = path.resolve(PKG_ROOT, "node_modules", ".bin", bin);
    if (fs.existsSync(local)) return local;
    // Fallback: workspace-hoisted root node_modules
    const hoisted = path.resolve(PKG_ROOT, "..", "..", "node_modules", ".bin", bin);
    if (fs.existsSync(hoisted)) return hoisted;
    return local; // return primary path even if missing (error will surface at spawn)
}

function findSystemBin(bin: string): string | null {
    try {
        const cmd = process.platform === "win32" ? "where" : "which";
        const result = execSync(`${cmd} ${bin}`, {
            encoding: "utf-8",
            timeout: 5000,
        }).trim();
        return result.split(/\r?\n/)[0] || null;
    } catch {
        return null;
    }
}

// ── NPM-installed language servers ───────────────────────────────────────────

const NPM_SERVERS: Record<string, ServerConfig> = {
    // vscode-langservers-extracted
    "/lsp/json": {
        name: "JSON",
        command: resolveNpmBin("vscode-langservers-extracted", "vscode-json-language-server"),
        args: ["--stdio"],
    },
    "/lsp/html": {
        name: "HTML",
        command: resolveNpmBin("vscode-langservers-extracted", "vscode-html-language-server"),
        args: ["--stdio"],
    },
    "/lsp/css": {
        name: "CSS",
        command: resolveNpmBin("vscode-langservers-extracted", "vscode-css-language-server"),
        args: ["--stdio"],
    },
    "/lsp/markdown": {
        name: "Markdown",
        command: resolveNpmBin("vscode-langservers-extracted", "vscode-markdown-language-server"),
        args: ["--stdio"],
    },
    "/lsp/eslint": {
        name: "ESLint",
        command: resolveNpmBin("vscode-langservers-extracted", "vscode-eslint-language-server"),
        args: ["--stdio"],
    },

    // Standalone npm servers
    "/lsp/yaml": {
        name: "YAML",
        command: resolveNpmBin("yaml-language-server", "yaml-language-server"),
        args: ["--stdio"],
    },
    "/lsp/typescript": {
        name: "TypeScript",
        command: resolveNpmBin("typescript-language-server", "typescript-language-server"),
        args: ["--stdio"],
    },
    "/lsp/python": {
        name: "Python (Pyright)",
        command: resolveNpmBin("pyright", "pyright-langserver"),
        args: ["--stdio"],
    },
    "/lsp/shellscript": {
        name: "Bash",
        command: resolveNpmBin("bash-language-server", "bash-language-server"),
        args: ["start"],
    },
    "/lsp/dockerfile": {
        name: "Dockerfile",
        command: resolveNpmBin("dockerfile-language-server-nodejs", "docker-langserver"),
        args: ["--stdio"],
    },
    "/lsp/svelte": {
        name: "Svelte",
        command: resolveNpmBin("svelte-language-server", "svelteserver"),
        args: ["--stdio"],
    },
    "/lsp/graphql": {
        name: "GraphQL",
        command: resolveNpmBin("graphql-language-service-cli", "graphql-lsp"),
        args: ["server", "-m", "stream"],
    },
    "/lsp/sql": {
        name: "SQL",
        command: resolveNpmBin("sql-language-server", "sql-language-server"),
        args: ["up", "--method", "stdio"],
    },
    "/lsp/ansible": {
        name: "Ansible",
        command: resolveNpmBin("@ansible/ansible-language-server", "ansible-language-server"),
        args: ["--stdio"],
    },
    "/lsp/vue": {
        name: "Vue",
        command: resolveNpmBin("@vue/language-server", "vue-language-server"),
        args: ["--stdio"],
    },
    "/lsp/astro": {
        name: "Astro",
        command: resolveNpmBin("@astrojs/language-server", "astro-ls"),
        args: ["--stdio"],
    },
    "/lsp/elm": {
        name: "Elm",
        command: resolveNpmBin("@elm-tooling/elm-language-server", "elm-language-server"),
        args: ["--stdio"],
    },
    "/lsp/diagnostic": {
        name: "Diagnostic (meta-linter)",
        command: resolveNpmBin("diagnostic-languageserver", "diagnostic-languageserver"),
        args: ["--stdio"],
    },
    "/lsp/tailwindcss": {
        name: "Tailwind CSS",
        command: resolveNpmBin("@tailwindcss/language-server", "tailwindcss-language-server"),
        args: ["--stdio"],
    },
    "/lsp/vim": {
        name: "VimScript",
        command: resolveNpmBin("vim-language-server", "vim-language-server"),
        args: ["--stdio"],
    },
    "/lsp/biome": {
        name: "Biome (JS/TS/CSS/GraphQL)",
        command: resolveNpmBin("@biomejs/biome", "biome"),
        args: ["lsp-proxy"],
    },
};

// ── System-installed language servers (auto-detected from PATH) ──────────────

const SYSTEM_SERVER_DEFS: Record<string, SystemServerDef> = {
    // Compiled-language servers
    "/lsp/rust": { name: "Rust (rust-analyzer)", bin: "rust-analyzer", args: [] },
    "/lsp/go": { name: "Go (gopls)", bin: "gopls", args: ["serve"] },
    "/lsp/c": { name: "C/C++ (clangd)", bin: "clangd", args: [] },
    "/lsp/lua": { name: "Lua", bin: "lua-language-server", args: [] },
    "/lsp/zig": { name: "Zig (zls)", bin: "zls", args: [] },

    // JVM-based servers
    "/lsp/java": { name: "Java (Eclipse JDT LS)", bin: "jdtls", args: [] },
    "/lsp/kotlin": { name: "Kotlin", bin: "kotlin-language-server", args: [] },
    "/lsp/scala": { name: "Scala (Metals)", bin: "metals", args: [] },

    // Data/config format servers
    "/lsp/toml": { name: "TOML (Taplo)", bin: "taplo", args: ["lsp", "stdio"] },
    "/lsp/xml": { name: "XML (LemMinX)", bin: "lemminx", args: [] },

    // Infrastructure/DevOps
    "/lsp/terraform": { name: "Terraform", bin: "terraform-ls", args: ["serve"] },
    "/lsp/nix": { name: "Nix (nil)", bin: "nil", args: [] },

    // Functional languages
    "/lsp/clojure": { name: "Clojure", bin: "clojure-lsp", args: [] },

    // Documentation/markup
    "/lsp/latex": { name: "LaTeX (texlab)", bin: "texlab", args: [] },

    // Dart
    "/lsp/dart": { name: "Dart", bin: "dart", args: ["language-server", "--protocol=lsp"] },

    // Python-based servers (pip)
    "/lsp/pylsp": { name: "Python (pylsp)", bin: "pylsp", args: [] },
    "/lsp/cmake": { name: "CMake", bin: "cmake-language-server", args: [] },
    "/lsp/restructuredtext": { name: "reStructuredText (esbonio)", bin: "esbonio", args: [] },
    "/lsp/nginx": { name: "Nginx", bin: "nginx-language-server", args: [] },

    // Ruby / PHP
    "/lsp/ruby": { name: "Ruby (Solargraph)", bin: "solargraph", args: ["stdio"] },
    "/lsp/php": { name: "PHP (phpactor)", bin: "phpactor", args: ["language-server"] },

    // Helm (Kubernetes)
    "/lsp/helm": { name: "Helm", bin: "helm_ls", args: ["serve"] },

    // Grammar checker
    "/lsp/harper": { name: "Harper (grammar)", bin: "harper-ls", args: ["--stdio"] },
};

// ── Path aliases: multiple language IDs → same server ────────────────────────

const PATH_ALIASES: Record<string, string> = {
    // JS/TS variants
    "/lsp/javascript": "/lsp/typescript",
    "/lsp/typescriptreact": "/lsp/typescript",
    "/lsp/javascriptreact": "/lsp/typescript",

    // C++ / Objective-C
    "/lsp/cpp": "/lsp/c",
    "/lsp/objective-c": "/lsp/c",

    // CSS variants
    "/lsp/scss": "/lsp/css",
    "/lsp/less": "/lsp/css",

    // JSON variants
    "/lsp/jsonc": "/lsp/json",

    // YAML variants
    "/lsp/yml": "/lsp/yaml",

    // Shell variants
    "/lsp/bash": "/lsp/shellscript",
    "/lsp/sh": "/lsp/shellscript",
    "/lsp/zsh": "/lsp/shellscript",
    "/lsp/shell": "/lsp/shellscript",

    // Terraform/HCL
    "/lsp/hcl": "/lsp/terraform",

    // Docker Compose
    "/lsp/dockercompose": "/lsp/dockerfile",

    // SQL variants
    "/lsp/mysql": "/lsp/sql",
    "/lsp/pgsql": "/lsp/sql",
};

// ── Detection and resolution ─────────────────────────────────────────────────

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

export const LANGUAGE_SERVERS: Record<string, ServerConfig> = {
    ...NPM_SERVERS,
    ...SYSTEM_SERVERS,
};

export function resolveServer(pathname: string): ServerConfig | undefined {
    if (LANGUAGE_SERVERS[pathname]) return LANGUAGE_SERVERS[pathname];
    const target = PATH_ALIASES[pathname];
    if (target && LANGUAGE_SERVERS[target]) return LANGUAGE_SERVERS[target];
    return undefined;
}

export function getAvailableLanguages(): string[] {
    const direct = Object.keys(LANGUAGE_SERVERS).map((p) => p.replace("/lsp/", ""));
    const aliased = Object.keys(PATH_ALIASES)
        .filter((p) => LANGUAGE_SERVERS[PATH_ALIASES[p]])
        .map((p) => p.replace("/lsp/", ""));
    return [...direct, ...aliased];
}

export function getLanguageDetails(): Array<{
    language: string;
    name: string;
    wsPath: string;
    aliases: string[];
}> {
    return Object.entries(LANGUAGE_SERVERS).map(([wsPath, config]) => {
        const language = wsPath.replace("/lsp/", "");
        const aliases = Object.entries(PATH_ALIASES)
            .filter(([, target]) => target === wsPath)
            .map(([alias]) => alias.replace("/lsp/", ""));
        return { language, name: config.name, wsPath, aliases };
    });
}

export function getMissingSystemServers(): string[] {
    return Object.entries(SYSTEM_SERVER_DEFS)
        .filter(([p]) => !SYSTEM_SERVERS[p])
        .map(([, def]) => `${def.name} (install '${def.bin}' to enable)`);
}
