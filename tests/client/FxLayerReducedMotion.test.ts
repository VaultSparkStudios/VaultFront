import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("FxLayer reduced-motion wiring (S99 audit #179)", () => {
  test("nuke explosions and SAM interceptions pass prefersReducedMotion through", () => {
    const source = readFileSync(
      resolve(__dirname, "../../src/client/graphics/layers/FxLayer.ts"),
      "utf8",
    );
    expect(source).toContain("private prefersReducedMotion(): boolean");
    expect(source).toContain(
      'window.matchMedia("(prefers-reduced-motion: reduce)").matches',
    );
    expect(source).toMatch(
      /nukeFxFactory\(\s*this\.animatedSpriteLoader,\s*x,\s*y,\s*radius,\s*this\.game,\s*this\.prefersReducedMotion\(\),?\s*\)/u,
    );
    expect(source).toContain(
      "const reducedMotion = this.prefersReducedMotion();",
    );
  });
});
