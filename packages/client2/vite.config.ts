import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
    build: {
        target: "esnext",
    },
    server: {
        port: 9602,
        // The language configs are imported from the client package, which is
        // outside this project root, so the dev server has to be allowed to
        // serve from the workspace root.
        fs: {
            allow: [path.resolve(__dirname, "..")],
        },
        proxy: {
            "/lsp": {
                target: "ws://localhost:9601",
                ws: true,
            },
            "/api": {
                target: "http://localhost:9601",
            },
        },
    },
});
