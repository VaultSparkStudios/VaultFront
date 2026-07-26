#!/usr/bin/env node
import http from "node:http";
import { fileURLToPath } from "node:url";

export const E2E_FIXTURE_HOST = "127.0.0.1";
export const E2E_FIXTURE_PORT = 39081;

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

export function createE2EFixtureServer() {
  return http.createServer((req, res) => {
    if (req.method !== "GET") {
      json(res, 405, { error: "method-not-allowed" });
      return;
    }
    if (req.url === "/_health") {
      json(res, 200, {
        status: "ok",
        evidence: "deterministic-local-e2e-fixture",
      });
      return;
    }
    if (req.url === "/api/env") {
      json(res, 200, { env: "dev", game_env: "dev" });
      return;
    }
    json(res, 404, { error: "fixture-route-not-found" });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createE2EFixtureServer();
  server.listen(E2E_FIXTURE_PORT, E2E_FIXTURE_HOST, () => {
    console.log(
      `E2E fixture listening on http://${E2E_FIXTURE_HOST}:${E2E_FIXTURE_PORT}`,
    );
  });
}
