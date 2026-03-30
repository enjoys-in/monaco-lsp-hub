// Toast notification system — VS Code-style toast messages

export type ToastType = "info" | "warning" | "error";

interface ToastOptions {
    message: string;
    type?: ToastType;
    duration?: number; // ms, 0 = sticky
    actions?: { label: string; callback: () => void }[];
}

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
    if (container) return container;
    container = document.getElementById("toast-container");
    if (container) return container;
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
    return container;
}

const ICONS: Record<ToastType, string> = {
    info: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a1 1 0 110 2 1 1 0 010-2zm2 8H6v-1h1.5V7.5H6v-1h2.5V11H10v1z"/></svg>`,
    warning: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7.56 1.44a.5.5 0 01.88 0l6.5 12A.5.5 0 0114.5 14h-13a.5.5 0 01-.44-.56l6.5-12zM8 5a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 008 5zm0 7a1 1 0 100-2 1 1 0 000 2z"/></svg>`,
    error: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.35 9.65a.5.5 0 01-.7.7L8 8.71l-2.65 2.64a.5.5 0 01-.7-.7L7.29 8 4.65 5.35a.5.5 0 01.7-.7L8 7.29l2.65-2.64a.5.5 0 01.7.7L8.71 8l2.64 2.65z"/></svg>`,
};

export function showToast(opts: ToastOptions): void {
    const el = ensureContainer();
    const type = opts.type ?? "info";
    const duration = opts.duration ?? (type === "error" ? 8000 : 5000);

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${ICONS[type]}</span>
        <span class="toast-message">${escapeHtml(opts.message)}</span>
        <button class="toast-close" aria-label="Close">&times;</button>
    `;

    // Action buttons
    if (opts.actions?.length) {
        const actionsDiv = document.createElement("div");
        actionsDiv.className = "toast-actions";
        for (const action of opts.actions) {
            const btn = document.createElement("button");
            btn.className = "toast-action";
            btn.textContent = action.label;
            btn.onclick = () => {
                action.callback();
                dismiss();
            };
            actionsDiv.appendChild(btn);
        }
        toast.appendChild(actionsDiv);
    }

    // Close button
    toast.querySelector(".toast-close")!.addEventListener("click", dismiss);

    el.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => toast.classList.add("toast-visible"));

    // Auto-dismiss
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (duration > 0) {
        timer = setTimeout(dismiss, duration);
    }

    function dismiss() {
        if (timer) clearTimeout(timer);
        toast.classList.remove("toast-visible");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
        // Fallback if no transition
        setTimeout(() => toast.remove(), 300);
    }
}

/** Map LSP MessageType to toast type */
export function lspMessageTypeToToast(type: number): ToastType {
    switch (type) {
        case 1: return "error";
        case 2: return "warning";
        case 3: return "info";
        default: return "info";
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
