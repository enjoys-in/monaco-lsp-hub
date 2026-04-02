// Self-ping to prevent Render cold starts.
// Sends a request to the health endpoint at a fixed interval,
// spoofing the Origin header so it looks like a real browser request.

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

let timer: ReturnType<typeof setInterval> | null = null;

export function startKeepAlive(url: string) {
    if (timer) return;

    const ping = async () => {
        try {
            const res = await fetch(`${url}/api/health`, {
                headers: {
                    Origin: url,
                    "User-Agent": "KeepAlive/1.0",
                },
            });
            console.log(`[keep-alive] pinged ${url}/api/health → ${res.status}`);
        } catch (err) {
            console.warn(`[keep-alive] ping failed:`, (err as Error).message);
        }
    };

    // First ping after a short delay, then every INTERVAL_MS
    setTimeout(ping, 5000);
    timer = setInterval(ping, INTERVAL_MS);
    console.log(`[keep-alive] scheduled every ${INTERVAL_MS / 1000}s → ${url}`);
}

export function stopKeepAlive() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
