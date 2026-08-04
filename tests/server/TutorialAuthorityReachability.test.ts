import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractExpressRoutes } from "../../scripts/lib/route-inventory.mjs";
import { FIRST_EXTRACTION_ORIENTATION } from "../../src/client/FirstExtractionQuest";

const root = process.cwd();
const serverDir = resolve(root, "src/server");

describe("player tutorial authority reachability", () => {
  it("keeps FirstExtractionQuest as the mounted canonical client authority", () => {
    const tutorial = readFileSync(
      resolve(root, "src/client/VaultFrontTutorial.ts"),
      "utf8",
    );
    const bootstrap = readFileSync(resolve(root, "src/client/Main.ts"), "utf8");
    const sourceMap = readFileSync(
      resolve(root, "docs/VAULTFRONT_SOURCE_MAP.md"),
      "utf8",
    );

    expect(tutorial).toContain('from "./FirstExtractionQuest"');
    expect(bootstrap).toContain(
      'document.createElement("vault-front-tutorial")',
    );
    expect(FIRST_EXTRACTION_ORIENTATION).toHaveLength(2);
    expect(tutorial).toContain(
      "Two-step orientation projected from the canonical First Extraction quest",
    );
    expect(tutorial).not.toMatch(/5-step|five-step/iu);
    expect(sourceMap).toContain("First-run two-step orientation");
    expect(sourceMap).not.toMatch(/5-step|five-step/iu);
    for (const authorityPath of [
      "src/shared/release-gates.json",
      "src/shared/release-gate-catalog.mjs",
      "src/shared/ReleaseGateCatalog.ts",
    ]) {
      expect(sourceMap).toContain(authorityPath);
    }
  });

  it("forbids an unmounted server tutorial authority or tutorial API", () => {
    const routeFiles = readdirSync(serverDir).filter(
      (name) => name === "Worker.ts" || name.endsWith("Router.ts"),
    );
    const routes = routeFiles.flatMap((name) =>
      extractExpressRoutes(
        readFileSync(resolve(serverDir, name), "utf8"),
        name,
      ),
    );
    const policy = JSON.parse(
      readFileSync(
        resolve(root, "config/mutation-route-policies.json"),
        "utf8",
      ),
    ) as { routes: Array<{ path: string }> };
    const sourceMap = readFileSync(
      resolve(root, "docs/VAULTFRONT_SOURCE_MAP.md"),
      "utf8",
    );

    expect(existsSync(resolve(serverDir, "TutorialOrchestrator.ts"))).toBe(
      false,
    );
    expect(
      routes.filter((route) => route.path.startsWith("/api/tutorial")),
    ).toEqual([]);
    expect(
      policy.routes.filter((route) => route.path.startsWith("/api/tutorial")),
    ).toEqual([]);
    expect(sourceMap).not.toContain("src/server/TutorialOrchestrator.ts");
  });
});
