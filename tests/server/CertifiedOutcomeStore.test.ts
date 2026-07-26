import { describe, expect, test, vi } from "vitest";
import { CertifiedOutcomeStore } from "../../src/server/CertifiedOutcomeStore";

vi.mock("../../src/server/db/pool", () => ({ pool: null }));

function outcome(gameId: string, won = true) {
  return {
    gameId,
    durationSeconds: 720,
    turnIntervalMs: 100,
    mapName: "plains",
    seasonId: "week-30",
    onMutator: false,
    intentFunnel: { early: {}, mid: {}, late: {} },
    players: [
      {
        persistentId: "player-1",
        displayName: "Player",
        won,
        vaultCaptures: 4,
        convoyDeliveries: 0,
        convoyIntercepts: 1,
        convoysLost: 0,
        executionChains: 0,
        surgeActivations: 0,
        behindAtMinute8: true,
        conquests: 3,
        passivePayouts: 0,
        betrayals: 0,
        jamBreakerUses: 0,
        convoyEscortCommands: 0,
        defenseFactoryTicks: 0,
      },
    ],
  };
}

describe("CertifiedOutcomeStore", () => {
  test("projects certified metrics, deduplicates retries, and derives a career trend", async () => {
    const store = new CertifiedOutcomeStore(null);

    expect(await store.recordMatch(outcome("game-1"))).toMatchObject({
      recordedPlayers: 1,
      duplicatePlayers: 0,
      durability: "process-local",
    });
    expect(await store.recordMatch(outcome("game-1"))).toMatchObject({
      recordedPlayers: 0,
      duplicatePlayers: 1,
    });
    await store.recordMatch(outcome("game-2"));
    await store.recordMatch(outcome("game-3", false));

    expect(await store.profile("player-1")).toMatchObject({
      persistentId: "player-1",
      durability: "process-local",
      history: [
        { matchId: "game-3", style: "Iron Fist" },
        { matchId: "game-2", style: "Iron Fist" },
        { matchId: "game-1", style: "Iron Fist" },
      ],
      trend: { style: "Iron Fist", count: 3 },
    });
    expect(await store.summary()).toMatchObject({
      evidence: "certified-match-result",
      players: 3,
      wins: 2,
      behindAtMinute8: 3,
      averageDurationSeconds: 720,
    });
  });

  test("uses the database uniqueness boundary when PostgreSQL is configured", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new CertifiedOutcomeStore({ query } as any);

    const receipt = await store.recordMatch(outcome("game-pg"));

    expect(receipt).toMatchObject({
      recordedPlayers: 1,
      durability: "postgres",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (persistent_id, game_id)"),
      expect.arrayContaining([
        "player-1",
        "game-pg",
        true,
        true,
        720,
        "plains",
        "Iron Fist",
      ]),
    );
  });
});
