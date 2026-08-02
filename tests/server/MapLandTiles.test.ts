import { vi } from "vitest";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import { GameMapType } from "../../src/core/game/Game";
import { MapCapacityAuthority } from "../../src/server/MapLandTiles";

describe("MapCapacityAuthority", () => {
  test("coalesces concurrent manifest reads and caches verified capacity", async () => {
    let calls = 0;
    const authority = new MapCapacityAuthority(async () => {
      calls++;
      await Promise.resolve();
      return 2_500_000;
    });

    const [first, second] = await Promise.all([
      authority.observe(GameMapType.World),
      authority.observe(GameMapType.World),
    ]);

    expect(calls).toBe(1);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      landTiles: 2_500_000,
      source: "manifest",
      error: null,
    });
    await authority.observe(GameMapType.World);
    expect(calls).toBe(1);
  });

  test.each([0, -1, 1.5, Number.NaN])(
    "labels malformed manifest capacity %s as bounded fallback",
    async (value) => {
      const authority = new MapCapacityAuthority(async () => value, {
        fallbackLandTiles: 900_000,
      });
      await expect(authority.observe(GameMapType.World)).resolves.toMatchObject(
        {
          landTiles: 900_000,
          source: "bounded-fallback",
          error: "map-capacity-invalid-manifest",
        },
      );
    },
  );

  test("bounds a stalled manifest and retries after the fallback TTL", async () => {
    let now = 100;
    let calls = 0;
    const authority = new MapCapacityAuthority(
      async () => {
        calls++;
        if (calls === 1) return new Promise<number>(() => {});
        return 3_000_000;
      },
      {
        timeoutMs: 5,
        fallbackTtlMs: 10,
        now: () => now,
      },
    );

    await expect(authority.observe(GameMapType.World)).resolves.toMatchObject({
      source: "bounded-fallback",
      error: "map-capacity-timeout:5ms",
    });
    await authority.observe(GameMapType.World);
    expect(calls).toBe(1);
    now = 111;
    await expect(authority.observe(GameMapType.World)).resolves.toMatchObject({
      source: "manifest",
      landTiles: 3_000_000,
    });
    expect(calls).toBe(2);
  });
});
