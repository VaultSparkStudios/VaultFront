import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

test("keyboard traversal announces submenu context and activates a leaf", async ({
  page,
}, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("play-page", { timeout: 10_000 });

  await page.evaluate(async () => {
    const [{ EventBus }, { RadialMenu }] = await Promise.all([
      // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
      import("/src/core/EventBus.ts"),
      // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
      import("/src/client/graphics/layers/RadialMenu.ts"),
    ]);
    const target = window as typeof window & {
      __vfRadialMenu?: { dispose(): void };
      __vfRadialActionCount?: number;
    };
    target.__vfRadialActionCount = 0;
    const leaf = {
      id: "reroute-safe",
      name: "reroute-safe",
      ariaLabel: "Safest route",
      disabled: () => false,
      icon: "/images/BoatIconWhite.svg",
      action: () => {
        target.__vfRadialActionCount = (target.__vfRadialActionCount ?? 0) + 1;
      },
    };
    const root = {
      id: "root",
      name: "root",
      disabled: () => false,
      subMenu: () => [
        {
          id: "attack",
          name: "attack",
          ariaLabel: "Attack",
          disabled: () => false,
          icon: "/images/SwordIconWhite.svg",
          action: () => undefined,
        },
        {
          id: "routes",
          name: "routes",
          ariaLabel: "Convoy routes",
          disabled: () => false,
          icon: "/images/BoatIconWhite.svg",
          subMenu: () => [leaf],
        },
      ],
    };
    const menu = new RadialMenu(
      new EventBus(),
      root as never,
      { disabled: () => false, action: () => undefined } as never,
      { menuTransitionDuration: 0 },
    );
    menu.init();
    menu.setParams({
      myPlayer: {},
      selected: null,
      tile: {},
      playerActions: {},
      game: { inSpawnPhase: () => false },
      buildMenu: {},
      emojiTable: {},
      playerActionHandler: {},
      playerPanel: {},
      chatIntegration: {},
      eventBus: {},
      closeMenu: () => undefined,
    } as never);
    menu.showRadialMenu(innerWidth / 2, innerHeight / 2);
    target.__vfRadialMenu = menu;
  });

  const status = page.locator(".radial-menu-live-region");
  await expect(status).toHaveText("Attack. Available. Action. Item 1 of 2");
  await page.keyboard.press("ArrowRight");
  await expect(status).toHaveText(
    "Convoy routes. Available. Opens submenu. Item 2 of 2",
  );
  await page.keyboard.press("Enter");
  await expect(page.locator('path[data-id="reroute-safe"]')).toHaveAttribute(
    "tabindex",
    "0",
  );
  await expect(status).toHaveText(
    "Safest route. Available. Action. Item 1 of 1. Submenu level 1",
  );

  const artifactDir = path.resolve("output", "playwright");
  mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({
    path: path.join(
      artifactDir,
      `${testInfo.project.name}-radial-menu-keyboard.png`,
    ),
  });

  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __vfRadialActionCount?: number })
            .__vfRadialActionCount,
      ),
    )
    .toBe(1);
  await expect(page.locator(".radial-menu-container")).toBeHidden();
  await expect(status).toHaveText("");

  await page.evaluate(() => {
    const target = window as typeof window & {
      __vfRadialMenu?: { dispose(): void };
    };
    target.__vfRadialMenu?.dispose();
    delete target.__vfRadialMenu;
  });
});
