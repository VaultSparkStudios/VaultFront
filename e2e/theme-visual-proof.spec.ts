import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error The proof utility is a runtime ESM module exercised by Vitest.
import { computeThemeProofSourceEvidence } from "../scripts/lib/theme-proof.mjs";

const themes = ["vaultfront", "light", "competitive"] as const;
const capturedSource = computeThemeProofSourceEvidence(process.cwd());

// This one spec intentionally captures six full-page visual artifacts in
// addition to navigation and contrast assertions. Keep its evidence workload
// intact while giving browser screenshot encoding a bounded, explicit budget.
test.setTimeout(60_000);

function luminance(hex: string): number {
  const value = hex.trim().replace("#", "");
  const rgb = [0, 2, 4].map(
    (offset) => parseInt(value.slice(offset, offset + 2), 16) / 255,
  );
  const linear = rgb.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

test("three themes retain readable page, panel, and settings surfaces", async ({
  page,
}, testInfo) => {
  const artifactDir = path.resolve("output", "playwright");
  mkdirSync(artifactDir, { recursive: true });
  const results: Array<Record<string, unknown>> = [];
  const renderedBackgrounds: string[] = [];
  const renderedGlass: string[] = [];

  for (const theme of themes) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate((selected) => {
      localStorage.setItem("vf-theme", selected);
      localStorage.setItem("settings.brandTheme", selected);
      // Visual evidence must show the requested page, not the first-run
      // tutorial overlay that would make every theme look identical.
      localStorage.setItem("vf-tutorial-seen", "2");
    }, theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("play-page", { timeout: 10_000 });
    await expect(page.locator(".vf-hero-card")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-vaultfront-theme",
      theme,
    );

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          "--vf-bg",
          "--vf-bg-deep",
          "--vf-surface",
          "--vf-text",
          "--vf-text-muted",
        ].map((name) => [name, style.getPropertyValue(name).trim()]),
      );
    });
    const ratios = {
      textOnBackground: contrast(tokens["--vf-text"], tokens["--vf-bg"]),
      textOnSurface: contrast(tokens["--vf-text"], tokens["--vf-surface"]),
      mutedOnBackground: contrast(tokens["--vf-text-muted"], tokens["--vf-bg"]),
    };
    expect(ratios.textOnBackground).toBeGreaterThanOrEqual(4.5);
    expect(ratios.textOnSurface).toBeGreaterThanOrEqual(4.5);
    expect(ratios.mutedOnBackground).toBeGreaterThanOrEqual(4.5);

    const renderedColors = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const glass = getComputedStyle(
        document.querySelector(".vf-glass-surface") as HTMLElement,
      );
      return {
        bodyBackground: body.backgroundImage,
        glassBackground: glass.backgroundImage,
        glassText: glass.color,
      };
    });
    renderedBackgrounds.push(renderedColors.bodyBackground);
    renderedGlass.push(renderedColors.glassBackground);

    await page.screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-play.png`,
      ),
      fullPage: true,
    });

    if (testInfo.project.name === "mobile-chrome") {
      await page.locator("#hamburger-btn").click();
      await page.locator('mobile-nav-bar [data-page="page-settings"]').click();
      expect(
        await page
          .locator("#sidebar-menu")
          .evaluate((element) => element.classList.contains("open")),
      ).toBe(false);
      await expect(page.locator("#sidebar-menu")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      await expect(page.locator("#sidebar-menu")).not.toHaveAttribute(
        "aria-modal",
        "true",
      );
      await page.waitForTimeout(350);
    } else {
      await page.locator('desktop-nav-bar [data-page="page-settings"]').click();
    }
    await expect(page.locator("#page-settings")).toBeVisible();
    await page.screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-settings.png`,
      ),
      fullPage: true,
    });
    results.push({
      theme,
      tokens,
      ratios,
      renderedColors,
      surfaces: ["play", "settings"],
    });
  }

  expect(new Set(renderedBackgrounds).size).toBe(themes.length);
  expect(new Set(renderedGlass).size).toBe(themes.length);

  writeFileSync(
    path.join(artifactDir, `theme-proof-${testInfo.project.name}.json`),
    JSON.stringify(
      {
        project: testInfo.project.name,
        localOnly: true,
        capturedAt: new Date().toISOString(),
        source: capturedSource,
        results,
      },
      null,
      2,
    ),
  );
});
