import { render } from "lit";
import { describe, expect, test } from "vitest";
import { GameRightSidebar } from "../../../../src/client/graphics/layers/GameRightSidebar";

describe("Daily Mastery Doctrine vault", () => {
  test("shows aspirational non-power sinks with owned and active truth", () => {
    const sidebar = new GameRightSidebar() as any;
    sidebar.hudScale = 1;
    sidebar.masterySelectionPending = null;
    sidebar.masterySelectionNotice = "";
    sidebar.dailyChallenge = {
      challengeId: "victory-1",
      description: "Win a certified match",
      progress: 1,
      target: 1,
      rewardMastery: 75,
      completed: true,
      masteryBalance: 25,
      dateUtc: "2026-08-04",
      evidence: "certified-match-result",
      durability: "postgres",
      doctrines: {
        catalog: [
          {
            id: "route-reader",
            name: "Route Reader",
            costMastery: 50,
            role: "Convoy tactician",
            brief: "Escort timing",
          },
          {
            id: "breach-architect",
            name: "Breach Architect",
            costMastery: 100,
            role: "Pressure shot-caller",
            brief: "Pressure tempo",
          },
        ],
        ownedIds: ["route-reader"],
        activeId: "route-reader",
        effectPolicy: "coaching-and-identity-only",
      },
    };
    const container = document.createElement("div");
    render(sidebar.renderDailyChallenge(), container);
    const copy = container.textContent?.replace(/\s+/gu, " ");
    expect(copy).toContain("Doctrine Vault");
    expect(copy).toContain("Coaching identity only · never combat power");
    expect(copy).toContain("Route Reader Active");
    expect(copy).toContain("Breach Architect 100 M");
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });
});
