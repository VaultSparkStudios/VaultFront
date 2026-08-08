import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeAllianceClipPath } from "../src/client/graphics/PlayerIcons";

describe("NameLayer player-name rendering (S99 audit #173)", () => {
  test("never assigns untrusted player names via innerHTML", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/client/graphics/layers/NameLayer.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /\.innerHTML\s*=\s*(player|render\.player)\.name\(\)/u,
    );
    expect(source).toContain("nameSpan.textContent = player.name();");
    expect(source).toContain("span.textContent = render.player.name();");
  });
});

describe("PlayerIcons", () => {
  describe("computeAllianceClipPath", () => {
    test("returns full visibility (20% top cut) when alliance time is at 100%", () => {
      const result = computeAllianceClipPath(1.0);
      // topCut = 20 + (1 - 1.0) * 80 * 0.78 = 20 + 0 = 20.00
      expect(result).toBe("inset(20.00% -2px 0 -2px)");
    });

    test("returns maximum cut (82.40% top cut) when alliance time is at 0%", () => {
      const result = computeAllianceClipPath(0.0);
      // topCut = 20 + (1 - 0.0) * 80 * 0.78 = 20 + 62.4 = 82.40
      expect(result).toBe("inset(82.40% -2px 0 -2px)");
    });

    test("returns 51.20% top cut when alliance time is at 50%", () => {
      const result = computeAllianceClipPath(0.5);
      // topCut = 20 + (1 - 0.5) * 80 * 0.78 = 20 + 31.2 = 51.20
      expect(result).toBe("inset(51.20% -2px 0 -2px)");
    });

    test("returns 27.80% top cut when alliance time is at 87.5%", () => {
      const result = computeAllianceClipPath(0.875);
      // topCut = 20 + (1 - 0.875) * 80 * 0.78 = 20 + 7.8 = 27.80
      expect(result).toBe("inset(27.80% -2px 0 -2px)");
    });

    test("returns 74.60% top cut when alliance time is at 12.5%", () => {
      const result = computeAllianceClipPath(0.125);
      // topCut = 20 + (1 - 0.125) * 80 * 0.78 = 20 + 54.6 = 74.60
      expect(result).toBe("inset(74.60% -2px 0 -2px)");
    });

    test("includes -2px horizontal overscan to prevent subpixel gaps", () => {
      const result = computeAllianceClipPath(0.5);
      expect(result).toContain("-2px");
      expect(result.match(/-2px/g)).toHaveLength(2); // Should appear twice (left and right)
    });
  });
});
