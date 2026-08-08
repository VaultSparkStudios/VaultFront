import { expect, test } from "@playwright/test";
import { VAULTFRONT_MATCH_READY_EVENT } from "../src/client/FirstExtractionQuest";

// A real match needs terrain load, LocalServer turn processing, and the first
// server-authoritative tick before HUD state exists to assert on.
test.setTimeout(90_000);

test.describe("Live match", () => {
  test("boots a real single-player match and reaches match-ready", async ({
    page,
  }) => {
    await page.addInitScript((eventName) => {
      (window as unknown as { __vfMatchReady: boolean }).__vfMatchReady = false;
      window.addEventListener(
        eventName,
        () => {
          (window as unknown as { __vfMatchReady: boolean }).__vfMatchReady =
            true;
        },
        { once: true },
      );
    }, VAULTFRONT_MATCH_READY_EVENT);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("play-page", { timeout: 10_000 });

    const soloButton = page.getByRole("button", { name: /solo/i }).first();
    await soloButton.click();

    const modal = page.locator("single-player-modal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Compact map + fewer bots keeps terrain load and spawn simulation fast
    // so this spec proves the real pipeline without paying World-map cost.
    await modal.getByRole("button", { name: "Compact Map" }).click();

    const startButton = modal.getByRole("button", { name: /start/i });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page.locator("body")).toHaveClass(/in-game/, {
      timeout: 30_000,
    });

    await page.waitForFunction(
      () =>
        (window as unknown as { __vfMatchReady?: boolean }).__vfMatchReady ===
        true,
      undefined,
      { timeout: 60_000 },
    );

    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator("control-panel #resource-focus")).toBeVisible({
      timeout: 5_000,
    });
  });
});
