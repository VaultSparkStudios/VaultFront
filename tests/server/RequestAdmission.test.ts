import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  installPreparseRequestAdmission,
  LARGE_JSON_BODY_LIMIT,
} from "../../src/server/RequestAdmission";

describe("pre-parse request admission", () => {
  const servers: Array<ReturnType<ReturnType<typeof express>["listen"]>> = [];
  afterEach(() =>
    Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
    ),
  );

  async function post(path: string, bytes: number): Promise<Response> {
    const app = express();
    installPreparseRequestAdmission(app, {
      coarseLimiter: (_req, _res, next) => next(),
    });
    app.post(path, (req, res) =>
      res.json({ bytes: JSON.stringify(req.body).length }),
    );
    const server = app.listen(0);
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(bytes) }),
    });
  }

  it("keeps ordinary JSON below a small default budget", async () => {
    expect((await post("/api/ordinary", 70 * 1024)).status).toBe(413);
  });

  it(`allows the explicit archive corridor up to ${LARGE_JSON_BODY_LIMIT}`, async () => {
    expect(
      (await post("/api/archive_singleplayer_game", 70 * 1024)).status,
    ).toBe(200);
  });
});
