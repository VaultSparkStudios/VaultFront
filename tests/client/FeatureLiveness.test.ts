import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  featureLivenessGraph,
  validateFeatureLivenessGraph,
} from "../../src/client/FeatureLiveness";

describe("Feature Liveness Graph", () => {
  it("gives every shipped meta feature a complete route-to-journey contract", () => {
    expect(validateFeatureLivenessGraph()).toEqual([]);
    expect(featureLivenessGraph.map((node) => node.id)).toEqual([
      "achievements",
      "season-pass",
      "fortune",
      "clans",
      "tournaments",
      "achievement-toast",
      "experiments",
    ]);
  });

  it("keeps every declared mount in the executable page composition", () => {
    const commandCenter = readFileSync(
      resolve(process.cwd(), "src/client/CommandCenter.ts"),
      "utf8",
    );
    const index = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    for (const node of featureLivenessGraph) {
      const source = node.route === "global" ? index : commandCenter;
      expect(source, node.id).toContain(`<${node.customElement}`);
    }
  });

  it("keeps Command Center composition and navigation reachable on both form factors", () => {
    const index = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const navigation = readFileSync(
      resolve(process.cwd(), "src/client/Navigation.ts"),
      "utf8",
    );
    const desktop = readFileSync(
      resolve(process.cwd(), "src/client/components/DesktopNavBar.ts"),
      "utf8",
    );
    const mobile = readFileSync(
      resolve(process.cwd(), "src/client/components/MobileNavBar.ts"),
      "utf8",
    );

    expect(index).toContain('id="page-command-center"');
    expect(navigation).toContain('await import("./CommandCenter")');
    expect(navigation).toContain('pageId === "page-command-center"');
    expect(desktop).toContain('data-page="page-command-center"');
    expect(mobile).toContain('data-page="page-command-center"');
  });

  it("names the live API contracts used by the mounted clients", () => {
    const api = readFileSync(
      resolve(process.cwd(), "src/client/Api.ts"),
      "utf8",
    );
    const compactApi = api.replace(/\s+/g, "");
    const expected = new Map([
      ["achievements", ["GET /api/vaultfront/achievements/:persistentId"]],
      [
        "season-pass",
        [
          "GET /api/vaultfront/season-progress/:persistentId",
          "POST /api/vaultfront/season-progress/claim",
        ],
      ],
      [
        "fortune",
        [
          "GET /api/vaultfront/fortune-collection/:persistentId",
          "POST /api/vaultfront/fortune-collection/equip",
        ],
      ],
    ]);

    for (const [id, contracts] of expected) {
      expect(featureLivenessGraph.find((node) => node.id === id)?.apis).toEqual(
        contracts,
      );
    }
    expect(compactApi).toContain("/api/vaultfront/achievements/");
    expect(compactApi).toContain("/api/vaultfront/season-progress/");
    expect(compactApi).toContain("/api/vaultfront/season-progress/claim");
    expect(compactApi).toContain("/api/vaultfront/fortune-collection/");
    expect(compactApi).toContain("/api/vaultfront/fortune-collection/equip");
  });

  it("rejects a shipped progression surface omitted from the graph", () => {
    expect(
      validateFeatureLivenessGraph(
        featureLivenessGraph.filter((node) => node.id !== "fortune"),
      ),
    ).toContain("shipped feature missing from graph: fortune");
  });
});
