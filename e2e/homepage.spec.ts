import { expect, test } from "@playwright/test";

test.describe("Homepage / Play page", () => {
  test("loads and shows the VaultFront title", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/VaultFront/i);
  });

  test("shows the Solo play option", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Wait for the app to hydrate (Lit components)
    await page.waitForSelector("play-page", { timeout: 10_000 });
    // Solo button should be visible in the nav or main content
    const soloButton = page.getByRole("button", { name: /solo/i }).first();
    await expect(soloButton).toBeVisible({ timeout: 10_000 });
  });

  test("manifest is accessible and has correct name", async ({ request }) => {
    const res = await request.get("/manifest.json");
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest.name).toBe("VaultFront");
    expect(manifest.theme_color).toBe("#08111f");
  });

  test("canonical health endpoint returns ok", async ({ request }) => {
    const res = await request.get("/_health");
    expect(res.ok()).toBeTruthy();
  });

  test("env endpoint returns expected shape", async ({ request }) => {
    const res = await request.get("/api/env");
    expect(res.ok()).toBeTruthy();
    const env = await res.json();
    // Must expose at minimum the env name
    expect(typeof env.env).toBe("string");
  });
});
