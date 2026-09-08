import { defineConfig } from "vite";

export default defineConfig({
    server: {
        port: 9600,
        proxy: {
            // Proxy all /lsp/* WebSocket connections to the backend
            "/lsp": {
                target: "ws://localhost:9601",
                ws: true,
            },
            // …and the HTTP API, so /api/languages works in dev too
            "/api": {
                target: "http://localhost:9601",
            },
        },
    },
    build: {
        outDir: "dist",
        target: "esnext",
    },
    worker: {
        format: "es",
    },
});
