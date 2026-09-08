// File explorer sidebar — shows workspace files and diagnostics panel

import type * as Monaco from "monaco-editor";

export interface FileEntry {
    name: string;
    uri: string;
    languageId: string;
}

export type DiagnosticSeverity = 1 | 2 | 3 | 4; // Error, Warning, Info, Hint

export interface DiagnosticEntry {
    uri: string;
    fileName: string;
    severity: DiagnosticSeverity;
    message: string;
    line: number;
    character: number;
}

type FileClickHandler = (file: FileEntry) => void;
type DiagnosticClickHandler = (diag: DiagnosticEntry) => void;

let fileList: HTMLElement;
let diagnosticsList: HTMLElement;
let diagnosticBadge: HTMLElement;

const files = new Map<string, FileEntry>();
const diagnostics: DiagnosticEntry[] = [];
let onFileClick: FileClickHandler = () => {};
let onDiagnosticClick: DiagnosticClickHandler = () => {};
let activeUri = "";

export function initExplorer(
    handlers: {
        onFileClick: FileClickHandler;
        onDiagnosticClick: DiagnosticClickHandler;
    },
): void {
    onFileClick = handlers.onFileClick;
    onDiagnosticClick = handlers.onDiagnosticClick;
    fileList = document.getElementById("file-list")!;
    diagnosticsList = document.getElementById("diagnostics-list")!;
    diagnosticBadge = document.getElementById("diagnostic-badge")!;

    // Tab switching
    document.querySelectorAll(".sidebar-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            const target = (tab as HTMLElement).dataset.panel!;
            document.querySelectorAll(".sidebar-tab").forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            document.querySelectorAll(".sidebar-panel").forEach((p) => p.classList.remove("active"));
            document.getElementById(`panel-${target}`)!.classList.add("active");
        });
    });
}

export function setActiveFile(uri: string): void {
    activeUri = uri;
    renderFiles();
}

export function addFile(entry: FileEntry): void {
    files.set(entry.uri, entry);
    renderFiles();
}

export function removeFile(uri: string): void {
    files.delete(uri);
    renderFiles();
}

/** Drop every listed file — used when switching language. */
export function clearFiles(): void {
    files.clear();
    activeUri = "";
    renderFiles();
}

export function updateDiagnostics(uri: string, fileName: string, markers: Monaco.editor.IMarkerData[]): void {
    // Remove old diagnostics for this URI
    const filtered = diagnostics.filter((d) => d.uri !== uri);
    diagnostics.length = 0;
    diagnostics.push(...filtered);

    // Add new diagnostics
    for (const m of markers) {
        diagnostics.push({
            uri,
            fileName,
            severity: m.severity as DiagnosticSeverity,
            message: m.message,
            line: m.startLineNumber,
            character: m.startColumn,
        });
    }

    renderDiagnostics();
}

const SEVERITY_ICON: Record<number, string> = {
    1: "●", // Error
    2: "▲", // Warning
    3: "ℹ", // Info
    4: "○", // Hint
};

const SEVERITY_CLASS: Record<number, string> = {
    1: "sev-error",
    2: "sev-warning",
    3: "sev-info",
    4: "sev-hint",
};

function renderFiles(): void {
    if (!fileList) return;
    fileList.innerHTML = "";
    for (const file of files.values()) {
        const el = document.createElement("div");
        el.className = `file-item${file.uri === activeUri ? " active" : ""}`;
        el.innerHTML = `<span class="file-icon">📄</span><span class="file-name">${escapeHtml(file.name)}</span>`;
        el.addEventListener("click", () => onFileClick(file));
        fileList.appendChild(el);
    }
}

function renderDiagnostics(): void {
    if (!diagnosticsList || !diagnosticBadge) return;

    const errorCount = diagnostics.filter((d) => d.severity <= 2).length;
    diagnosticBadge.textContent = errorCount > 0 ? String(errorCount) : "";
    diagnosticBadge.classList.toggle("hidden", errorCount === 0);

    diagnosticsList.innerHTML = "";

    if (diagnostics.length === 0) {
        diagnosticsList.innerHTML = `<div class="empty-state">No problems detected</div>`;
        return;
    }

    // Group by file
    const grouped = new Map<string, DiagnosticEntry[]>();
    for (const d of diagnostics) {
        const arr = grouped.get(d.uri) ?? [];
        arr.push(d);
        grouped.set(d.uri, arr);
    }

    for (const [, entries] of grouped) {
        const fileHeader = document.createElement("div");
        fileHeader.className = "diag-file-header";
        fileHeader.textContent = entries[0].fileName;
        diagnosticsList.appendChild(fileHeader);

        for (const d of entries) {
            const el = document.createElement("div");
            el.className = `diag-item ${SEVERITY_CLASS[d.severity] ?? "sev-info"}`;
            el.innerHTML = `
                <span class="diag-icon">${SEVERITY_ICON[d.severity] ?? "ℹ"}</span>
                <span class="diag-message">${escapeHtml(d.message)}</span>
                <span class="diag-location">[Ln ${d.line}, Col ${d.character}]</span>
            `;
            el.addEventListener("click", () => onDiagnosticClick(d));
            diagnosticsList.appendChild(el);
        }
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
