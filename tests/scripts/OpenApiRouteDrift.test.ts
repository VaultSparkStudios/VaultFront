import { describe, expect, test } from "vitest";
import { checkOpenApiRouteDrift } from "../../scripts/check-openapi-route-drift.mjs";

describe("OpenAPI route drift (S99 audit #181)", () => {
  test("every live route in the six documented families has a matching openapi.yaml entry", () => {
    const result = checkOpenApiRouteDrift(process.cwd());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // Guards against the check silently checking zero routes (a passing
    // drift check with nothing to check would be a false green).
    expect(result.checkedRoutes).toBeGreaterThan(20);
  });
});
