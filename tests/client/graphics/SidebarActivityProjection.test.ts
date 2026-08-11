import {
  projectObjectiveRail,
  projectSidebarActivityFeed,
  pruneSidebarFeed,
  sidebarFeedActivityLabel,
  sidebarTimelineCategory,
} from "../../../src/client/graphics/layers/SidebarActivityProjection";
import type { VaultFrontActivityUpdate } from "../../../src/core/game/GameUpdates";

function update(
  activity: VaultFrontActivityUpdate["activity"],
  sourcePlayerID: number | null,
  label = activity,
): VaultFrontActivityUpdate {
  return {
    type: 28,
    activity,
    tile: 9,
    sourcePlayerID,
    targetPlayerID: null,
    label,
    durationTicks: 0,
  } as VaultFrontActivityUpdate;
}

const relation = {
  myPlayerId: 1,
  isAlly: (id: number) => id === 2,
};

describe("SidebarActivityProjection", () => {
  test("keeps self over ally over global and preserves equal-priority order", () => {
    const result = projectSidebarActivityFeed({
      current: [],
      updates: [
        update("convoy_delivered", 8, "global one"),
        update("vault_captured", 2, "ally"),
        update("jam_breaker", 1, "self"),
        update("beacon_pulse", 9, "global two"),
        update("convoy_intercepted", 10, "global three"),
      ],
      now: 100,
      relation,
    });
    expect(result.map((entry) => entry.label)).toEqual([
      "self",
      "ally",
      "global one",
      "global two",
    ]);
  });

  test("merges matching passive income at the inclusive window boundary", () => {
    const current = projectSidebarActivityFeed({
      current: [],
      updates: [update("vault_passive_income", 1, "Passive +100g")],
      now: 10,
      relation,
    });
    const merged = projectSidebarActivityFeed({
      current,
      updates: [update("vault_passive_income", 1, "Passive +125g")],
      now: 250,
      relation,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      count: 2,
      label: "Passive income +125g x2",
      tick: 250,
    });
  });

  test("prunes only after the inclusive TTL and filters unsupported replay events", () => {
    const current = projectSidebarActivityFeed({
      current: [],
      updates: [update("vault_captured", 1)],
      now: 20,
      relation,
    });
    expect(pruneSidebarFeed(current, 280)).toHaveLength(1);
    expect(pruneSidebarFeed(current, 281)).toEqual([]);
    expect(
      projectSidebarActivityFeed({
        current: [],
        updates: [update("comeback_surge", 1)],
        now: 20,
        relation,
      }),
    ).toEqual([]);
  });

  test("projects labels/categories and a stable bounded objective rail", () => {
    expect(sidebarFeedActivityLabel("convoy_intercepted")).toBe("Intercept");
    expect(sidebarTimelineCategory("beacon_pulse")).toBe("pulses");
    expect(
      projectObjectiveRail([
        { key: "pulse", tile: 1, text: "Pulse", projectionPriority: 100 },
        {
          key: "convoy-late",
          tile: 2,
          text: "Late",
          projectionPriority: 200,
          etaTicks: 20,
        },
        {
          key: "site",
          tile: 3,
          text: "Site",
          projectionPriority: 300,
        },
        {
          key: "convoy-early",
          tile: 4,
          text: "Early",
          projectionPriority: 200,
          etaTicks: 10,
        },
      ]).map((item) => item.key),
    ).toEqual(["site", "convoy-early", "convoy-late"]);
  });
});
