import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const contractPath = path.join(root, "context", "GAME_LOOP.md");

describe("public-safe game loop contract", () => {
  it("binds every loop stage to shipped source authority", () => {
    const contract = fs.readFileSync(contractPath, "utf8");

    for (const stage of [
      "Input — Capture",
      "Fantasy — Escort or disrupt",
      "Pressure — Coordinate",
      "Climax — Breach",
      "Reward — Decide",
      "Progression — Continue deliberately",
    ]) {
      expect(contract).toContain(stage);
    }

    for (const source of [
      "src/client/FirstExtractionQuest.ts",
      "config/vaultfront-balance.v1.json",
      "src/server/MatchProgression.ts",
    ]) {
      expect(contract).toContain(source);
      expect(fs.existsSync(path.join(root, source))).toBe(true);
    }
  });

  it("keeps Soul fidelity unscored until founder-owned criteria exist", () => {
    const contract = fs.readFileSync(contractPath, "utf8");

    expect(contract).toContain("Soul fidelity: N/A");
    expect(contract).not.toMatch(/Soul fidelity:\s*\d+/u);
    expect(contract).toContain("zero unique human actors");
  });
});
