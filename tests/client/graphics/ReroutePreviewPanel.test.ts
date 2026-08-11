import {
  nextRerouteCommand,
  projectRerouteDecision,
  rerouteLaneLabel,
} from "../../../src/client/graphics/layers/ReroutePreviewPanel";
import type { VaultFrontReroutePreview } from "../../../src/core/game/GameUpdates";

function preview(
  command: VaultFrontReroutePreview["command"],
  overrides: Partial<VaultFrontReroutePreview> = {},
): VaultFrontReroutePreview {
  return {
    command,
    destinationTile: 7,
    etaSeconds: 12,
    routeRisk: 0.25,
    routeDistance: 9,
    rewardMultiplier: 1,
    rewardScale: 1,
    strengthMultiplier: 1,
    phaseMultiplier: 1,
    riskMultiplier: 1,
    goldReward: 2_000,
    troopsReward: 750,
    rewardMath: "fixture",
    deltaGold: 200,
    deltaTroops: -50,
    deltaEtaSeconds: 3,
    deltaRisk: -0.05,
    ...overrides,
  };
}

describe("ReroutePreviewPanel", () => {
  const previews = [
    preview("reroute_city"),
    preview("reroute_port", { etaSeconds: 8 }),
    preview("reroute_safest", { routeRisk: 0.1 }),
  ];

  test("projects the selected lane and complete desktop decision copy", () => {
    const model = projectRerouteDecision(previews, "reroute_port", false);
    expect(model).not.toBeNull();
    expect(model?.heading).toBe("Pre-Action Reroute Preview");
    expect(model?.selected.command).toBe("reroute_port");
    expect(model?.options.map((option) => option.label)).toEqual([
      "City",
      "Port",
      "Safest",
    ]);
    expect(model?.description).toContain("Port lane. ETA 8s (+3s)");
    expect(model?.description).toContain("2,000 gold (+200g)");
    expect(model?.description).toContain("750 troops (-50)");
  });

  test("falls back to the first preview and compacts mobile copy", () => {
    const model = projectRerouteDecision(previews, "reroute_factory", true);
    expect(model?.selected.command).toBe("reroute_city");
    expect(model?.heading).toBe("Reroute Preview");
    expect(model?.applyLabel).toBe("Apply");
    expect(model?.description).not.toContain("troops");
  });

  test("supports wrapped arrow traversal plus Home and End", () => {
    expect(nextRerouteCommand(previews, "reroute_city", "ArrowLeft")).toBe(
      "reroute_safest",
    );
    expect(nextRerouteCommand(previews, "reroute_safest", "ArrowRight")).toBe(
      "reroute_city",
    );
    expect(nextRerouteCommand(previews, "reroute_port", "Home")).toBe(
      "reroute_city",
    );
    expect(nextRerouteCommand(previews, "reroute_port", "End")).toBe(
      "reroute_safest",
    );
    expect(nextRerouteCommand(previews, "reroute_port", "Enter")).toBeNull();
  });

  test("labels every supported command and rejects an empty decision", () => {
    expect(rerouteLaneLabel("reroute_factory")).toBe("Factory");
    expect(rerouteLaneLabel("reroute_silo")).toBe("Silo");
    expect(projectRerouteDecision([], "reroute_safest", false)).toBeNull();
    expect(nextRerouteCommand([], "reroute_safest", "ArrowRight")).toBeNull();
  });
});
