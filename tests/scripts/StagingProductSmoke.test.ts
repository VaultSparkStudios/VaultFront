import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runProductSmoke } from "../../scripts/staging-product-smoke.mjs";

let server: http.Server | null = null;

afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

describe("staging product smoke", () => {
  it("binds health, revision, JSON APIs, Obelisk, and agent surfaces into one receipt", async () => {
    server = http.createServer((req, res) => {
      const json = (status: number, value: unknown, headers = {}) => {
        res.writeHead(status, {
          "content-type": "application/json",
          ...headers,
        });
        res.end(JSON.stringify(value));
      };
      if (req.url === "/_health")
        return json(200, { status: "ok", scope: "master" });
      if (req.url === "/commit.txt") return res.end("abc123\n");
      if (req.url === "/api/vaultfront/playtest-pulse/summary")
        return json(200, { privacy: { smallCountThreshold: 5 } });
      if (req.url === "/api/clans/leaderboard")
        return json(200, [], { "x-vaultfront-api-shard": "0" });
      if (req.url === "/auth/me")
        return json(
          401,
          { error: "not_authenticated" },
          { "cache-control": "no-store" },
        );
      if (req.url === "/auth/login") {
        res.writeHead(302, {
          location:
            "https://obeliskgate.com/auth/authorize?client_id=vaultfront",
          "set-cookie": "vf=opaque; HttpOnly; Secure; SameSite=Lax",
        });
        return res.end();
      }
      if (req.url === "/stripe/create-checkout-session")
        return json(405, { error: "Method not allowed" });
      if (req.url === "/agents.json")
        return json(200, { name: "VaultFront", capabilities: ["play"] });
      if (req.url === "/.well-known/llms.txt")
        return res.end("VaultFront agent contract is public and bounded.");
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    const receipt = await runProductSmoke({
      origin: `http://127.0.0.1:${port}`,
      expectedRevision: "abc123",
    });
    expect(receipt.pass).toBe(true);
    expect(receipt.checks).toHaveLength(9);
    expect(receipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
