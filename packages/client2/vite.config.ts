import { defineConfig } from "vite";

export default defineConfig({
    build: {
        target: "esnext",
    },
    server: {
        proxy: {
            "/lsp": {
                target: "ws://localhost:9601",
                ws: true,
            },
        },
    },
});
