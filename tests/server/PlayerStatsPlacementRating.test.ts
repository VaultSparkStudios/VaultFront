import { describe, expect, test, vi } from "vitest";
import { EloRating } from "../../src/server/EloRating";
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

describe("PlayerStatsStore placement rating parity", () => {
  test("uses placement K-factor through match five, then established K-factor", async () => {
    const store = new PlayerStatsStore(null);
    const calculate = vi.spyOn(EloRating, "calculate");
    const result = {
      won: true,
      durationSeconds: 300,
      vaultCaptures: 0,
      convoyDeliveries: 0,
      executionChains: 0,
      mapName: "plains",
      playerCount: 2,
      allPlayers: [
        { persistentId: "winner", displayName: "Winner", won: true },
        { persistentId: "loser", displayName: "Loser", won: false },
      ],
    };

    for (let match = 0; match < 6; match += 1) {
      await expect(
        store.recordMatch(
          "winner",
          "Winner",
          `placement-boundary-${match}`,
          result,
        ),
      ).resolves.toBe(true);
    }

    const winnerCalls = calculate.mock.calls.filter(([, , won]) => won);
    expect(winnerCalls.map(([, , , matchesPlayed]) => matchesPlayed)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);

    const equalPlacement = EloRating.calculate(1200, 1200, true, 0);
    const equalEstablished = EloRating.calculate(1200, 1200, true, 5);
    expect(equalPlacement.deltaA).toBe(32);
    expect(equalEstablished.deltaA).toBe(16);
    expect(EloRating.K_FACTOR_PLACEMENT).toBe(64);
    expect(EloRating.K_FACTOR).toBe(32);
  });
});
