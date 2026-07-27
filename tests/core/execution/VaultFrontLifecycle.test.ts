import { describe, expect, test, vi } from "vitest";
import { VaultFrontExecution } from "../../../src/core/execution/VaultFrontExecution";
import { UnitType } from "../../../src/core/game/Game";

// ── helpers ──────────────────────────────────────────────────────────────────

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

function makePlayer(
  id: number,
  {
    tiles = 250,
    troops = 150_000,
    gold = 600_000,
  }: { tiles?: number; troops?: number; gold?: number } = {},
) {
  let currentGold = BigInt(gold);
  let currentTroops = troops;
  return {
    smallID: () => id,
    id: () => `p${id}`,
    isPlayer: () => true,
    isAlive: () => true,
    displayName: () => `Player${id}`,
    team: () => null,
    isFriendly: () => false,
    numTilesOwned: () => tiles,
    troops: () => currentTroops,
    gold: () => currentGold,
    addGold: (amount: bigint) => {
      currentGold += amount;
    },
    addTroops: (amount: number) => {
      currentTroops += amount;
    },
    removeGold: (amount: bigint) => {
      currentGold -= amount;
    },
    spawnTile: () => 0,
    units: () => [{ type: () => UnitType.City, tile: () => 30 }],
    unitCount: () => 1,
    getGold: () => currentGold,
    getTroops: () => currentTroops,
  } as any;
}

function makeGame(
  players: ReturnType<typeof makePlayer>[],
  ownerFn?: (tile: number) => any,
) {
  const addUpdate = vi.fn();
  const displayMessage = vi.fn();
  const stats = {
    vaultConvoyLaunched: vi.fn(),
    vaultConvoyDelivered: vi.fn(),
    vaultConvoyIntercepted: vi.fn(),
    vaultConvoyLost: vi.fn(),
    vaultRivalryRevenge: vi.fn(),
    vaultConvoyRerouted: vi.fn(),
    vaultConvoyEscortCommand: vi.fn(),
    vaultInteraction: vi.fn(),
    vaultCaptured: vi.fn(),
    vaultPassiveGold: vi.fn(),
    defenseFactoryJamBreaker: vi.fn(),
    comebackSurgeActivated: vi.fn(),
    minute8Behind: vi.fn(),
    cleanExecutionStreak: vi.fn(),
    squadObjectiveCompleted: vi.fn(),
    stats: vi.fn(() => ({})),
  };

  const playerMap = new Map(players.map((p) => [p.smallID(), p]));
  const defaultOwner = players[0];

  return {
    addUpdate,
    displayMessage,
    stats: () => stats,
    players: () => players,
    allPlayers: () => players,
    playerBySmallID: (id: number) => playerMap.get(id) ?? defaultOwner,
    owner: ownerFn ?? (() => defaultOwner),
    manhattanDist: (a: number, b: number) => Math.abs(a - b),
    ticks: () => 1000,
    getWinner: () => null,
    setWinner: vi.fn(),
    inSpawnPhase: () => false,
    drainVaultFrontCommands: () => [],
    isValidCoord: () => false,
    // Tile coordinate helpers — use tile value directly as 1D coordinate
    x: (tile: number) => tile % 100,
    y: (tile: number) => Math.floor(tile / 100),
    ref: (x: number, y: number) => y * 100 + x,
    width: () => 100,
    height: () => 100,
    config: () => ({
      numSpawnPhaseTurns: () => 0,
      vaultSitesEnabled: () => true,
      intelOperationsEnabled: () => false,
      vaultConvoyRewardTuning: () => defaultRewardTuning(),
      vaultWeeklyMutator: () => "none" as const,
    }),
    _addUpdate: addUpdate,
    _displayMessage: displayMessage,
    _stats: stats,
  } as any;
}

