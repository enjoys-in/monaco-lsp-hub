// Project scaffolding — creates minimal project files in the temp workspace
// so that language servers requiring project structure can function properly.
// e.g. rust-analyzer needs Cargo.toml, gopls needs go.mod, etc.
//
// Scaffolds are a function of the *real* file being edited, not of a fixed
// `main.<ext>`. A hub fed a single file over SFTP sees whatever the file is
// actually called, and a Cargo.toml whose `[[bin]] path` points at a file that
// does not exist takes rust-analyzer down for the whole session.

import fs from "fs";
import path from "path";

/** Info about what was scaffolded, for notification purposes */
export interface ScaffoldResult {
    created: string[]; // filenames created
    language: string;
}

interface Scaffold {
    language: string;
    /** `relPath` is the workspace-relative path of the document being edited */
    files: (relPath: string) => Record<string, string>;
}

/** Map of file extension → scaffolding files to create in the workspace root */
const SCAFFOLDS: Record<string, Scaffold> = {
    rs: {
        language: "Rust",
        files: (relPath) => ({
            "Cargo.toml": `[package]
name = "playground"
version = "0.1.0"
edition = "2021"
autobins = false

[[bin]]
name = "main"
path = ${JSON.stringify(relPath)}
`,
        }),
    },

    go: {
        language: "Go",
        files: () => ({
            "go.mod": `module playground

go 1.21
`,
        }),
    },

    ts: {
        language: "TypeScript",
        files: () => ({ "tsconfig.json": tsconfig({ allowJs: false, strict: true }) }),
    },

    tsx: {
        language: "TypeScript (React)",
        files: () => ({ "tsconfig.json": tsconfig({ allowJs: false, strict: true, jsx: true }) }),
    },

    js: {
        language: "JavaScript",
        files: () => ({ "tsconfig.json": tsconfig({ allowJs: true, strict: false }) }),
    },

    jsx: {
        language: "JavaScript (React)",
        files: () => ({ "tsconfig.json": tsconfig({ allowJs: true, strict: false, jsx: true }) }),
    },

    py: {
        language: "Python",
        files: () => ({
            "pyrightconfig.json": `{
  "pythonVersion": "3.12",
  "typeCheckingMode": "basic",
  "include": ["."]
}
`,
        }),
    },

    java: {
        language: "Java",
        files: () => ({
            ".project": `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
  <name>playground</name>
  <buildSpec>
    <buildCommand><name>org.eclipse.jdt.core.javabuilder</name></buildCommand>
  </buildSpec>
  <natures>
    <nature>org.eclipse.jdt.core.javanature</nature>
  </natures>
</projectDescription>
`,
        }),
    },
};

function tsconfig(opts: { allowJs: boolean; strict: boolean; jsx?: boolean }): string {
    const compilerOptions: Record<string, unknown> = {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "bundler",
        allowJs: opts.allowJs,
        checkJs: opts.allowJs,
        strict: opts.strict,
        esModuleInterop: true,
        skipLibCheck: true,
        lib: ["ES2022", "DOM"],
    };
    if (opts.jsx) compilerOptions.jsx = "react-jsx";
    return JSON.stringify({ compilerOptions, include: ["."] }, null, 2) + "\n";
}

function extensionOf(relPath: string): string | undefined {
    const base = relPath.split("/").pop() ?? relPath;
    if (!base.includes(".")) return undefined;
    return base.split(".").pop()?.toLowerCase();
}

/** Whether this hub has a scaffold for the document at `relPath` */
export function canScaffold(relPath: string): boolean {
    const ext = extensionOf(relPath);
    return ext !== undefined && ext in SCAFFOLDS;
}

/**
 * Create scaffolding files for the document at `relPath`.
 *
 * `overwrite` distinguishes the two callers: the launcher scaffolds a
 * placeholder before spawning (rust-analyzer reads Cargo.toml at init and will
 * not start without one), and the first real `didOpen` scaffolds again with the
 * actual filename, replacing that placeholder.
 *
 * Returns info about what was written, or null if nothing was needed.
 */
export function scaffoldWorkspace(
    workspaceDir: string,
    relPath: string,
    { overwrite = false, skip }: { overwrite?: boolean; skip?: ReadonlySet<string> } = {},
): ScaffoldResult | null {
    const ext = extensionOf(relPath);
    if (!ext) return null;

    const scaffold = SCAFFOLDS[ext];
    if (!scaffold) return null;

    const created: string[] = [];
    for (const [filename, content] of Object.entries(scaffold.files(relPath))) {
        // A project file the client sent itself is authoritative — it knows its
        // own build setup, and the hub's generic stand-in is only there for
        // clients that send nothing but the source file.
        if (skip?.has(filename)) continue;
        const filePath = path.join(workspaceDir, filename);
        try {
            if (fs.existsSync(filePath)) {
                // Rewriting an identical file would churn the mtime and, for
                // Cargo.toml, trigger a needless rust-analyzer reload.
                if (!overwrite || fs.readFileSync(filePath, "utf-8") === content) continue;
            }
            fs.writeFileSync(filePath, content, "utf-8");
            created.push(filename);
        } catch {
            // ignore — non-critical
        }
    }

    if (created.length === 0) return null;
    return { created, language: scaffold.language };
}
