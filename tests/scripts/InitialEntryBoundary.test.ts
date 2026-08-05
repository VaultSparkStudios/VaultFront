import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("initial entry boundary", () => {
  test("keeps secondary lobby and match-first-contact surfaces lazy", () => {
    const main = readFileSync(resolve("src/client/Main.ts"), "utf8");
    for (const module of [
      "./VaultFrontTutorial",
      "./components/PlayPage",
      "./LeaderboardModal",
    ]) {
      expect(main).toContain(`import("${module}")`);
      expect(main).not.toContain(`import "${module}"`);
    }
  });

  test("dispatches first contact only after authoritative status assignment", () => {
    const panel = readFileSync(
      resolve("src/client/graphics/layers/ControlPanel.ts"),
      "utf8",
    );
    const assigned = panel.indexOf(
      "this.latestVaultStatus = statusUpdates[statusUpdates.length - 1]",
    );
    const announced = panel.indexOf(
      "window.dispatchEvent(new Event(VAULTFRONT_MATCH_READY_EVENT))",
    );
    expect(assigned).toBeGreaterThan(0);
    expect(announced).toBeGreaterThan(assigned);
    expect(panel.slice(assigned, announced)).toContain(
      "!this.firstContactAnnounced",
    );
  });
});
