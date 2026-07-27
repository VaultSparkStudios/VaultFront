import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { PlayerStatsStore } from "../../src/server/PlayerStatsStore";

vi.mock("../../src/server/Logger", () => {
  const log = {
    child: () => log,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: log };
});

const players = [
  { persistentId: "alpha", displayName: "Alpha", won: true },
  { persistentId: "bravo", displayName: "Bravo", won: true },
] as const;

describe("PlayerStatsStore leaderboard projection", () => {
  test("uses stable identity ordering for tied in-memory ratings", async () => {
    const store = new PlayerStatsStore(null);
    await store.recordMatch("alpha", "Alpha", "game0001", {
      won: true,
      durationSeconds: 120,
      vaultCaptures: 1,
      convoyDeliveries: 0,
      executionChains: 0,
      mapName: "plains",
      playerCount: players.length,
      allPlayers: [...players],
    });

    const projection = await store.getLeaderboardProjection(50);
    expect(projection).toMatchObject({
      schemaVersion: "1.0",
      source: "process-memory",
    });
    expect(projection.entries.map((entry) => entry.persistentId)).toEqual([
      "alpha",
      "bravo",
    ]);
    expect(projection.entries.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  test("uses a bounded indexed query and exposes projection provenance", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
      rows: [
        {
          persistent_id: "alpha",
          display_name: "Alpha",
          elo_rating: 1400,
          rank: "1",
          matches_played: 8,
          wins: 6,
        },
      ],
    }));
    const store = new PlayerStatsStore({ query } as never);

    const projection = await store.getLeaderboardProjection(50);
    const sql = String(query.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("WITH top_players AS");
    expect(sql).toContain("ORDER BY elo_rating DESC, persistent_id ASC");
    expect(sql).not.toMatch(/leaderboard_cache|TRUNCATE/i);
    expect(query).toHaveBeenCalledWith(expect.any(String), [50]);
    expect(projection).toMatchObject({
      schemaVersion: "1.0",
      source: "player-stats-index",
      entries: [{ persistentId: "alpha", rank: 1 }],
    });
  });

  test("keeps table-wide cache work out of the certified write store", () => {
    const source = readFileSync("src/server/PlayerStatsStore.ts", "utf8");

    expect(source).not.toMatch(/TRUNCATE\s+leaderboard_cache/i);
    expect(source).not.toMatch(/INSERT\s+INTO\s+leaderboard_cache/i);
  });
});
