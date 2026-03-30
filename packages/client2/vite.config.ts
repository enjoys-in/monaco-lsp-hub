import { defineConfig } from "vite";

export default defineConfig({
    build: {
        target: "esnext",
    },
    server: {
        port: 9602,
        proxy: {
            "/lsp": {
                target: "ws://localhost:9601",
                ws: true,
            },
        },
    },
});