function baseExecution(
  players: ReturnType<typeof makePlayer>[],
  ownerFn?: (tile: number) => any,
) {
  const game = makeGame(players, ownerFn);
  const execution = new VaultFrontExecution() as any;
  execution.game = game;
  execution.weeklyMutator = "none";

  const idMap = new Map(players.map((p) => [p.smallID(), p]));
  for (const [id] of idMap) {
    execution.preferredConvoyDestination =
      execution.preferredConvoyDestination ?? new Map();
    execution.preferredConvoyDestination.set(id, UnitType.City);
    execution.escortUntilTick = execution.escortUntilTick ?? new Map();
    execution.escortUntilTick.set(id, 0);
    execution.jamBreakerCooldownUntil =
      execution.jamBreakerCooldownUntil ?? new Map();
    execution.jamBreakerCooldownUntil.set(id, 0);
    execution.behindSinceTick = execution.behindSinceTick ?? new Map();
    execution.behindSinceTick.set(id, -1);
    execution.surgeUntilTick = execution.surgeUntilTick ?? new Map();
    execution.surgeUntilTick.set(id, 0);
    execution.executionChainStep = execution.executionChainStep ?? new Map();
    execution.executionChainStep.set(id, 0);
    execution.executionChainExpiresAtTick =
      execution.executionChainExpiresAtTick ?? new Map();
    execution.executionChainExpiresAtTick.set(id, 0);
    execution.executionStreakNextConvoyMultiplier =
      execution.executionStreakNextConvoyMultiplier ?? new Map();
    execution.executionStreakNextConvoyMultiplier.set(id, 1);
    execution.beacons = execution.beacons ?? new Map();
    execution.beacons.set(id, { charge: 50, cooldownUntil: 0, maskedUntil: 0 });
  }
  execution.squadObjectiveWindows = [];
  execution.convoys = [];

  vi.spyOn(execution, "routeRiskScore").mockReturnValue(0.1);
  vi.spyOn(execution, "buildConvoyReroutePreviews").mockReturnValue([]);
  vi.spyOn(execution, "emitActivity").mockImplementation(() => {});

  return { execution, game };
}

// ── lifecycle tests ───────────────────────────────────────────────────────────

