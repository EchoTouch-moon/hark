import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function getAppDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Application Support/dev.hark.r1.native-shell");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "dev.hark.r1.native-shell");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "dev.hark.r1.native-shell");
}

function searchConfigPlugin(): Plugin {
  return {
    name: "hark-search-config-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/search-config")) {
          return next();
        }

        const harkDir = path.join(getAppDataDir(), "hark-r1");
        const configPath = path.join(harkDir, "search-config.json");

        if (req.method === "GET") {
          let data: Record<string, any> = { activeProvider: "tavily", providers: {} };
          if (fs.existsSync(configPath)) {
            try {
              data = JSON.parse(fs.readFileSync(configPath, "utf8"));
            } catch {
              // ignore
            }
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data));
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const payload = JSON.parse(body || "{}");
              if (!fs.existsSync(harkDir)) {
                fs.mkdirSync(harkDir, { recursive: true });
              }
              let current: Record<string, any> = { activeProvider: "tavily", providers: {} };
              if (fs.existsSync(configPath)) {
                try {
                  current = JSON.parse(fs.readFileSync(configPath, "utf8"));
                } catch {}
              }
              if (payload.activeProvider) {
                current.activeProvider = payload.activeProvider;
              }
              if (payload.provider && payload.apiKey) {
                if (!current.providers) current.providers = {};
                current.providers[payload.provider] = { apiKey: payload.apiKey.trim() };
              }
              fs.writeFileSync(configPath, JSON.stringify(current, null, 2), "utf8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, config: current }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        if (req.method === "DELETE") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const payload = JSON.parse(body || "{}");
              if (fs.existsSync(configPath)) {
                const current = JSON.parse(fs.readFileSync(configPath, "utf8"));
                if (payload.provider && current.providers?.[payload.provider]) {
                  delete current.providers[payload.provider];
                  fs.writeFileSync(configPath, JSON.stringify(current, null, 2), "utf8");
                }
              }
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  // Tauri loads the built assets from a custom protocol, not a site root.
  base: "./",
  plugins: [react(), tailwindcss(), searchConfigPlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
