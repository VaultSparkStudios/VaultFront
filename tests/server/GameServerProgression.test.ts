import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/core/configuration/ConfigLoader", () => ({
  getServerConfigFromServer: () => ({
    otelEnabled: () => false,
    otelAuthHeader: () => "",
    otelEndpoint: () => "",
    env: () => 0,
  }),
  getServerConfig: () => ({ otelEnabled: () => false }),
}));

vi.mock("../../src/server/MatchProgression", () => ({
  matchProgressionSpine: { record: vi.fn().mockResolvedValue({}) },
}));

vi.mock("../../src/server/Archive", () => ({
  archive: vi.fn(),
  finalizeGameRecord: (record: unknown) => record,
}));

vi.mock("../../src/server/VaultSeasonScheduler", () => ({
  vaultSeasonScheduler: { getStatus: () => ({ weekNumber: 29 }) },
}));

import { GameType } from "../../src/core/game/Game";
import { archive } from "../../src/server/Archive";
import { GameServer } from "../../src/server/GameServer";
import { matchProgressionSpine } from "../../src/server/MatchProgression";
import { buildMatchResultCertificate } from "../../src/server/MatchResultCertificate";

describe("GameServer progression wiring", () => {
  const logger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const config = {
    turnIntervalMs: () => 100,
    gameCreationRate: () => 1000,
    env: () => 0,
  };

  beforeEach(() => {
    vi.mocked(matchProgressionSpine.record).mockClear();
    vi.mocked(archive).mockClear();
  });

  test("builds the authoritative envelope from the accepted winner vote", async () => {
    const game = new GameServer(
      "game1234",
      logger as any,
      Date.now(),
      config as any,
      {
        gameType: GameType.Private,
        gameMap: "plains",
        vaultWeeklyMutator: "lane_fog",
      } as any,
    );
    (game as any)._startTime = Date.now() - 420_000;
    (game as any).gameStartInfo = {
      config: { gameMap: "plains", vaultWeeklyMutator: "lane_fog" },
      players: [
        { clientID: "client01", username: "Winner" },
        { clientID: "client02", username: "RunnerUp" },
      ],
    };
    (game as any).allClients = new Map([
      ["client01", { persistentID: "p1" }],
      ["client02", { persistentID: "p2" }],
    ]);
    const accepted = {
      status: "accepted" as const,
      resultDigest: "a".repeat(64),
      result: {
        type: "winner" as const,
        winner: ["player", "client01"] as ["player", string],
        allPlayersStats: {
          client01: {
            conquests: [2n, 1n],
            betrayals: 1n,
            vaultfront: {
              vaultCaptures: 2n,
              vaultConvoysDelivered: 3n,
              vaultConvoysIntercepted: 1n,
              cleanExecutionStreaks: 1n,
              surgeActivations: 1n,
              minute8Behind: 1n,
              vaultPassivePayouts: 4n,
              jamBreakerUses: 2n,
              convoyEscortCommands: 3n,
              defenseFactoryPulseUptimeTicks: 600n,
              firstVaultPressureTick: 120n,
              firstBreachOpenTick: 240n,
              decisiveDeliveryTick: 360n,
              vaultBreachVictoryTick: 360n,
            },
          },
          client02: {
            vaultfront: {
              vaultCaptures: 1n,
              vaultConvoysDelivered: 0n,
              vaultConvoysIntercepted: 2n,
              cleanExecutionStreaks: 0n,
              surgeActivations: 0n,
            },
          },
        },
      } as any,
      votes: 2,
      activeUniqueIPs: 3,
    };
    // Use the real digest produced for the complete result.
    const { canonicalEvidenceDigest } =
      await import("../../src/server/MatchResultCertificate");
    accepted.resultDigest = canonicalEvidenceDigest({
      winner: accepted.result.winner,
      allPlayersStats: accepted.result.allPlayersStats,
    });
    (game as any).resultCertificate = buildMatchResultCertificate({
      gameID: "game1234",
      config: (game as any).gameStartInfo.config,
      turns: [],
      accepted,
    });

    (game as any).recordProgressionOutcome();
    await Promise.resolve();

    expect(matchProgressionSpine.record).toHaveBeenCalledTimes(1);
    expect(matchProgressionSpine.record).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: "game1234",
        mapName: "plains",
        seasonId: "week-29",
        onMutator: true,
        players: [
          expect.objectContaining({
            persistentId: "p1",
            displayName: "Winner",
            won: true,
            convoyDeliveries: 3,
            convoyIntercepts: 1,
            behindAtMinute8: true,
            conquests: 3,
            passivePayouts: 4,
            betrayals: 1,
            jamBreakerUses: 2,
            convoyEscortCommands: 3,
            defenseFactoryTicks: 600,
            firstVaultPressureTick: 120,
            firstBreachOpenTick: 240,
            decisiveDeliveryTick: 360,
            vaultBreachVictoryTick: 360,
          }),
          expect.objectContaining({
            persistentId: "p2",
            displayName: "RunnerUp",
            won: false,
            vaultCaptures: 1,
          }),
        ],
      }),
    );

    (game as any).archiveGame();
    expect(archive).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenCalledWith(
      expect.objectContaining({
        telemetry: expect.objectContaining({
          resultCertificate: expect.objectContaining({
            certificateId: (game as any).resultCertificate.certificateId,
          }),
        }),
      }),
    );
  });

  test("ignores winner-shaped client state when no certificate exists", async () => {
    const game = new GameServer(
      "game1234",
      logger as any,
      Date.now(),
      config as any,
      { gameType: GameType.Private } as any,
    );
    (game as any)._startTime = Date.now() - 1_000;
    (game as any).gameStartInfo = { config: {}, players: [] };
    (game as any).winner = {
      winner: ["player", "attacker"],
      allPlayersStats: {},
    };

    (game as any).recordProgressionOutcome();
    await Promise.resolve();

    expect(matchProgressionSpine.record).not.toHaveBeenCalled();
  });
});