describe("VaultFront lifecycle integration", () => {
  test("capture → convoy launches → convoy delivers gold and troops", () => {
    const player = makePlayer(1);
    const { execution, game } = baseExecution([player]);

    const goldBefore = player.getGold();
    const troopsBefore = player.getTroops();

    // Step 1: Capture completes → convoy launches
    const site = {
      id: 1,
      tile: 5,
      controllerID: null,
      controlTicks: 0,
      cooldownTicks: 0,
      passiveOwnerID: null,
      nextPassiveGoldTick: 0,
      reducedRewardNextCapture: false,
    };
    execution.startConvoy(player, site, 1000, 1);

    expect(execution.convoys).toHaveLength(1);
    const convoy = execution.convoys[0];
    expect(convoy.ownerID).toBe(1);
    expect(convoy.goldReward > 0n).toBe(true);
    expect(convoy.troopsReward > 0).toBe(true);
    expect(game._stats.vaultConvoyLaunched).toHaveBeenCalledTimes(1);

    // Step 2: Advance to last tick before delivery
    convoy.ticksRemaining = 1;

    // tile ownership stays with player → no interception
    execution.tickConvoys(1001);

    // Gold and troops should have been credited
    expect(player.getGold()).toBeGreaterThan(goldBefore);
    expect(player.getTroops()).toBeGreaterThan(troopsBefore);
    expect(execution.convoys).toHaveLength(0);
    expect(game._stats.vaultConvoyDelivered).toHaveBeenCalledTimes(1);
  });

  test("passive income pays out after interval elapses", () => {
    const player = makePlayer(1);
    // owner always returns this player so syncPassiveOwner keeps passiveOwnerID alive
    const { execution, game } = baseExecution([player], () => player);

    const site = {
      id: 1,
      tile: 5,
      controllerID: null,
      controlTicks: 0,
      cooldownTicks: 0,
      passiveOwnerID: player.smallID(),
      nextPassiveGoldTick: 500,
      reducedRewardNextCapture: false,
      uncontrolledSinceTick: 0,
      vacantAlertFiredAtTick: -1,
      accumulatedPassiveGold: 0n,
    };
    execution.vaultSites = [site];

    const goldBefore = player.getGold();

    execution.syncPassiveOwner(site);
    execution.tickVaultPassiveIncome(site, 600);

    expect(player.getGold()).toBeGreaterThan(goldBefore);
    expect(game._stats.vaultPassiveGold).toHaveBeenCalledTimes(1);
    expect(site.nextPassiveGoldTick).toBeGreaterThan(600);
  });

  test("escorted convoy survives first interception and shield is consumed", () => {
    const owner = makePlayer(1);
    const attacker = makePlayer(2);
    // owner's tile is controlled by attacker → interception fires
    const { execution, game } = baseExecution(
      [owner, attacker],
      () => attacker,
    );
    // escort is active for owner
    execution.escortUntilTick.set(owner.smallID(), 2000);

    const convoy = {
      id: 1,
      ownerID: owner.smallID(),
      sourceTile: 5,
      destinationTile: 30,
      ticksRemaining: 1,
      totalTicks: 60,
      goldReward: 200_000n,
      troopsReward: 1000,
      rewardMultiplier: 1.0,
      rewardScale: 1.0,
      strengthMultiplier: 1.0,
      phaseMultiplier: 1.0,
      riskMultiplier: 1.0,
      routeRisk: 0.1,
      routeDistance: 25,
      rewardMath: "",
      escortShield: 1,
      reroutes: 0,
    };
    execution.convoys = [convoy];

    // First tickConvoys — escort absorbs intercept, convoy survives
    execution.tickConvoys(1000);

    expect(execution.convoys).toHaveLength(1);
    expect(execution.convoys[0].escortShield).toBe(0);

    // Second tickConvoys — no shield, convoy is lost
    execution.convoys[0].ticksRemaining = 1;
    execution.tickConvoys(1001);

    expect(execution.convoys).toHaveLength(0);
    expect(game._stats.vaultConvoyIntercepted).toHaveBeenCalledTimes(1);
  });

  test("capture → cooldown → reopen: second capture fires correctly", () => {
    const player = makePlayer(1);
    const { execution, game } = baseExecution([player], () => player);

    const site = {
      id: 1,
      tile: 5,
      controllerID: player.smallID(),
      controlTicks: 90, // at the capture threshold
      cooldownTicks: 0,
      passiveOwnerID: null,
      nextPassiveGoldTick: 0,
      reducedRewardNextCapture: false,
    };
    execution.vaultSites = [site];

    // Tick 1: capture completes
    execution.tickVaultSites(1000);
    expect(game._stats.vaultCaptured).toHaveBeenCalledTimes(1);
    expect(site.cooldownTicks).toBeGreaterThan(0);
    expect(site.passiveOwnerID).toBe(player.smallID());
    expect(execution.convoys).toHaveLength(1);

    // Drain cooldown
    site.cooldownTicks = 1;
    execution.tickVaultSites(1001);
    expect(site.cooldownTicks).toBe(0);

    // Tick 2: player holds site again → second capture
    site.controllerID = player.smallID();
    site.controlTicks = 90;
    execution.tickVaultSites(1002);

    expect(game._stats.vaultCaptured).toHaveBeenCalledTimes(2);
    expect(execution.convoys).toHaveLength(2);
  });

  test("three deliveries open a breach window and the next delivery wins", () => {
    const player = makePlayer(1);
    const { execution, game } = baseExecution([player]);

    execution.advanceVaultPressure(player, 1000, 5);
    execution.advanceVaultPressure(player, 1010, 5);
    execution.advanceVaultPressure(player, 1020, 5);

    expect(execution.vaultPressureStates.get(1)).toMatchObject({
      pressure: 3,
      breachWindowUntilTick: 1920,
      victorySecured: false,
    });
    expect(game.setWinner).not.toHaveBeenCalled();

    execution.advanceVaultPressure(player, 1030, 5);

    expect(game.setWinner).toHaveBeenCalledTimes(1);
    expect(game.setWinner).toHaveBeenCalledWith(player, {});
    expect(execution.isActive()).toBe(false);
  });

  test("expired breach window falls back one pressure step", () => {
    const player = makePlayer(1);
    const { execution } = baseExecution([player]);
    execution.vaultPressureStates.set(1, {
      pressure: 3,
      breachWindowUntilTick: 1100,
      victorySecured: false,
    });

    execution.sweepExpiredBreachWindows(1101);

    expect(execution.vaultPressureStates.get(1)).toMatchObject({
      pressure: 2,
      breachWindowUntilTick: 0,
      victorySecured: false,
    });
  });
});
