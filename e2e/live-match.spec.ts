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

    // Use a small match and auto-spawn the human player. Without Random Spawn,
    // the game correctly waits for manual map placement and cannot emit the
    // player-authoritative VaultFront status used as the readiness boundary.
    await modal.getByRole("tab", { name: /all/i }).click();
    await modal.getByRole("button", { name: /bosphorus straits/i }).click();
    await modal.getByRole("button", { name: "Compact Map" }).click();
    await modal.getByRole("button", { name: "Random Spawn" }).click();

    const botSlider = modal.locator(
      'fluent-slider[labelkey="single_modal.bots"] input[type="range"]',
    );
    const nationSlider = modal.locator(
      'fluent-slider[labelkey="single_modal.nations"] input[type="range"]',
    );
    await botSlider.fill("1");
    await nationSlider.fill("0");
    await expect(botSlider).toHaveValue("1");
    await expect(nationSlider).toHaveValue("0");

    const startButton = modal.getByRole("button", { name: /start/i });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page.locator("body")).toHaveClass(/in-game/, {
      timeout: 30_000,
    });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const panel = document.querySelector(
              "control-panel",
            ) as unknown as { latestVaultStatus?: unknown } | null;
            return {
              event:
                (window as unknown as { __vfMatchReady?: boolean })
                  .__vfMatchReady === true,
              status: panel?.latestVaultStatus != null,
            };
          }),
        { timeout: 60_000 },
      )
      .toEqual({ event: true, status: true });

    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator("control-panel #resource-focus")).toBeVisible({
      timeout: 5_000,
    });
  });
});
