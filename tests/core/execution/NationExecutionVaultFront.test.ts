import { NationExecution } from "../../../src/core/execution/NationExecution";
import { UnitType } from "../../../src/core/game/Game";

describe("NationExecution VaultFront command tuning", () => {
  test("high pressure with defensive structures prefers jam breaker and short retry window", () => {
    const execution = new NationExecution(
      "test-game" as any,
      {
        playerInfo: { id: "nation-1" },
      } as any,
    ) as any;
    const queueVaultFrontCommand = vi.fn();

    execution.player = {
      isAlive: () => true,
      smallID: () => 7,
      unitsOwned: (type: UnitType) =>
        type === UnitType.DefensePost || type === UnitType.SAMLauncher ? 1 : 0,
      // Gold is above the shared balance authority cost.
      gold: () => BigInt(500_000),
      tiles: () => ({ size: 100 }),
    };
    execution.mg = {
      config: () => ({
        nationGoldTroopEmphasis: () => 70,
      }),
      queueVaultFrontCommand,
      // players() returns empty array → avgTiles defaults → isBehind = false
      players: () => [],
    };
    execution.random = {
      chance: vi.fn(() => true),
      nextInt: vi.fn((min: number) => min),
    };
    execution.nextVaultFrontCommandTick = 0;
    vi.spyOn(execution, "hostileNeighborPressure").mockReturnValue(0.62);

    execution.maybeIssueVaultFrontCommand(100);

    expect(queueVaultFrontCommand).toHaveBeenCalledWith({
      playerSmallID: 7,
      type: "jam_breaker",
      issuedAtTick: 100,
    });
    // Timing: ticks(100) + nextInt(60, 100) where mock returns min(60) = 160
    expect(execution.nextVaultFrontCommandTick).toBe(160);
  });

  test("low pressure economy bias rotates into economic reroutes", () => {
    const execution = new NationExecution(
      "test-game" as any,
      {
        playerInfo: { id: "nation-2" },
      } as any,
    ) as any;
    const queueVaultFrontCommand = vi.fn();

    execution.player = {
      isAlive: () => true,
      smallID: () => 3,
      unitsOwned: () => 0,
      gold: () => BigInt(0),
      tiles: () => ({ size: 100 }),
    };
    execution.mg = {
      config: () => ({
        nationGoldTroopEmphasis: () => 80,
      }),
      queueVaultFrontCommand,
      players: () => [],
    };
    execution.random = {
      chance: vi.fn(() => true),
      nextInt: vi.fn((min: number) => min),
    };
    execution.nextVaultFrontCommandTick = 0;
    execution.vaultFrontRoutePreferenceIndex = 0;
    vi.spyOn(execution, "hostileNeighborPressure").mockReturnValue(0.12);

    execution.maybeIssueVaultFrontCommand(200);

    expect(queueVaultFrontCommand).toHaveBeenCalledWith({
      playerSmallID: 3,
      type: "reroute_city",
      issuedAtTick: 200,
    });
    // Timing: ticks(200) + nextInt(75, 130) where mock returns min(75) = 275
    expect(execution.nextVaultFrontCommandTick).toBe(275);
  });
});
