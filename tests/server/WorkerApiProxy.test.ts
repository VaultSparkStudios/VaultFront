import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkerApiProxy,
  resolveWorkerApiGameId,
} from "../../src/server/WorkerApiProxy";

const servers: http.Server[] = [];

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return (server.address() as { port: number }).port;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("worker API routing", () => {
  it("extracts game identity from path, body, and query contracts", () => {
    expect(
      resolveWorkerApiGameId({
        path: "/api/rematch/status/game-A",
        body: {},
        query: {},
      } as never),
    ).toBe("game-A");
    expect(
      resolveWorkerApiGameId({
        path: "/api/vaultfront/coach-debrief",
        body: { gameId: "game-B" },
        query: {},
      } as never),
    ).toBe("game-B");
    expect(
      resolveWorkerApiGameId({
        path: "/api/vaultfront/match-oracle",
        body: {},
        query: { gameId: "game-C" },
      } as never),
    ).toBe("game-C");
    expect(
      resolveWorkerApiGameId({
        path: "/api/clans/leaderboard",
        body: {},
        query: {},
      } as never),
    ).toBeNull();
  });

  it("proxies global and game-bound JSON without turning misses into SPA HTML", async () => {
    const workerPorts = await Promise.all(
      [0, 1].map(async (shard) => {
        const worker = http.createServer((req, res) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          req.on("end", () => {
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                shard,
                path: req.url,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          });
        });
        return listen(worker);
      }),
    );
    const app = express();
    app.use(express.json());
    app.use(
      createWorkerApiProxy({
        workerIndex: (gameId) => (gameId === "game-B" ? 1 : 0),
        workerPortByIndex: (index) => workerPorts[index],
      }),
    );
    app.get("*", (_req, res) => res.type("html").send("SPA"));
    const masterPort = await listen(http.createServer(app));

    const global = await fetch(
      `http://127.0.0.1:${masterPort}/api/clans/leaderboard`,
    );
    expect(global.headers.get("content-type")).toContain("application/json");
    expect(await global.json()).toMatchObject({
      shard: 0,
      path: "/api/clans/leaderboard",
    });

    const game = await fetch(
      `http://127.0.0.1:${masterPort}/api/vaultfront/coach-debrief`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId: "game-B" }),
      },
    );
    expect(game.headers.get("x-vaultfront-api-shard")).toBe("1");
    expect(await game.json()).toMatchObject({
      shard: 1,
      body: '{"gameId":"game-B"}',
    });
  });
});
