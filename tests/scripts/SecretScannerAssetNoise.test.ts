import { describe, expect, it } from "vitest";
import {
  isAssetEntropyNoise,
  scanContent,
  summarizeFindings,
} from "../../scripts/scan-secrets.mjs";

// # scan-secrets: allow — synthetic adversarial entropy fixture
const opaque = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AB";

describe("asset-aware secret signal", () => {
  it("suppresses only low-confidence entropy inside proven asset payloads", () => {
    expect(
      scanContent(
        "resources/flags/example.svg",
        `<image href="data:image/png;base64,${opaque}" />`,
      ),
    ).toEqual([]);
    expect(
      scanContent("resources/cosmetics/cosmetics.json", `  "${opaque}": {}`),
    ).toEqual([]);
    expect(scanContent("static/assets/generated.js", opaque)).toEqual([]);
  });

  it("keeps the same opaque token reviewable in ordinary source", () => {
    const findings = scanContent(
      "src/example.ts",
      `const value = "${opaque}";`,
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ confidence: "low", type: "cf-maybe" }),
      ]),
    );
  });

  it("never suppresses semantic credentials even inside generated or image files", () => {
    // # scan-secrets: allow — synthetic adversarial credential fixtures
    const github = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij123456";
    // # scan-secrets: allow — synthetic adversarial credential fixture
    const stripe = ["sk", "live", "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"].join("_");
    const findings = [
      ...scanContent("static/assets/generated.js", github),
      ...scanContent(
        "resources/flags/example.svg",
        `<image href="data:image/png;base64,${opaque}" data-key="${stripe}" />`,
      ),
    ];

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ confidence: "high", type: "github" }),
        expect.objectContaining({ confidence: "high", type: "stripe" }),
      ]),
    );
    expect(summarizeFindings(findings)).toMatchObject({ high: 2, medium: 0 });
  });

  it("does not classify arbitrary low-confidence patterns as asset noise", () => {
    expect(
      isAssetEntropyNoise("src/example.ts", opaque, {
        confidence: "low",
        needsEntropy: true,
      }),
    ).toBe(false);
  });
});
