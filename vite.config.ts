import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults } from "vitest/config";

// Vite already handles these, but its good practice to define them explicitly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function devHtmlTemplatePlugin(): Plugin {
  return {
    name: "vaultfront-dev-html-template",
    transformIndexHtml(html) {
      return html
        .replace("<%- gitCommit %>", JSON.stringify("DEV"))
        .replace("<%- instanceId %>", JSON.stringify("DEV_ID"));
    },
  };
}
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProduction = mode === "production";
  const devApiOrigin = env.DEV_API_ORIGIN?.trim() || "http://localhost:3000";
  const devLobbyOrigin = env.DEV_LOBBY_ORIGIN?.trim() || "ws://localhost:3000";
  const devWorkerOrigin =
    env.DEV_WORKER_ORIGIN?.trim() || "ws://localhost:3001";
  const basePath = (() => {
    const raw = (env.VITE_APP_BASE_PATH ?? "/").trim();
    if (!raw || raw === "/") return "/";
    const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
    return withLeadingSlash.endsWith("/")
      ? withLeadingSlash
      : `${withLeadingSlash}/`;
  })();
  // In dev, redirect visits to /w*/game/* to "/" so Vite serves the index.html.
  const devGameHtmlBypass = (req?: {
    url?: string;
    method?: string;
    headers?: { accept?: string | string[] };
  }) => {
    if (req?.method !== "GET") return undefined;
    const accept = req.headers?.accept;
    const acceptValue = Array.isArray(accept)
      ? accept.join(",")
      : (accept ?? "");
    if (!acceptValue.includes("text/html")) return undefined;
    if (!req.url) return undefined;
    if (/^\/w\d+\/game\/[^/]+/.test(req.url)) {
      return "/";
    }
    return undefined;
  };

  return {
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./tests/setup.ts",
      exclude: [...configDefaults.exclude, "**/.codex-temp-*/**", "e2e/**"],
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "json-summary"],
        include: [
          "src/client/**/*.ts",
          "src/core/**/*.ts",
          "src/server/**/*.ts",
        ],
        exclude: ["src/**/*.d.ts"],
        thresholds: {
          // The checked-in ratchet owns measurable no-regression policy. Keep
          // Vitest's disconnected global threshold neutral so the JSON report
          // is always emitted and can be evaluated with critical-module floors.
          lines: 0,
          functions: 0,
          branches: 0,
          statements: 0,
        },
      },
    },
    root: "./",
    base: basePath,
    publicDir: "resources", // Access static assets via import or explicit copy

    resolve: {
      alias: [
        {
          find: /^\/images\//,
          replacement: `${path.resolve(__dirname, "resources/images")}/`,
        },
        {
          find: /^\/sounds\//,
          replacement: `${path.resolve(__dirname, "resources/sounds")}/`,
        },
        {
          find: "protobufjs/minimal",
          replacement: path.resolve(
            __dirname,
            "node_modules/protobufjs/minimal.js",
          ),
        },
        {
          find: "resources",
          replacement: path.resolve(__dirname, "resources"),
        },
      ],
    },

    plugins: [
      tsconfigPaths(),
      ...(isProduction ? [] : [devHtmlTemplatePlugin()]),
      viteStaticCopy({
        targets: [
          {
            src: "proprietary/*",
            dest: ".",
          },
          {
            // Standard public-launch surface overlays the legacy resources
            // publicDir without moving thousands of inherited game assets.
            src: "public/*",
            dest: ".",
          },
          ...["about", "contact", "docs", "ip", "privacy", "terms"].map(
            (route) => ({
              src: `public/${route}/*`,
              dest: route,
            }),
          ),
          {
            src: "public/.well-known/*",
            dest: ".well-known",
          },
        ],
      }),
      tailwindcss(),
    ],

    define: {
      "process.env.WEBSOCKET_URL": JSON.stringify(
        isProduction ? "" : "localhost:3000",
      ),
      "process.env.GAME_ENV": JSON.stringify(isProduction ? "prod" : "dev"),
      "process.env.DOMAIN": JSON.stringify(env.VITE_DOMAIN ?? env.DOMAIN ?? ""),
      "process.env.GAME_SERVICE_ORIGIN": JSON.stringify(
        env.VITE_GAME_SERVICE_ORIGIN ?? env.GAME_SERVICE_ORIGIN ?? "",
      ),
      "process.env.STRIPE_PUBLISHABLE_KEY": JSON.stringify(
        env.STRIPE_PUBLISHABLE_KEY,
      ),
      "process.env.API_DOMAIN": JSON.stringify(env.API_DOMAIN),
      // Add other process.env variables if needed, OR migrate code to import.meta.env
    },

    build: {
      // Vite warns on raw minified bytes; the stricter bundle gate enforces
      // per-file gzip plus aggregate gzip/Brotli and media transfer budgets.
      chunkSizeWarningLimit: 1800,
      outDir: "static", // Webpack outputs to 'static', assuming we want to keep this.
      emptyOutDir: true,
      assetsDir: "assets", // Sub-directory for assets
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/gu, "/");
            if (normalized.includes("/node_modules/pixi.js/")) {
              return "render-vendor";
            }

            if (normalized.includes("/src/core/")) {
              return "game-core";
            }

            return undefined;
          },
        },
      },
    },

    server: {
      port: 9000,
      // Automatically open the browser when the server starts
      open: process.env.SKIP_BROWSER_OPEN !== "true",
      proxy: {
        "/lobbies": {
          target: devLobbyOrigin,
          ws: true,
          changeOrigin: true,
        },
        // Worker proxies
        "/w0": {
          target: devWorkerOrigin,
          ws: true,
          secure: false,
          changeOrigin: true,
          bypass: (req) => devGameHtmlBypass(req),
          rewrite: (path) => path.replace(/^\/w0/, ""),
        },
        "/w1": {
          target: devWorkerOrigin,
          ws: true,
          secure: false,
          changeOrigin: true,
          bypass: (req) => devGameHtmlBypass(req),
          rewrite: (path) => path.replace(/^\/w1/, ""),
        },
        // API and canonical health proxies
        "/_health": {
          target: devApiOrigin,
          changeOrigin: true,
          secure: false,
        },
        "/api": {
          target: devApiOrigin,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
