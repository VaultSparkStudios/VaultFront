import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error The proof utility is a runtime ESM module exercised by Vitest.
import { computeThemeProofSourceEvidence } from "../scripts/lib/theme-proof.mjs";

const themes = ["vaultfront", "light", "competitive"] as const;
const capturedSource = computeThemeProofSourceEvidence(process.cwd());

// This one spec intentionally captures twelve visual artifacts in
// addition to navigation and contrast assertions. Keep its evidence workload
// intact while giving browser screenshot encoding a bounded, explicit budget.
test.setTimeout(120_000);

const executionStates = ["normal", "rush", "rush-reduced-complete"] as const;

type ExecutionState = (typeof executionStates)[number];

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
    const postMatchMetrics = await page.evaluate(async () => {
      await Promise.all([
        customElements.whenDefined("certified-match-feedback"),
        customElements.whenDefined("post-match-continuation-card"),
      ]);
      const previous = document.querySelector("[data-vf-visual-qa]");
      previous?.remove();
      const overlay = document.createElement("main");
      overlay.dataset.vfVisualQa = "postmatch";
      overlay.style.cssText =
        "box-sizing:border-box;position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:40px 20px;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif";
      const surface = document.createElement("section");
      surface.style.cssText =
        "box-sizing:border-box;width:100%;max-width:700px;margin:0 auto;padding:20px;border:1px solid rgba(255,255,255,.15);border-radius:16px;background:rgba(15,23,42,.94);box-shadow:0 24px 60px rgba(0,0,0,.45)";
      const title = document.createElement("h1");
      title.textContent = "Post-match command";
      const subtitle = document.createElement("p");
      subtitle.textContent =
        "One next move, then a certified reflection receipt.";
      const continuation = document.createElement(
        "post-match-continuation-card",
      ) as HTMLElement & {
        context: {
          isRanked: boolean;
          rivalryRevengeDelta: number;
          nextGoalSaved: boolean;
          isAlive: boolean;
        };
      };
      continuation.context = {
        isRanked: true,
        rivalryRevengeDelta: 0,
        nextGoalSaved: false,
        isAlive: true,
      };
      const feedback = document.createElement(
        "certified-match-feedback",
      ) as HTMLElement & { gameId: string };
      feedback.gameId = "visual-proof-game";
      surface.append(title, subtitle, continuation, feedback);
      overlay.append(surface);
      document.body.append(overlay);
      return { mounted: true };
    });
    expect(postMatchMetrics.mounted).toBe(true);
    await page.getByRole("button", { name: "Match rating 4 out of 5" }).click();
    await page.getByRole("button", { name: "Map rating 2 out of 5" }).click();
    await expect(
      page.getByRole("button", { name: "Submit both ratings" }),
    ).toBeEnabled();
    const renderedPostMatch = await page
      .locator("[data-vf-visual-qa]")
      .evaluate((overlay) => {
        const surface = overlay.querySelector("section") as HTMLElement;
        const buttons = [...overlay.querySelectorAll("button")];
        const groups = [...overlay.querySelectorAll('[role="group"]')];
        const surfaceRect = surface.getBoundingClientRect();
        const buttonRects = buttons.map((button) =>
          button.getBoundingClientRect(),
        );
        return {
          overlayOverflow: overlay.scrollWidth > overlay.clientWidth,
          surfaceOverflow: surface.scrollWidth > surface.clientWidth,
          surfaceWithinViewport:
            surfaceRect.left >= 0 && surfaceRect.right <= innerWidth,
          groupOverflow: groups.some(
            (group) => group.scrollWidth > group.clientWidth,
          ),
          minimumButtonWidth: Math.min(
            ...buttonRects.map((rect) => rect.width),
          ),
          minimumButtonHeight: Math.min(
            ...buttonRects.map((rect) => rect.height),
          ),
        };
      });
    expect(renderedPostMatch).toMatchObject({
      overlayOverflow: false,
      surfaceOverflow: false,
      surfaceWithinViewport: true,
      groupOverflow: false,
    });
    expect(renderedPostMatch.minimumButtonWidth).toBeGreaterThanOrEqual(44);
    expect(renderedPostMatch.minimumButtonHeight).toBeGreaterThanOrEqual(44);
    await page.locator("[data-vf-visual-qa]").screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-postmatch.png`,
      ),
    });
    results.push({
      theme,
      tokens,
      ratios,
      renderedColors,
      postMatch: renderedPostMatch,
      surfaces: ["play", "settings", "postmatch"],
    });
    await page
      .locator("[data-vf-visual-qa]")
      .evaluate((overlay) => overlay.remove());

    const executionProof: Array<Record<string, unknown>> = [];
    for (const state of executionStates) {
      const reducedMotion = state === "rush-reduced-complete";
      await page.emulateMedia({
        reducedMotion: reducedMotion ? "reduce" : "no-preference",
      });
      const metrics = await page.evaluate(
        async ({ state, theme }) => {
          window.scrollTo(0, 0);
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
          const previous = document.querySelector(
            "[data-vf-visual-qa-execution]",
          );
          previous?.remove();
          const [
            { VaultFrontLayer, executionCompletionPalette },
            { GameUpdateType },
          ] = await Promise.all([
            // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
            import("/src/client/graphics/layers/VaultFrontLayer.ts"),
            // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
            import("/src/core/game/GameUpdates.ts"),
          ]);
          const isRush = state !== "normal";
          let now = 10_000;
          const status = {
            type: GameUpdateType.VaultFrontStatus,
            weeklyMutator: isRush ? "execution_rush" : "none",
            executionChainWindowTicks: isRush ? 3_000 : 1_500,
            executionChainRewardMultiplier: isRush ? 1.5 : 1.2,
            executionChains: {
              1: {
                step: 2,
                expiresAtTick: now + (isRush ? 1_500 : 750),
              },
            },
            sites: [],
            convoys: [],
            beacons: [],
            surges: {},
            squadObjectives: [],
            pressure: {},
          };
          let pendingUpdates: Record<number, unknown[]> | null = {
            [GameUpdateType.VaultFrontStatus]: [status],
            [GameUpdateType.VaultFrontActivity]: [],
          };
          const game = {
            updatesSinceLastTick: () => {
              const value = pendingUpdates;
              pendingUpdates = null;
              return value;
            },
            ticks: () => now,
            myPlayer: () => ({ smallID: () => 1 }),
          };
          const layer = new VaultFrontLayer(game, { scale: 1 });
          layer.init();
          layer.tick();
          const accessibleBefore =
            document.querySelector<HTMLElement>(
              "[data-vaultfront-execution-chain-status]",
            )?.textContent ?? "";

          const overlay = document.createElement("main");
          overlay.dataset.vfVisualQaExecution = state;
          overlay.setAttribute(
            "aria-label",
            `Execution chain ${state} visual proof`,
          );
          overlay.style.cssText =
            "position:fixed;inset:0;z-index:2147483647;overflow:hidden;" +
            "background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);" +
            "font-family:Overpass,sans-serif";
          const canvas = document.createElement("canvas");
          canvas.width = innerWidth;
          canvas.height = innerHeight;
          canvas.style.cssText = "display:block;width:100%;height:100%";
          overlay.append(canvas);
          document.body.append(overlay);
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) throw new Error("2D Canvas is unavailable");
          const styles = getComputedStyle(document.documentElement);
          const background =
            styles.getPropertyValue("--vf-bg").trim() || "#07111f";
          const surface =
            styles.getPropertyValue("--vf-surface").trim() || "#0f172a";
          const text = styles.getPropertyValue("--vf-text").trim() || "#f8fafc";
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const cardWidth = Math.min(canvas.width - 32, 520);
          ctx.fillStyle = surface;
          ctx.globalAlpha = 0.88;
          ctx.roundRect(16, 16, cardWidth, 86, 14);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = text;
          ctx.font = `700 ${canvas.width < 600 ? 18 : 22}px Overpass, sans-serif`;
          ctx.fillText("Execution chain authority", 34, 50);
          ctx.font = `${canvas.width < 600 ? 12 : 14}px Overpass, sans-serif`;
          ctx.fillText(
            `${theme} · ${isRush ? "Execution Rush · 3,000 ticks · ×1.5" : "Standard · 1,500 ticks · ×1.2"}`,
            34,
            78,
          );
          const beforeHud = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;

          if (state === "rush-reduced-complete") {
            now += 1;
            pendingUpdates = {
              [GameUpdateType.VaultFrontStatus]: [
                {
                  ...status,
                  executionChains: { 1: { step: 0, expiresAtTick: 0 } },
                },
              ],
              [GameUpdateType.VaultFrontActivity]: [],
            };
            layer.tick();
          }
          // This invokes the production Canvas HUD path with a real status update;
          // the harness supplies only GameView/transform seams that the layer owns.
          (
            layer as unknown as {
              drawExecutionChainHUD(context: CanvasRenderingContext2D): void;
            }
          ).drawExecutionChainHUD(ctx);
          const accessibleAfter =
            document.querySelector<HTMLElement>(
              "[data-vaultfront-execution-chain-status]",
            )?.textContent ?? "";
          const afterHud = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          let changedPixels = 0;
          for (let index = 0; index < afterHud.length; index += 4) {
            if (
              afterHud[index] !== beforeHud[index] ||
              afterHud[index + 1] !== beforeHud[index + 1] ||
              afterHud[index + 2] !== beforeHud[index + 2] ||
              afterHud[index + 3] !== beforeHud[index + 3]
            ) {
              changedPixels += 1;
            }
          }
          return {
            state,
            theme,
            reducedMotion: matchMedia("(prefers-reduced-motion: reduce)")
              .matches,
            accessibleBefore,
            accessibleAfter,
            changedPixels,
            viewport: { width: innerWidth, height: innerHeight },
            scrollY,
            pngBase64: canvas.toDataURL("image/png").split(",")[1],
            background,
            completionForeground: executionCompletionPalette(theme).foreground,
          };
        },
        { state, theme },
      );
      const { pngBase64, ...verifiedMetrics } = metrics;
      expect(metrics.changedPixels).toBeGreaterThan(100);
      expect(metrics.accessibleBefore).toContain(
        state === "normal" ? "×1.2" : "×1.5",
      );
      expect(metrics.reducedMotion).toBe(reducedMotion);
      expect(metrics.scrollY).toBe(0);
      expect(
        contrast(metrics.completionForeground, metrics.background),
      ).toBeGreaterThanOrEqual(4.5);
      if (state === "rush-reduced-complete") {
        expect(metrics.accessibleAfter).toBe("");
      } else {
        expect(metrics.accessibleAfter).toBe(metrics.accessibleBefore);
      }
      await expect(page.locator("[data-vf-visual-qa-execution]")).toBeVisible();
      writeFileSync(
        path.join(
          artifactDir,
          `${testInfo.project.name}-${theme}-execution-${state}.png`,
        ),
        Buffer.from(pngBase64, "base64"),
      );
      executionProof.push(verifiedMetrics);
      await page
        .locator("[data-vf-visual-qa-execution]")
        .evaluate((overlay) => overlay.remove());
    }
    results[results.length - 1].executionChain = executionProof;
    results[results.length - 1].surfaces = [
      "play",
      "settings",
      "postmatch",
      "execution-normal",
      "execution-rush",
      "execution-rush-reduced-complete",
    ];
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
