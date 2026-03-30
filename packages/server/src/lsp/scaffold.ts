// Project scaffolding — creates minimal project files in the temp workspace
// so that language servers requiring project structure can function properly.
// e.g. rust-analyzer needs Cargo.toml, gopls needs go.mod, etc.

import fs from "fs";
import path from "path";

/** Info about what was scaffolded, for notification purposes */
export interface ScaffoldResult {
    created: string[]; // filenames created
    language: string;
}

/** Map of file extension → scaffolding files to create in the workspace root */
const SCAFFOLDS: Record<string, { files: Record<string, string>; language: string }> = {
    rs: {
        language: "Rust",
        files: {
            "Cargo.toml": `[package]
name = "playground"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "main"
path = "main.rs"
`,
        },
    },

    go: {
        language: "Go",
        files: {
            "go.mod": `module playground

go 1.21
`,
        },
    },

    ts: {
        language: "TypeScript",
        files: {
            "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["."]
}
`,
        },
    },

    js: {
        language: "JavaScript",
        files: {
            "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "allowJs": true,
    "checkJs": true,
    "strict": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["."]
}
`,
        },
    },

    py: {
        language: "Python",
        files: {
            "pyrightconfig.json": `{
  "pythonVersion": "3.12",
  "typeCheckingMode": "basic",
  "include": ["."]
}
`,
        },
    },

    java: {
        language: "Java",
        files: {
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
        },
    },
};

const scaffoldedDirs = new Set<string>();

/**
 * Create scaffolding files in the workspace directory if not already done.
 * Returns info about what was created, or null if nothing was needed.
 */
export function scaffoldWorkspace(workspaceDir: string, fileUri: string): ScaffoldResult | null {
    const ext = fileUri.split(".").pop()?.toLowerCase();
    if (!ext) return null;

    const key = `${workspaceDir}:${ext}`;
    if (scaffoldedDirs.has(key)) return null;
    scaffoldedDirs.add(key);

    const scaffold = SCAFFOLDS[ext];
    if (!scaffold) return null;

    const created: string[] = [];
    for (const [filename, content] of Object.entries(scaffold.files)) {
        const filePath = path.join(workspaceDir, filename);
        if (fs.existsSync(filePath)) continue;
        try {
            fs.writeFileSync(filePath, content, "utf-8");
            created.push(filename);
        } catch {
            // ignore — non-critical
        }
    }

    if (created.length === 0) return null;
    return { created, language: scaffold.language };
}
