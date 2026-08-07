import { vi } from "vitest";
import { bigintToSafeNumber } from "../../../src/core/execution/SafeNumber";
import { VaultFrontExecution } from "../../../src/core/execution/VaultFrontExecution";
import { projectVaultFrontMutatorBalance } from "../../../src/core/execution/VaultFrontRuntimeBalance";
import { UnitType, VaultFrontCommand } from "../../../src/core/game/Game";

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
    tiles = 200,
    troops = 120_000,
    gold = 600_000,
  }: { tiles?: number; troops?: number; gold?: number } = {},
) {
  return {
    smallID: () => id,
    isAlive: () => true,
    numTilesOwned: () => tiles,
    troops: () => troops,
    gold: () => BigInt(gold),
  } as any;
}

describe("VaultFrontExecution", () => {
  test("projects the deterministic execution-chain reset cause", () => {
    const execution = new VaultFrontExecution() as any;
    execution.executionChainStep = new Map([[7, 2]]);
    execution.executionChainExpiresAtTick = new Map([[7, 900]]);
    execution.executionChainLastResetReason = new Map();
    execution.executionChainLastResetTick = new Map();
    execution.executionChainLastResetFromStep = new Map();

    execution.resetExecutionChain(7, "convoy_intercepted", 640);

    expect(execution.buildExecutionChainStates()[7]).toEqual({
      step: 0,
      expiresAtTick: 0,
      lastResetReason: "convoy_intercepted",
      lastResetTick: 640,
      lastResetFromStep: 2,
    });
  });

  test("reroute_safest breaks equal-risk ties by shortest distance", () => {
    const execution = new VaultFrontExecution() as any;
    execution.game = {
      manhattanDist: (a: number, b: number) => Math.abs(a - b),
    };

    const owner = {
      units: () => [
        { type: () => UnitType.City, tile: () => 18 },
        { type: () => UnitType.Factory, tile: () => 30 },
      ],
      spawnTile: () => 0,
    } as any;

    vi.spyOn(execution, "routeRiskScore").mockReturnValue(0.2);
    const destination = execution.bestConvoyDestination(
      owner,
      10,
      undefined,
      "reroute_safest",
    );

    expect(destination).toBe(18);
  });

  test("convoyRewardPlan scales up with distance and risk, and down with rewardScale", () => {
    const execution = new VaultFrontExecution() as any;
    const owner = mockPlayer(1, { tiles: 250, troops: 180_000, gold: 700_000 });
    const peer = mockPlayer(2, { tiles: 260, troops: 170_000, gold: 680_000 });

    execution.game = {
      players: () => [owner, peer],
      config: () => ({
        numSpawnPhaseTurns: () => 0,
        vaultConvoyRewardTuning: () => defaultRewardTuning(),
      }),
    };

    const shortSafe = execution.convoyRewardPlan(owner, 30, 0.1, 4_000, 1);
    const longSafe = execution.convoyRewardPlan(owner, 80, 0.1, 4_000, 1);
    const longRisky = execution.convoyRewardPlan(owner, 80, 0.8, 4_000, 1);
    const longRiskyReduced = execution.convoyRewardPlan(
      owner,
      80,
      0.8,
      4_000,
      0.72,
    );

    expect(longSafe.goldReward > shortSafe.goldReward).toBe(true);
    expect(longSafe.troopsReward > shortSafe.troopsReward).toBe(true);
    expect(longRisky.goldReward > longSafe.goldReward).toBe(true);
    expect(longRisky.troopsReward > longSafe.troopsReward).toBe(true);
    expect(longRiskyReduced.goldReward < longRisky.goldReward).toBe(true);
    expect(longRiskyReduced.troopsReward < longRisky.troopsReward).toBe(true);
  });

  test("bigintToSafeNumber clamps values beyond MAX_SAFE_INTEGER", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 50_000n;
    expect(bigintToSafeNumber(huge)).toBe(Number.MAX_SAFE_INTEGER);
    expect(bigintToSafeNumber(42n)).toBe(42);
  });

  test("vault passive income activity is not suppressed during low-signal window", () => {
    const execution = new VaultFrontExecution() as any;
    const addUpdate = vi.fn();
    execution.game = {
      ticks: () => 120,
      addUpdate,
      config: () => ({
        numSpawnPhaseTurns: () => 0,
        vaultConvoyRewardTuning: () => defaultRewardTuning(),
      }),
    };

    execution.emitActivity(
      "vault_passive_income",
      12,
      1,
      null,
      "Vault 1 passive +90,000g",
      120,
    );

    expect(addUpdate).toHaveBeenCalledTimes(1);
    expect(addUpdate.mock.calls[0][0].activity).toBe("vault_passive_income");
  });

  test("newly launched convoy is included in the published status update", () => {
    const execution = new VaultFrontExecution() as any;
    const addUpdate = vi.fn();
    const displayMessage = vi.fn();
    const owner = {
      smallID: () => 1,
      id: () => "p1",
      isPlayer: () => true,
      isAlive: () => true,
      displayName: () => "P1",
      spawnTile: () => 5,
      units: () => [{ type: () => UnitType.City, tile: () => 14 }],
      unitCount: () => 1,
      numTilesOwned: () => 220,
      troops: () => 150_000,
      gold: () => 500_000n,
    };
    execution.game = {
      addUpdate,
      displayMessage,
      players: () => [owner],
      playerBySmallID: () => owner,
      owner: () => owner,
      manhattanDist: (a: number, b: number) => Math.abs(a - b),
      x: (tile: number) => tile % 100,
      y: (tile: number) => Math.floor(tile / 100),
      isValidCoord: () => true,
      ref: (x: number, y: number) => x + y * 100,
      setVaultSiteControllerIDs: vi.fn(),
      debugPublishedStatus: vi.fn(),
      ticks: () => 1000,
      stats: () => ({
        vaultConvoyLaunched: () => {},
        vaultInteraction: () => {},
      }),
      config: () => ({
        numSpawnPhaseTurns: () => 0,
        vaultConvoyRewardTuning: () => defaultRewardTuning(),
      }),
    };
    execution.executionStreakNextConvoyMultiplier = new Map([[1, 1]]);
    execution.preferredConvoyDestination = new Map([[1, UnitType.City]]);
    execution.escortUntilTick = new Map([[1, 0]]);
    execution.vaultSites = [
      {
        id: 1,
        tile: 9,
        controllerID: 1,
        controlTicks: 90,
        cooldownTicks: 0,
        passiveOwnerID: 1,
        nextPassiveGoldTick: 1600,
        reducedRewardNextCapture: false,
      },
    ];
    execution.beacons = new Map([
      [1, { charge: 80, cooldownUntil: 0, maskedUntil: 0 }],
    ]);
    vi.spyOn(execution, "buildConvoyReroutePreviews").mockReturnValue([]);
    vi.spyOn(execution, "routeRiskScore").mockReturnValue(0.2);

    execution.startConvoy(owner, execution.vaultSites[0], 1000, 1);
    execution.publishStatusUpdate();

    const statusUpdate = addUpdate.mock.calls.at(-1)?.[0];
    expect(statusUpdate).toMatchObject({
      weeklyMutator: "none",
      executionChainWindowTicks: 1_500,
      executionChainRewardMultiplier: 1.2,
    });
    expect(statusUpdate.convoys).toHaveLength(1);
    expect(statusUpdate.convoys[0]).toMatchObject({
      ownerID: 1,
      sourceTile: 9,
      destinationTile: 14,
    });

    const updateCount = addUpdate.mock.calls.length;
    execution.publishStatusUpdate();
    expect(addUpdate).toHaveBeenCalledTimes(updateCount);
    expect(execution.statusProjectionPosture()).toMatchObject({
      cadenceTicks: 5,
      builds: 2,
      publishes: 1,
      deduplicated: 1,
      buildSampleCount: 2,
    });
    expect(execution.statusProjectionPosture().lastDigest).toEqual(
      expect.any(Number),
    );
    expect(
      execution.statusProjectionPosture().p95BuildMs,
    ).toBeGreaterThanOrEqual(0);
  });

  test("status projection publishes execution-rush chain authority", () => {
    const execution = new VaultFrontExecution() as any;
    const addUpdate = vi.fn();
    execution.game = {
      ticks: () => 20,
      addUpdate,
      playerBySmallID: () => null,
      setVaultSiteControllerIDs: vi.fn(),
    };
    execution.weeklyMutator = "execution_rush";
    execution.mutatorBalance =
      projectVaultFrontMutatorBalance("execution_rush");
    execution.vaultSites = [];
    execution.convoys = [];
    execution.beacons = new Map();
    vi.spyOn(execution, "buildExecutionChainStates").mockReturnValue({});
    vi.spyOn(execution, "buildSurgeStates").mockReturnValue({});
    vi.spyOn(execution, "buildSquadObjectiveStates").mockReturnValue([]);
    vi.spyOn(execution, "buildPressureStates").mockReturnValue({});

    execution.publishStatusUpdate(20);

    expect(addUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        weeklyMutator: "execution_rush",
        executionChainWindowTicks: 3_000,
        executionChainRewardMultiplier: 1.5,
      }),
    );
  });

  test("status projection does not trust a colliding digest without canonical equivalence", () => {
    const execution = new VaultFrontExecution() as any;
    const addUpdate = vi.fn();
    execution.game = {
      ticks: () => 20,
      addUpdate,
      playerBySmallID: () => null,
      setVaultSiteControllerIDs: vi.fn(),
    };
    execution.vaultSites = [];
    execution.convoys = [];
    execution.beacons = new Map();
    execution.lastStatusProjectionDigest = 123;
    execution.lastStatusProjectionSerialized = "different projection";
    vi.spyOn(execution, "buildExecutionChainStates").mockReturnValue({});
    vi.spyOn(execution, "buildSurgeStates").mockReturnValue({});
    vi.spyOn(execution, "buildSquadObjectiveStates").mockReturnValue([]);
    vi.spyOn(execution, "buildPressureStates").mockReturnValue({});

    execution.publishStatusUpdate(20);

    expect(addUpdate).toHaveBeenCalledOnce();
    expect(execution.statusProjectionPosture()).toMatchObject({
      publishes: 1,
      deduplicated: 0,
      buildSampleCount: 1,
    });
  });

  test("status projection cadence bounds non-critical rebuilds", () => {
    const execution = new VaultFrontExecution() as any;
    const publish = vi
      .spyOn(execution, "publishStatusUpdate")
      .mockImplementation((tick: number) => {
        execution.lastStatusProjectionTick = tick;
        execution.statusProjectionDirty = false;
        execution.statusProjectionCritical = false;
      });

    execution.maybePublishStatusUpdate(0);
    execution.statusProjectionDirty = true;
    execution.maybePublishStatusUpdate(1);
    execution.maybePublishStatusUpdate(4);
    expect(publish).toHaveBeenCalledTimes(1);

    execution.maybePublishStatusUpdate(5);
    execution.statusProjectionDirty = true;
    execution.statusProjectionCritical = true;
    execution.maybePublishStatusUpdate(6);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  test("rate limiter allows exactly 5 commands in a 10-tick window", () => {
    const execution = new VaultFrontExecution() as any;
    const handleCommand = vi
      .spyOn(execution, "handleCommand")
      .mockImplementation(() => {});
    const player = {
      smallID: () => 1,
      isPlayer: () => true,
      isAlive: () => true,
    } as any;
    const cmd = (tick: number): VaultFrontCommand => ({
      playerSmallID: 1,
      type: "escort",
      issuedAtTick: tick,
    });
    execution.game = { playerBySmallID: () => player };

    const commands = [cmd(5), cmd(5), cmd(5), cmd(5), cmd(5)];
    execution.game.drainVaultFrontCommands = () => commands;
    execution.handleQueuedCommands(5);

    expect(handleCommand).toHaveBeenCalledTimes(5);
  });

  test("rate limiter rejects the 6th command in the same window", () => {
    const execution = new VaultFrontExecution() as any;
    const handleCommand = vi
      .spyOn(execution, "handleCommand")
      .mockImplementation(() => {});
    const player = {
      smallID: () => 1,
      isPlayer: () => true,
      isAlive: () => true,
    } as any;
    const cmd = (tick: number): VaultFrontCommand => ({
      playerSmallID: 1,
      type: "escort",
      issuedAtTick: tick,
    });
    execution.game = { playerBySmallID: () => player };

    const commands = [cmd(5), cmd(5), cmd(5), cmd(5), cmd(5), cmd(5)];
    execution.game.drainVaultFrontCommands = () => commands;
    execution.handleQueuedCommands(5);

    // Only 5 allowed in a 10-tick window
    expect(handleCommand).toHaveBeenCalledTimes(5);
  });

  test("rate limiter resets at the next window boundary", () => {
    const execution = new VaultFrontExecution() as any;
    const handleCommand = vi
      .spyOn(execution, "handleCommand")
      .mockImplementation(() => {});
    const player = {
      smallID: () => 1,
      isPlayer: () => true,
      isAlive: () => true,
    } as any;
    execution.game = { playerBySmallID: () => player };

    // Fill the window at tick 0
    const firstBatch = Array.from({ length: 5 }, () => ({
      playerSmallID: 1,
      type: "escort" as const,
      issuedAtTick: 0,
    }));
    execution.game.drainVaultFrontCommands = () => firstBatch;
    execution.handleQueuedCommands(0);
    expect(handleCommand).toHaveBeenCalledTimes(5);

    // At tick 10 the window shifts — commands from tick 0 are no longer in window
    handleCommand.mockClear();
    const secondBatch = [
      { playerSmallID: 1, type: "escort" as const, issuedAtTick: 10 },
    ];
    execution.game.drainVaultFrontCommands = () => secondBatch;
    execution.handleQueuedCommands(10);

    expect(handleCommand).toHaveBeenCalledTimes(1);
  });
});
