import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { Stats } from "../src/core/game/Stats";
import { StatsImpl } from "../src/core/game/StatsImpl";
import { replacer } from "../src/core/Util";
import { setup } from "./util/Setup";

let stats: Stats;
let game: Game;
let player1: Player;
let player2: Player;

describe("Stats", () => {
  beforeEach(async () => {
    stats = new StatsImpl();
    game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("boat dude", PlayerType.Human, "client1", "player_1_id"),
      new PlayerInfo("boat dude", PlayerType.Human, "client2", "player_2_id"),
    ]);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("attack", () => {
    stats.attack(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        attacks: [1n],
      },
      client2: {
        attacks: [0n, 1n],
      },
    });
  });

  test("attackCancel", () => {
    stats.attackCancel(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        attacks: [-1n, 0n, 1n],
      },
      client2: {
        attacks: [0n, -1n],
      },
    });
  });

  test("betray", () => {
    stats.betray(player1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        betrayals: 1n,
      },
    });
  });

  test("boatSendTrade", () => {
    stats.boatSendTrade(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: {
          trade: [1n],
        },
      },
    });
  });

  test("boatArriveTrade", () => {
    stats.boatArriveTrade(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trade: [0n, 1n] },
        gold: [0n, 0n, 1n],
      },
      client2: {
        gold: [0n, 0n, 1n],
      },
    });
  });

  test("boatCapturedTrade", () => {
    stats.boatCapturedTrade(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trade: [0n, 0n, 1n] },
        gold: [0n, 0n, 0n, 1n],
      },
    });
  });

  test("boatDestroyTrade", () => {
    stats.boatDestroyTrade(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trade: [0n, 0n, 0n, 1n] },
      },
    });
  });

  test("boatSendTroops", () => {
    stats.boatSendTroops(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: {
          trans: [1n],
        },
      },
    });
  });

  test("boatArriveTroops", () => {
    stats.boatArriveTroops(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trans: [0n, 1n] },
      },
    });
  });

  test("boatDestroyTroops", () => {
    stats.boatDestroyTroops(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trans: [0n, 0n, 0n, 1n] },
      },
    });
  });

  test("bombLaunch", () => {
    stats.bombLaunch(player1, player2, UnitType.AtomBomb);
    expect(stats.stats()).toStrictEqual({
      client1: { bombs: { abomb: [1n] } },
    });
  });

  test("bombLand", () => {
    stats.bombLand(player1, player2, UnitType.HydrogenBomb);
    expect(stats.stats()).toStrictEqual({
      client1: { bombs: { hbomb: [0n, 1n] } },
    });
  });

  test("bombIntercept", () => {
    stats.bombIntercept(player1, UnitType.MIRVWarhead, 1);
    expect(stats.stats()).toStrictEqual({
      client1: { bombs: { mirvw: [0n, 0n, 1n] } },
    });
  });

  test("goldWar", () => {
    stats.goldWar(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        gold: [0n, 1n],
        conquests: [1n],
      },
    });
    stats.goldWar(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        gold: [0n, 2n],
        conquests: [2n],
      },
    });
  });

  test("goldWork", () => {
    stats.goldWork(player1, 1);
    expect(stats.stats()).toStrictEqual({
      client1: { gold: [1n] },
    });
  });

  test("unitBuild", () => {
    stats.unitBuild(player1, UnitType.City);
    expect(stats.stats()).toStrictEqual({
      client1: { units: { city: [1n] } },
    });
  });

  test("unitCapture", () => {
    stats.unitCapture(player1, UnitType.DefensePost);
    expect(stats.stats()).toStrictEqual({
      client1: {
        units: {
          defp: [0n, 0n, 1n],
        },
      },
    });
  });

  test("unitDestroy", () => {
    stats.unitDestroy(player1, UnitType.MissileSilo);
    expect(stats.stats()).toStrictEqual({
      client1: {
        units: {
          silo: [0n, 1n],
        },
      },
    });
  });

  test("unitLose", () => {
    stats.unitLose(player1, UnitType.Port);
    expect(stats.stats()).toStrictEqual({
      client1: {
        units: {
          port: [0n, 0n, 0n, 1n],
        },
      },
    });
  });

  test("playerKilled", () => {
    stats.playerKilled(player1, 10);
    stats.playerKilled(player2, 40);
    expect(stats.stats()).toStrictEqual({
      client1: {
        killedAt: 10n,
      },
      client2: {
        killedAt: 40n,
      },
    });
  });

  test("records the first certified VaultFront loop timestamps only", () => {
    stats.vaultCaptured(player1, 120);
    stats.vaultCaptured(player1, 240);
    stats.vaultConvoyLost(player1, 300);
    stats.vaultConvoyDelivered(player1, 360);
    expect(stats.getPlayerStats(player1)).toMatchObject({
      vaultfront: {
        vaultCaptures: 2n,
        vaultConvoysLost: 1n,
        vaultConvoysDelivered: 1n,
        firstVaultCaptureTick: 120n,
        firstConvoyOutcomeTick: 300n,
      },
    });
  });

  test("certifies the pressure-to-breach victory funnel once", () => {
    stats.vaultPressureAdvanced(player1, 100);
    stats.vaultPressureAdvanced(player1, 110);
    stats.vaultPressureContribution(player1);
    stats.vaultPressureContribution(player1);
    stats.vaultBreachOpened(player1, 200);
    stats.vaultBreachOpened(player1, 210);
    stats.vaultDecisiveDelivery(player1, 300);
    stats.vaultBreachVictory(player1, 300);
    expect(stats.getPlayerStats(player1)).toMatchObject({
      vaultfront: {
        firstVaultPressureTick: 100n,
        vaultPressureContributions: 2n,
        firstBreachOpenTick: 200n,
        decisiveDeliveryTick: 300n,
        vaultBreachVictoryTick: 300n,
      },
    });
  });

  test("records rivalry revenge in certified VaultFront stats", () => {
    stats.vaultRivalryRevenge(player1);
    stats.vaultRivalryRevenge(player1);
    expect(stats.getPlayerStats(player1)).toMatchObject({
      vaultfront: { rivalryRevengeCount: 2n },
    });
  });

  test("stringify", () => {
    stats.unitLose(player1, UnitType.Port);
    expect(JSON.stringify(stats.stats(), replacer)).toBe(
      '{"client1":{"units":{"port":["0","0","0","1"]}}}',
    );
  });
});
