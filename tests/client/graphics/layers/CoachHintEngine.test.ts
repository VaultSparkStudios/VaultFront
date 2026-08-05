import { beforeEach, describe, expect, test } from "vitest";
import {
  CoachHintEngine,
  localTacticalHint,
  type HintTrigger,
} from "../../../../src/client/graphics/layers/CoachHintEngine";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

const triggers: HintTrigger[] = [
  "idle",
  "convoy_lost",
  "bounty_placed",
  "last_stand_nearby",
  "chain_broken",
  "convoy_danger",
  "economy_stall",
];

function makeEngine(): any {
  const engine = new CoachHintEngine() as any;
  engine.game = {
    myPlayer: () => ({ smallID: () => 7 }),
    updatesSinceLastTick: () => ({
      [GameUpdateType.VaultFrontStatus]: [
        {
          sites: [
            { controllerID: 7, passiveOwnerID: null },
            { controllerID: null, passiveOwnerID: 7 },
            { controllerID: 2, passiveOwnerID: null },
          ],
          convoys: [],
        },
      ],
    }),
  };
  engine.latestStatus = {
    sites: [
      { controllerID: 7, passiveOwnerID: null },
      { controllerID: null, passiveOwnerID: 7 },
    ],
    convoys: [],
  };
  return engine;
}

describe("CoachHintEngine", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("defines an actionable deterministic policy for every tactical trigger", () => {
    for (const trigger of triggers) {
      const hint = localTacticalHint(trigger, { gold: 90_000, sites: 1 });
      expect(hint.length).toBeGreaterThan(30);
    }
  });

  test("renders a local hint and records the provider call it avoided", () => {
    const engine = makeEngine();
    engine.tickCount = 1199;

    engine.tick();

    expect(engine.visible).toBe(true);
    expect(engine.hint).toContain("Contest the nearest opening");
    expect(localStorage.getItem("vaultfront.kpi.coach.localHints")).toBe("1");
    expect(
      localStorage.getItem("vaultfront.kpi.coach.providerCallsAvoided"),
    ).toBe("1");
  });

  test("ignores the retired browser remote-provider toggle", () => {
    localStorage.setItem("coachRemoteEnhancementEnabled", "true");
    const engine = makeEngine();
    engine.tickCount = 1199;

    engine.tick();

    expect(engine.hint).toContain("Contest the nearest opening");
    expect(localStorage.getItem("vaultfront.kpi.coach.localHints")).toBe("1");
    expect(
      localStorage.getItem("vaultfront.kpi.coach.remoteEnhancements"),
    ).toBe(null);
  });
});
