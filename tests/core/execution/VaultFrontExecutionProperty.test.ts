import { VaultFrontExecution } from "../../../src/core/execution/VaultFrontExecution";
import { projectVaultFrontMutatorBalance } from "../../../src/core/execution/VaultFrontRuntimeBalance";
import { MessageType, UnitType } from "../../../src/core/game/Game";

function defaultRewardTuning() {
  return {
    minGoldReward: 120_000,
    minTroopsReward: 900,
    lowSignalEarlyWindowTicks: 900,
    riskMultiplierBase: 0.88,
    riskMultiplierScale: 0.5,
    rewardMultiplierMin: 0.58,
    rewardMultiplierMax: 1.5,
    baselineGoldOwnerStrengthScale: 360,
    baselineGoldAvgStrengthScale: 280,
    baselineGoldRiskBase: 0.9,
    baselineGoldRiskScale: 0.3,
    distanceGoldMin: 320,
    distanceGoldOwnerStrengthScale: 1.9,
    distanceGoldFlat: 260,
    distanceGoldRiskBase: 0.65,
    distanceGoldRiskScale: 0.6,
    troopsSqrtGoldScale: 2.2,
    troopsDistanceBase: 4,
    troopsDistanceRiskScale: 6,
  };
}

function mockPlayer(
  id: number,
  {
    tiles = 220,
    troops = 110_000,
    gold = 550_000,
  }: { tiles?: number; troops?: number; gold?: number } = {},
) {
  return {
    smallID: () => id,
    isAlive: () => true,
    isPlayer: () => true,
    isFriendly: () => false,
    numTilesOwned: () => tiles,
    troops: () => troops,
    gold: () => BigInt(gold),
    id: () => `${id}`,
    displayName: () => `P${id}`,
    spawnTile: () => 0,
    units: () => [],
  } as any;
}

