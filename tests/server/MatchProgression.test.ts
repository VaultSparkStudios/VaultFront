import { describe, expect, test, vi } from "vitest";
import {
  derivePredictionOutcome,
  ServerAuthoritativeProgressionSpine,
  verifyProgressionReceipt,
} from "../../src/server/MatchProgression";

vi.mock("../../src/server/Logger", () => {
  const log = {
    child: () => log,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: log };
});

describe("ServerAuthoritativeProgressionSpine", () => {
  test("derives delivery, intercept, and tie outcomes deterministically", () => {
    const player = (deliveries: number, intercepts: number) => ({
      persistentId: "p",
      displayName: "P",
      won: false,
      vaultCaptures: 0,
      convoyDeliveries: deliveries,
      convoyIntercepts: intercepts,
      convoysLost: 0,
      executionChains: 0,
      surgeActivations: 0,
    });
    expect(derivePredictionOutcome([player(2, 1)])).toBe("delivery");
    expect(derivePredictionOutcome([player(1, 2)])).toBe("intercept");
    expect(derivePredictionOutcome([player(2, 2)])).toBe("delivery");
  });
  test("fans one authoritative outcome into existing stores exactly once", async () => {
    const recordMatch = vi.fn().mockResolvedValue(undefined);
    const reads = new Map<string, number>();
    const getPlayerStats = vi.fn(async (id: string) => {
      const read = reads.get(id) ?? 0;
      reads.set(id, read + 1);
      const after = {
        persistentId: id,
        displayName: id,
        eloRating: id === "p1" ? 1232 : 1184,
        matchesPlayed: 1,
        wins: id === "p1" ? 1 : 0,
        losses: id === "p1" ? 0 : 1,
        vaultCaptures: id === "p1" ? 2 : 1,
        convoyDeliveries: id === "p1" ? 3 : 0,
        executionChains: id === "p1" ? 1 : 0,
        surgeActivations: 0,
        placementComplete: false,
        placementMatchNumber: 2,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      return read === 0
        ? {
            ...after,
            eloRating: 1200,
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            vaultCaptures: 0,
            convoyDeliveries: 0,
            executionChains: 0,
          }
        : after;
    });
    const checkAndUnlock = vi.fn(
      (_persistentId: string, event: { type: string }) =>
        event.type === "match_ended" ? ([{}] as any[]) : [],
    ) as any;
    const recordSeasonPass = vi.fn().mockResolvedValue({
      seasonId: "week-29",
      milestones: [],
      entitlements: [],
      evidence: "certified-match-result",
      durability: "process-local",
    });
    const resolvePrediction = vi.fn(async () => ({
      gameId: "game-1",
      actualOutcome: "delivery" as const,
      resolvedPredictions: 4,
      durability: "process-local" as const,
    }));
    const recordDailyMastery = vi.fn().mockResolvedValue({
      persistentId: "p1",
      challengeId: "vault-5",
      dateUtc: "2026-07-23",
      progress: 2,
      target: 5,
      rewardMastery: 50,
      completedNow: false,
      masteryBalance: 0,
      durability: "process-local",
    });
    const recordSeasonContracts = vi.fn().mockResolvedValue({
      seasonId: "week-29",
      interceptionTiming: 1,
      objectiveDenial: 2,
      comebackExecution: 1,
      surgeExecution: 1,
      evidence: "certified-match-result",
      durability: "process-local",
    });
    const recordCertifiedOutcomes = vi.fn().mockResolvedValue({
      gameId: "game-1",
      recordedPlayers: 2,
      duplicatePlayers: 0,
      durability: "process-local",
    });
    const recordLoopEvidence = vi.fn().mockResolvedValue({
      gameId: "game-1",
      evidence: "certified-match-result",
    });
    const persistReceipt = vi.fn().mockResolvedValue(undefined);
    const spine = new ServerAuthoritativeProgressionSpine({
      recordMatch,
      getPlayerStats,
      checkAndUnlock,
      recordSeasonPass,
      resolvePrediction,
      recordDailyMastery,
      recordSeasonContracts,
      recordLoopEvidence,
      recordCertifiedOutcomes,
      loadReceipt: vi.fn().mockResolvedValue(null),
      persistReceipt,
      receiptDurability: () => "postgres",
      now: () => new Date("2026-08-01T20:00:00.000Z"),
    });
    const outcome = {
      gameId: "game-1",
      durationSeconds: 420,
      mapName: "plains",
      seasonId: "week-29",
      onMutator: true,
      turnIntervalMs: 100,
      intentFunnel: { early: {}, mid: {}, late: {} },
      players: [
        {
          persistentId: "p1",
          displayName: "Winner",
          won: true,
          vaultCaptures: 2,
          convoyDeliveries: 3,
          convoyIntercepts: 1,
          convoysLost: 1,
          executionChains: 1,
          surgeActivations: 1,
          vaultPressureContributions: 3,
          firstVaultPressureTick: 100,
          firstBreachOpenTick: 200,
          decisiveDeliveryTick: 300,
          vaultBreachVictoryTick: 300,
        },
        {
          persistentId: "p2",
          displayName: "RunnerUp",
          won: false,
          vaultCaptures: 0,
          convoyDeliveries: 0,
          convoyIntercepts: 1,
          convoysLost: 2,
          executionChains: 0,
          surgeActivations: 0,
        },
      ],
    };

    const first = await spine.record(outcome);
    const duplicate = await spine.record(outcome);

    expect(first).toMatchObject({
      duplicate: false,
      playersRecorded: 2,
      achievementsUnlocked: 2,
      predictionOutcome: "delivery",
      predictionsResolved: 4,
      dailyMastery: [expect.any(Object), expect.any(Object)],
      seasonContracts: [expect.any(Object), expect.any(Object)],
      seasonPass: [expect.any(Object), expect.any(Object)],
      certifiedOutcomes: expect.objectContaining({ recordedPlayers: 2 }),
      durability: "postgres",
      recordedAt: "2026-08-01T20:00:00.000Z",
      players: [
        expect.objectContaining({
          persistentId: "p1",
          delta: expect.objectContaining({
            eloRating: 32,
            matchesPlayed: 1,
            wins: 1,
            convoyDeliveries: 3,
          }),
          match: expect.objectContaining({
            vaultPressureContributions: 3,
            won: true,
          }),
        }),
        expect.objectContaining({
          persistentId: "p2",
          delta: expect.objectContaining({ eloRating: -16, losses: 1 }),
        }),
      ],
      receiptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(duplicate).toMatchObject({ duplicate: true, playersRecorded: 0 });
    expect(duplicate.receiptDigest).toBe(first.receiptDigest);
    expect(verifyProgressionReceipt(first)).toBe(true);
    expect(verifyProgressionReceipt(duplicate)).toBe(false);
    expect(
      verifyProgressionReceipt({ ...first, achievementsUnlocked: 999 }),
    ).toBe(false);
    expect(recordMatch).toHaveBeenCalledTimes(1);
    expect(resolvePrediction).toHaveBeenCalledTimes(1);
    expect(resolvePrediction).toHaveBeenCalledWith("game-1", "delivery");
    expect(recordMatch.mock.calls[0][3].statsByPersistentId).toEqual({
      p1: { vaultCaptures: 2, convoyDeliveries: 3, executionChains: 1 },
      p2: { vaultCaptures: 0, convoyDeliveries: 0, executionChains: 0 },
    });
    expect(getPlayerStats).toHaveBeenCalledTimes(4);
    expect(checkAndUnlock).toHaveBeenCalledWith("p1", {
      type: "match_ended",
      won: true,
      durationSeconds: 420,
      onMutator: true,
      eloRating: 1232,
    });
    expect(recordSeasonPass).toHaveBeenCalledWith(
      "game-1",
      "week-29",
      expect.objectContaining({
        persistentId: "p1",
        convoyDeliveries: 3,
        achievementsUnlocked: 1,
      }),
    );
    expect(recordDailyMastery).toHaveBeenCalledTimes(2);
    expect(recordSeasonContracts).toHaveBeenCalledTimes(2);
    expect(recordLoopEvidence).toHaveBeenCalledTimes(1);
    expect(recordLoopEvidence).toHaveBeenCalledWith(outcome);
    expect(recordCertifiedOutcomes).toHaveBeenCalledTimes(1);
    expect(recordCertifiedOutcomes).toHaveBeenCalledWith(outcome);
    expect(persistReceipt).toHaveBeenCalledWith(first, ["p1", "p2"]);
    expect(
      verifyProgressionReceipt({
        ...first,
        players: first.players.map((player, index) =>
          index === 0
            ? { ...player, delta: { ...player.delta, eloRating: 999 } }
            : player,
        ),
      }),
    ).toBe(false);
    expect(recordSeasonContracts).toHaveBeenCalledWith(
      "game-1",
      "week-29",
      expect.objectContaining({ persistentId: "p1", convoysLost: 1 }),
    );
  });

  test("returns a durable duplicate on restart without replaying fan-out", async () => {
    const stored = await new ServerAuthoritativeProgressionSpine({
      loadReceipt: vi.fn().mockResolvedValue(null),
      persistReceipt: vi.fn(),
      receiptDurability: () => "process-local",
      now: () => new Date("2026-08-01T20:00:00.000Z"),
      resolvePrediction: vi.fn(async () => ({
        gameId: "restart-game",
        actualOutcome: "delivery" as const,
        resolvedPredictions: 0,
        durability: "process-local" as const,
      })),
      recordLoopEvidence: vi.fn().mockResolvedValue(null),
      recordCertifiedOutcomes: vi.fn().mockResolvedValue(null),
    }).record({
      gameId: "restart-game",
      durationSeconds: 0,
      mapName: "plains",
      seasonId: "week-30",
      onMutator: false,
      turnIntervalMs: 100,
      intentFunnel: { early: {}, mid: {}, late: {} },
      players: [],
    });
    const recordMatch = vi.fn();
    const restarted = new ServerAuthoritativeProgressionSpine({
      loadReceipt: vi.fn().mockResolvedValue(stored),
      recordMatch,
    });
    const duplicate = await restarted.record({
      gameId: "restart-game",
      durationSeconds: 0,
      mapName: "plains",
      seasonId: "week-30",
      onMutator: false,
      turnIntervalMs: 100,
      intentFunnel: { early: {}, mid: {}, late: {} },
      players: [],
    });
    expect(duplicate).toMatchObject({
      duplicate: true,
      receiptDigest: stored.receiptDigest,
    });
    expect(recordMatch).not.toHaveBeenCalled();
  });

  test("coalesces concurrent envelopes and releases a failed fan-out for retry", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const recordMatch = vi.fn().mockResolvedValue(true);
    const resolvePrediction = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstGate;
        return {
          gameId: "retry-game",
          actualOutcome: "delivery" as const,
          resolvedPredictions: 0,
          durability: "process-local" as const,
        };
      })
      .mockResolvedValue({
        gameId: "retry-game",
        actualOutcome: "delivery" as const,
        resolvedPredictions: 0,
        durability: "process-local" as const,
      });
    const recordLoopEvidence = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary downstream failure"))
      .mockResolvedValue({
        gameId: "retry-game",
        evidence: "certified-match-result",
      });
    const spine = new ServerAuthoritativeProgressionSpine({
      recordMatch,
      resolvePrediction,
      recordLoopEvidence,
    });
    const outcome = {
      gameId: "retry-game",
      durationSeconds: 0,
      mapName: "plains",
      seasonId: "week-30",
      onMutator: false,
      turnIntervalMs: 100,
      intentFunnel: { early: {}, mid: {}, late: {} },
      players: [],
    };

    const first = spine.record(outcome);
    const concurrent = spine.record(outcome);
    releaseFirst();
    await expect(first).rejects.toThrow("temporary downstream failure");
    await expect(concurrent).rejects.toThrow("temporary downstream failure");

    const recovered = await spine.record(outcome);
    expect(recovered).toMatchObject({ duplicate: false, gameId: "retry-game" });
    expect(resolvePrediction).toHaveBeenCalledTimes(2);
    expect(recordLoopEvidence).toHaveBeenCalledTimes(2);
  });

  test("resolves an intercept-dominant match once even without progression players", async () => {
    const resolvePrediction = vi.fn(async () => ({
      gameId: "empty",
      actualOutcome: "delivery" as const,
      resolvedPredictions: 1,
      durability: "process-local" as const,
    }));
    const spine = new ServerAuthoritativeProgressionSpine({
      recordMatch: vi.fn(),
      getPlayerStats: vi.fn(),
      checkAndUnlock: vi.fn(),
      recordSeasonPass: vi.fn(),
      resolvePrediction,
      recordLoopEvidence: vi.fn().mockResolvedValue(null),
    });

    const receipt = await spine.record({
      gameId: "empty",
      durationSeconds: 0,
      mapName: "plains",
      seasonId: "week-29",
      onMutator: false,
      turnIntervalMs: 100,
      intentFunnel: { early: {}, mid: {}, late: {} },
      players: [],
    });

    expect(receipt).toMatchObject({
      predictionOutcome: "delivery",
      predictionsResolved: 1,
    });
    await spine.record({
      gameId: "empty",
      durationSeconds: 0,
      mapName: "plains",
      seasonId: "week-29",
      onMutator: false,
      turnIntervalMs: 100,
      intentFunnel: { early: {}, mid: {}, late: {} },
      players: [],
    });
    expect(resolvePrediction).toHaveBeenCalledTimes(1);
  });
});
