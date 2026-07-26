import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { createE2EFixtureServer } from "../../scripts/e2e-fixture-server.mjs";

const servers: ReturnType<typeof createE2EFixtureServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("deterministic E2E fixture", () => {
  test("serves only the canonical health and client bootstrap contracts", async () => {
    const server = createE2EFixtureServer();
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;

    await expect(
      fetch(`${origin}/_health`).then((res) => res.json()),
    ).resolves.toMatchObject({
      status: "ok",
      evidence: "deterministic-local-e2e-fixture",
    });
    await expect(
      fetch(`${origin}/api/env`).then((res) => res.json()),
    ).resolves.toEqual({
      env: "dev",
      game_env: "dev",
    });
    expect((await fetch(`${origin}/api/health`)).status).toBe(404);
    expect(
      (
        await fetch(`${origin}/api/env`, {
          method: "POST",
        })
      ).status,
    ).toBe(405);
  });
});