describe("VaultFrontExecution property tests", () => {
  test("reward monotonicity: longer routes do not reduce convoy rewards", () => {
    const execution = new VaultFrontExecution() as any;
    const owner = mockPlayer(1, { tiles: 260, troops: 130_000, gold: 700_000 });
    const peer = mockPlayer(2, { tiles: 240, troops: 125_000, gold: 680_000 });
    execution.game = {
      players: () => [owner, peer],
      config: () => ({
        numSpawnPhaseTurns: () => 0,
        vaultConvoyRewardTuning: () => defaultRewardTuning(),
      }),
    };

    for (const risk of [0, 0.2, 0.5, 0.8, 1]) {
      let previous: ReturnType<typeof execution.convoyRewardPlan> | null = null;
      for (const distance of [0, 15, 35, 70, 140]) {
        const current = execution.convoyRewardPlan(
          owner,
          distance,
          risk,
          3_600,
          1,
        );
        if (previous) {
          expect(current.goldReward >= previous.goldReward).toBe(true);
          expect(current.troopsReward >= previous.troopsReward).toBe(true);
        }
        previous = current;
      }
    }
  });

  test("reroute stability: safest destination is min-risk then min-distance", () => {
    const execution = new VaultFrontExecution() as any;
    execution.game = {
      manhattanDist: (a: number, b: number) => Math.abs(a - b),
    };
    const owner = {
      units: () => [
        { type: () => UnitType.City, tile: () => 12 },
        { type: () => UnitType.Port, tile: () => 25 },
        { type: () => UnitType.Factory, tile: () => 33 },
        { type: () => UnitType.MissileSilo, tile: () => 41 },
      ],
      spawnTile: () => 0,
    } as any;
    const source = 20;
    let seed = 0x5eed1234;
    const nextRisk = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let i = 0; i < 80; i++) {
      const riskByTile = new Map<number, number>([
        [12, nextRisk()],
        [25, nextRisk()],
        [33, nextRisk()],
        [41, nextRisk()],
      ]);
      vi.spyOn(execution, "routeRiskScore").mockImplementation(
        (_p: unknown, _s: number, dst: number) => riskByTile.get(dst) ?? 1,
      );

      const destination = execution.bestConvoyDestination(
        owner,
        source,
        undefined,
        "reroute_safest",
      );
      const candidates = [...riskByTile.entries()].sort((a, b) => {
        const riskDelta = a[1] - b[1];
        if (Math.abs(riskDelta) > 0.0001) return riskDelta;
        return Math.abs(a[0] - source) - Math.abs(b[0] - source);
      });
      expect(destination).toBe(candidates[0][0]);
      vi.restoreAllMocks();
    }

    const epsilonTie = new Map<number, number>([
      [12, 0.8],
      [25, 0.5],
      [33, 0.40005],
      [41, 0.4],
    ]);
    vi.spyOn(execution, "routeRiskScore").mockImplementation(
      (_p: unknown, _s: number, dst: number) => epsilonTie.get(dst) ?? 1,
    );
    expect(
      execution.bestConvoyDestination(
        owner,
        source,
        undefined,
        "reroute_safest",
      ),
    ).toBe(33);
    vi.restoreAllMocks();
  });

  test("cooldown invariants: jam breaker cannot bypass its own cooldown", () => {
    const execution = new VaultFrontExecution() as any;
    const stats = { defenseFactoryJamBreaker: vi.fn() };
    let gold = 400_000n;
    const player = {
      smallID: () => 7,
      gold: () => gold,
      removeGold: (value: bigint) => {
        gold -= value;
      },
      id: () => "7",
      isFriendly: () => false,
      isPlayer: () => true,
      isAlive: () => true,
      spawnTile: () => 10,
    } as any;

    execution.game = {
      displayMessage: (_msg: string, _type: MessageType, _id?: string) => {},
      addUpdate: () => {},
      stats: () => stats,
      players: () => [player],
      playerBySmallID: () => player,
      ticks: () => 100,
      config: () => ({
        vaultConvoyRewardTuning: () => defaultRewardTuning(),
        numSpawnPhaseTurns: () => 0,
      }),
    };
    execution.beacons = new Map<number, any>([
      [7, { charge: 20, cooldownUntil: 0, maskedUntil: 0 }],
      [8, { charge: 90, cooldownUntil: 0, maskedUntil: 600 }],
    ]);
    execution.jamBreakerCooldownUntil = new Map<number, number>([[7, 0]]);

    execution.applyJamBreakerCommand(player, 100);
    const afterFirst = gold;
    expect(stats.defenseFactoryJamBreaker).toHaveBeenCalledTimes(1);
    expect(execution.jamBreakerCooldownUntil.get(7)).toBe(1_000);

    execution.applyJamBreakerCommand(player, 180);
    expect(gold).toBe(afterFirst);
    expect(stats.defenseFactoryJamBreaker).toHaveBeenCalledTimes(1);
  });

  test("clean execution chain grants next convoy streak multiplier", () => {
    const execution = new VaultFrontExecution() as any;
    const player = mockPlayer(3);
    execution.game = {
      stats: () => ({
        cleanExecutionStreak: vi.fn(),
      }),
      displayMessage: () => {},
    };
    execution.executionChainStep = new Map<number, number>([[3, 0]]);
    execution.executionChainExpiresAtTick = new Map<number, number>([[3, 0]]);
    execution.executionStreakNextConvoyMultiplier = new Map<number, number>([
      [3, 1],
    ]);

    execution.updateExecutionChainCapture(player, 100);
    execution.updateExecutionChainConvoyDelivered(player, 300);
    execution.updateExecutionChainPulseDeny(player, 420, true);

    expect(
      execution.executionStreakNextConvoyMultiplier.get(3),
    ).toBeGreaterThan(1);
    expect(execution.executionChainStep.get(3)).toBe(0);
  });

  test("weekly mutator rotates effective cooldown and passive values", () => {
    const accelerated = projectVaultFrontMutatorBalance(
      "accelerated_cooldowns",
    );
    expect(accelerated.vaultCooldownTicks).toBeLessThan(650);
    expect(accelerated.jamBreakerCooldownTicks).toBeLessThan(900);
    const doublePassive = projectVaultFrontMutatorBalance("double_passive");
    expect(doublePassive.vaultPassiveIncomeIntervalTicks).toBeLessThan(600);
    expect(doublePassive.vaultPassiveGoldPerMinute).toBe(150_000n);
  });
});
