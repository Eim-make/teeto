import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;
const dataDir = resolve(import.meta.dirname, "pipeline/out");

function localData(): Plugin {
  return {
    name: "teeto-local-data",
    configureServer(server) {
      server.middlewares.use("/data/", (req, res, next) => {
        const file = resolve(
          dataDir,
          decodeURIComponent(
            (req.url ?? "").replace(/^\//, "").split("?")[0] ?? "",
          ),
        );
        if (!file.startsWith(dataDir) || !file.endsWith(".json")) return next();
        readFile(file)
          .then((body) => {
            res.setHeader("Content-Type", "application/json");
            res.end(body);
          })
          .catch(() => {
            res.statusCode = 404;
            res.end();
          });
      });
    },
  };
}

export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), localData()],
  clearScreen: false,
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, "index.html"), overlay: resolve(import.meta.dirname, "overlay.html"), widgets: resolve(import.meta.dirname, "widgets.html") },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/server/**", "**/pipeline/**"] },
  },
}));
