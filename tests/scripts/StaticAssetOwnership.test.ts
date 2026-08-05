// @vitest-environment node

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { retiredPublicAssetWarningGuard } from "../../vite.config";

const root = process.cwd();

describe("Vite static asset ownership", () => {
  it("fails if Vite reports the retired public-directory ownership path", () => {
    const logger = retiredPublicAssetWarningGuard();

    expect(() =>
      logger.warn("Assets in the public directory cannot be imported"),
    ).toThrow("retired-public-asset-ownership-warning");
  });

  it("keeps resources under the explicit copy owner", () => {
    const source = fs.readFileSync(path.join(root, "vite.config.ts"), "utf8");

    expect(source).toContain("publicDir: false");
    expect(source).toMatch(/src: ["']resources\/\*["']/u);
  });
  it("keeps the shipped English asset free of mojibake markers", () => {
    const english = fs.readFileSync(
      path.join(root, "resources", "lang", "en.json"),
      "utf8",
    );

    expect(
      [...english].every(
        (character) => (character.codePointAt(0) ?? 0) <= 0x7f,
      ),
    ).toBe(true);
  });
});
