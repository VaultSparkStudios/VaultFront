import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectRuntimeFeatureReachability } from "../../scripts/check-runtime-feature-reachability.mjs";

const root = process.cwd();
const catalog = JSON.parse(
  readFileSync(
    resolve(root, "config/runtime-feature-reachability.json"),
    "utf8",
  ),
);
const readSource = (relative: string) =>
  readFileSync(resolve(root, relative), "utf8");

describe("runtime feature reachability", () => {
  it("binds every admitted feature to server, transport, and product consumer", () => {
    expect(inspectRuntimeFeatureReachability({ root })).toMatchObject({
      ok: true,
      featureCount: 8,
      retiredRouteCount: 14,
      errors: [],
    });
  });

  it("fails when a product consumer marker disappears", () => {
    const mutated = structuredClone(catalog);
    mutated.features[0].consumers[0].marker = "missing-consumer-call";
    const result = inspectRuntimeFeatureReachability({
      root,
      catalog: mutated,
      readSource,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "prematch-oracle: consumer marker must occur once in src/client/GameStartingModal.ts; found 0",
    );
  });

  it("fails closed if a retired route resurfaces", () => {
    const result = inspectRuntimeFeatureReachability({
      root,
      catalog,
      readSource: (relative: string) =>
        relative === "src/client/Main.ts"
          ? `${readSource(relative)}\n/api/vaultfront/match-coach`
          : readSource(relative),
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "retired route /api/vaultfront/match-coach resurfaced in src/client/Main.ts",
    );
  });
});
