import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error The proof utility is a runtime ESM module exercised by Vitest.
import {
  computeThemeProofSourceEvidence,
  THEME_PROOF_SURFACES,
} from "../scripts/lib/theme-proof.mjs";

const themes = ["vaultfront", "light", "competitive"] as const;
const capturedSource = computeThemeProofSourceEvidence(process.cwd());

// This one spec intentionally captures the complete canonical visual matrix in
// addition to navigation and contrast assertions. Keep its evidence workload
// intact while giving browser screenshot encoding a bounded, explicit budget.
test.setTimeout(180_000);

const executionStates = ["normal", "rush", "rush-reduced-complete"] as const;

type ExecutionState = (typeof executionStates)[number];

function luminance(hex: string): number {
  const value = hex.trim();
  const rgbMatch = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/u,
  );
  const srgbMatch = value.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/u,
  );
  const rgb = rgbMatch
    ? rgbMatch.slice(1, 4).map((channel) => Number(channel) / 255)
    : srgbMatch
      ? srgbMatch.slice(1, 4).map(Number)
      : [0, 2, 4].map(
          (offset) =>
            parseInt(value.replace("#", "").slice(offset, offset + 2), 16) /
            255,
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
    await expect(page.locator("html")).toHaveAttribute(
      "data-vf-layout-ready",
      "true",
    );
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

    const statsShowcase = page.locator("public-stats-showcase");
    await expect(statsShowcase).toBeVisible();
    const statsArticles = statsShowcase.locator("article");
    await expect(statsArticles).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      await expect(statsArticles.nth(index)).toBeVisible();
    }
    const statsGeometry = await statsShowcase.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const link = element.shadowRoot?.querySelector("a");
      const linkBox = link?.getBoundingClientRect();
      return {
        overflow: element.scrollWidth > element.clientWidth + 1,
        width: box.width,
        linkHeight: linkBox?.height ?? 0,
      };
    });
    expect(statsGeometry.overflow).toBe(false);
    expect(statsGeometry.width).toBeGreaterThan(250);
    expect(statsGeometry.linkHeight).toBeGreaterThanOrEqual(44);
    await statsShowcase.locator("section").screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-stats-showcase.png`,
      ),
    });

    await page.evaluate(async () => {
      await window.showPage?.("page-command-center");
      await customElements.whenDefined("command-center");
    });
    const commandCenter = page.locator("#page-command-center");
    await expect(commandCenter).toBeVisible();
    await expect(
      commandCenter.locator("[data-vf-command-center]"),
    ).toBeVisible();
    const commandCenterMetrics = await commandCenter.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const root = element.querySelector<HTMLElement>(
        "[data-vf-command-center]",
      );
      const primaryControl = element.querySelector<HTMLElement>("button");
      const style = root ? getComputedStyle(root) : null;
      return {
        overflow: element.scrollWidth > element.clientWidth + 1,
        width: bounds.width,
        controlHeight: primaryControl?.getBoundingClientRect().height ?? 0,
        background: style?.backgroundImage ?? "",
        color: style?.color ?? "",
      };
    });
    expect(commandCenterMetrics.overflow).toBe(false);
    expect(commandCenterMetrics.width).toBeGreaterThan(250);
    expect(commandCenterMetrics.controlHeight).toBeGreaterThanOrEqual(44);
    expect(commandCenterMetrics.background).toContain("gradient");
    expect(commandCenterMetrics.color).not.toBe("");
    const fortuneMetrics = await commandCenter.evaluate(async (element) => {
      const root = element.querySelector<HTMLElement>(
        "[data-vf-command-center]",
      );
      const fortune = element.querySelector<any>("fortune-collection-panel");
      if (!root || !fortune)
        throw new Error("command-center QA surface missing");
      fortune.persistentId = "visual-qa-player";
      fortune.items = [
        {
          itemId: "title_operator",
          name: "The Operator",
          rarity: "common",
          type: "title",
          value: "The Operator",
          drawnAt: 1,
        },
        {
          itemId: "emoji_shield",
          name: "Shield Emoji",
          rarity: "rare",
          type: "emoji",
          value: "shield",
          drawnAt: 2,
        },
      ];
      fortune.equippedTitle = null;
      fortune.equipStatus = {
        kind: "error",
        message: "Title could not be equipped. Try again.",
      };
      fortune.requestUpdate();
      await fortune.updateComplete;
      element.style.height = "auto";
      root.style.height = "auto";
      root.style.overflow = "visible";
      const contentHeight = root.scrollHeight;
      element.dataset.vfQaStyle = element.getAttribute("style") ?? "";
      element.style.cssText = `position:absolute;inset:auto;top:0;left:0;width:100%;height:${contentHeight}px;z-index:2147483646;overflow:visible`;
      root.style.height = `${contentHeight}px`;
      document.body.dataset.vfQaMinHeight = document.body.style.minHeight;
      document.body.style.minHeight = `${contentHeight}px`;
      for (const footer of document.querySelectorAll<HTMLElement>(
        "page-footer, body > footer",
      )) {
        footer.dataset.vfQaDisplay = footer.style.display;
        footer.style.display = "none";
      }
      const equipButton =
        fortune.shadowRoot?.querySelector<HTMLElement>(".equip-button");
      const status =
        fortune.shadowRoot?.querySelector<HTMLElement>(".equip-status");
      const fortuneBounds = fortune.getBoundingClientRect();
      const rootBounds = root.getBoundingClientRect();
      return {
        buttonHeight: equipButton?.getBoundingClientRect().height ?? 0,
        statusRole: status?.getAttribute("role") ?? "",
        statusColor: status ? getComputedStyle(status).color : "",
        statusBackground: status
          ? getComputedStyle(status).backgroundColor
          : "",
        contentHeight,
        fortuneVisible:
          fortuneBounds.height > 0 &&
          fortuneBounds.top >= rootBounds.top &&
          fortuneBounds.bottom <= rootBounds.bottom + 1,
      };
    });
    expect(fortuneMetrics.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(fortuneMetrics.statusRole).toBe("alert");
    expect(fortuneMetrics.statusColor).not.toBe("");
    expect(
      contrast(fortuneMetrics.statusColor, fortuneMetrics.statusBackground),
    ).toBeGreaterThanOrEqual(4.5);
    expect(fortuneMetrics.contentHeight).toBeGreaterThan(700);
    expect(fortuneMetrics.fortuneVisible).toBe(true);
    await commandCenter.locator("[data-vf-command-center]").screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-command-center.png`,
      ),
    });
    await page.evaluate(async () => {
      for (const footer of document.querySelectorAll<HTMLElement>(
        "page-footer, body > footer",
      )) {
        footer.style.display = footer.dataset.vfQaDisplay ?? "";
        delete footer.dataset.vfQaDisplay;
      }
      const element = document.querySelector<HTMLElement>(
        "#page-command-center",
      );
      if (element) {
        element.setAttribute("style", element.dataset.vfQaStyle ?? "");
        delete element.dataset.vfQaStyle;
      }
      document.body.style.minHeight = document.body.dataset.vfQaMinHeight ?? "";
      delete document.body.dataset.vfQaMinHeight;
      await window.showPage?.("page-play");
    });

    const agencyDoctrine = await page.evaluate(async () => {
      await Promise.all([
        customElements.whenDefined("control-panel"),
        customElements.whenDefined("game-right-sidebar"),
      ]);
      document.querySelector("[data-vf-visual-qa-agency]")?.remove();
      const overlay = document.createElement("main");
      overlay.dataset.vfVisualQaAgency = "agency-doctrine";
      overlay.style.cssText =
        "box-sizing:border-box;position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:24px;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif;display:grid;place-items:center";
      const surface = document.createElement("section");
      surface.style.cssText =
        "box-sizing:border-box;width:min(760px,100%);display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;align-items:start;padding:18px;border:1px solid rgba(34,211,238,.28);border-radius:16px;background:var(--vf-surface,#0f172a);box-shadow:0 24px 60px rgba(0,0,0,.42)";

      const control = document.createElement("control-panel") as any;
      control.game = {
        myPlayer: () => ({ smallID: () => 7 }),
        ticks: () => 120,
      };
      control.latestVaultStatus = {
        pressure: {
          7: {
            pressure: 3,
            threshold: 3,
            breachWindowUntilTick: 300,
            contributors: { 7: 1, 9: 2 },
          },
        },
        beacons: [],
      };
      control.onboardingProgress = {
        focusSet: false,
        vaultCaptured: true,
        convoyAction: true,
        pressureStarted: true,
        breachOpened: true,
        decisiveDelivery: false,
        pulseTriggered: false,
      };
      control.tutorialLockActive = false;
      control.shouldShowOnboarding = () => true;
      control.render = control.renderOnboarding.bind(control);

      const reroute = document.createElement("control-panel") as any;
      reroute.selectedPreviewCommand = "reroute_safest";
      reroute.isMobilePriorityMode = () => innerWidth <= 430;
      const reroutePreviews = [
        {
          command: "reroute_safest",
          destinationTile: 10,
          etaSeconds: 18,
          routeRisk: 0.2,
          routeDistance: 16,
          rewardMultiplier: 1,
          rewardScale: 1,
          strengthMultiplier: 1,
          phaseMultiplier: 1,
          riskMultiplier: 1,
          goldReward: 180_000,
          troopsReward: 1_400,
          rewardMath: "visual proof",
          deltaGold: 0,
          deltaTroops: 0,
          deltaEtaSeconds: 0,
          deltaRisk: 0,
        },
        {
          command: "reroute_city",
          destinationTile: 12,
          etaSeconds: 12,
          routeRisk: 0.45,
          routeDistance: 12,
          rewardMultiplier: 1,
          rewardScale: 1,
          strengthMultiplier: 1,
          phaseMultiplier: 1,
          riskMultiplier: 1,
          goldReward: 220_000,
          troopsReward: 1_400,
          rewardMath: "visual proof",
          deltaGold: 40_000,
          deltaTroops: 0,
          deltaEtaSeconds: -6,
          deltaRisk: 0.25,
        },
      ];
      reroute.render = () =>
        reroute.renderReroutePreviewPanel({ reroutePreviews });

      const doctrine = document.createElement("game-right-sidebar") as any;
      doctrine.hudScale = 1;
      doctrine.masterySelectionPending = null;
      doctrine.masterySelectionNotice = "Certified receipt 7f4a21c0";
      doctrine.dailyChallenge = {
        challengeId: "victory-1",
        description: "Win a certified match",
        progress: 1,
        target: 1,
        rewardMastery: 75,
        completed: true,
        masteryBalance: 75,
        dateUtc: "2026-08-04",
        evidence: "certified-match-result",
        durability: "postgres",
        doctrines: {
          catalog: [
            {
              id: "route-reader",
              name: "Route Reader",
              costMastery: 50,
              role: "Convoy tactician",
              brief: "Escort timing and interception lanes.",
            },
            {
              id: "breach-architect",
              name: "Breach Architect",
              costMastery: 100,
              role: "Pressure shot-caller",
              brief: "Pressure tempo and decisive delivery.",
            },
            {
              id: "vault-warden",
              name: "Vault Warden",
              costMastery: 150,
              role: "Extraction controller",
              brief: "Vault defense and safe conversion.",
            },
          ],
          ownedIds: ["route-reader"],
          activeId: "route-reader",
          effectPolicy: "coaching-and-identity-only",
        },
      };
      doctrine.render = doctrine.renderDailyChallenge.bind(doctrine);
      surface.append(control, reroute, doctrine);
      overlay.append(surface);
      document.body.append(overlay);
      control.requestUpdate();
      doctrine.requestUpdate();
      await Promise.all([
        control.updateComplete,
        reroute.updateComplete,
        doctrine.updateComplete,
      ]);
      overlay.querySelectorAll<HTMLElement>(".fixed").forEach((element) => {
        element.style.position = "relative";
        element.style.inset = "auto";
        element.style.width = "100%";
      });
      const rect = surface.getBoundingClientRect();
      const reroutePanel =
        overlay.querySelector<HTMLElement>(".vf-reroute-panel");
      const rerouteOptions = [
        ...overlay.querySelectorAll<HTMLElement>(".vf-reroute-option"),
      ];
      const selectedOption = rerouteOptions.find(
        (option) => option.getAttribute("aria-checked") === "true",
      );
      const unselectedOption = rerouteOptions.find(
        (option) => option.getAttribute("aria-checked") === "false",
      );
      if (!reroutePanel || !selectedOption || !unselectedOption) {
        throw new Error("reroute decision matrix did not render");
      }
      return {
        overflow: overlay.scrollWidth > overlay.clientWidth,
        surfaceWithinViewport: rect.left >= 0 && rect.right <= innerWidth,
        hasAgencyReceipt: overlay.textContent?.includes(
          "You: 1 Pressure delivery · Team: 3/3 · Breach live",
        ),
        hasDoctrinePolicy: overlay.textContent?.includes(
          "Coaching identity only · never combat power",
        ),
        hasRerouteMatrix:
          overlay.querySelectorAll('[role="radiogroup"] [role="radio"]')
            .length === 2 &&
          overlay.textContent?.includes("Safest lane. ETA 18s"),
        rerouteColors: {
          panelText: getComputedStyle(reroutePanel).color,
          panelBackground: getComputedStyle(reroutePanel).backgroundColor,
          selectedText: getComputedStyle(selectedOption).color,
          selectedBackground: getComputedStyle(selectedOption).backgroundColor,
          unselectedText: getComputedStyle(unselectedOption).color,
          unselectedBackground:
            getComputedStyle(unselectedOption).backgroundColor,
        },
      };
    });
    expect(agencyDoctrine).toMatchObject({
      overflow: false,
      surfaceWithinViewport: true,
      hasAgencyReceipt: true,
      hasDoctrinePolicy: true,
      hasRerouteMatrix: true,
    });
    expect(
      contrast(
        agencyDoctrine.rerouteColors.panelText,
        agencyDoctrine.rerouteColors.panelBackground,
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(
        agencyDoctrine.rerouteColors.selectedText,
        agencyDoctrine.rerouteColors.selectedBackground,
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(
        agencyDoctrine.rerouteColors.unselectedText,
        agencyDoctrine.rerouteColors.unselectedBackground,
      ),
    ).toBeGreaterThanOrEqual(4.5);
    await page.locator("[data-vf-visual-qa-agency]").screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-agency-doctrine.png`,
      ),
    });
    await page
      .locator("[data-vf-visual-qa-agency]")
      .evaluate((overlay) => overlay.remove());

    if (testInfo.project.name === "mobile-chrome") {
      await page.locator("#hamburger-btn").click();
      const settings = page.locator(
        'mobile-nav-bar [data-page="page-settings"]',
      );
      await settings.evaluate((element) =>
        element.scrollIntoView({ block: "center" }),
      );
      await expect(settings).toBeInViewport();
      await settings.click();
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
    await expect(page.locator("#page-settings")).toContainText(
      "Toggle the site's appearance",
    );
    await page.screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-settings.png`,
      ),
      fullPage: true,
    });
    await page.evaluate(() => window.showPage?.("page-language"));
    const languageModal = page.locator("#page-language");
    await expect(languageModal).toBeVisible();
    await expect(languageModal.locator("button").first()).toBeVisible();
    const languageModalMetrics = await languageModal.evaluate((element) => {
      const surface = element.querySelector<HTMLElement>(":scope > div");
      const surfaceRect = surface?.getBoundingClientRect();
      const buttons = [...element.querySelectorAll<HTMLElement>("button")]
        .filter((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((button) => button.getBoundingClientRect());
      const style = surface ? getComputedStyle(surface) : null;
      const inactiveButton = element.querySelectorAll<HTMLElement>("button")[2];
      const inactiveLabels = inactiveButton
        ? inactiveButton.querySelectorAll<HTMLElement>("span")
        : [];
      const colorProbe = document.createElement("span");
      colorProbe.style.color = "var(--vf-panel-text)";
      element.append(colorProbe);
      const panelText = getComputedStyle(colorProbe).color;
      colorProbe.style.color = "var(--vf-panel-muted)";
      const panelMuted = getComputedStyle(colorProbe).color;
      colorProbe.remove();
      return {
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
        surfaceWithinViewport: Boolean(
          surfaceRect &&
          surfaceRect.left >= 0 &&
          surfaceRect.right <= innerWidth &&
          surfaceRect.top >= 0 &&
          surfaceRect.bottom <= innerHeight,
        ),
        backdropFilter: style?.backdropFilter ?? "",
        contain: style?.contain ?? "",
        optionCount: buttons.length,
        minimumButtonWidth: Math.min(...buttons.map((rect) => rect.width)),
        minimumButtonHeight: Math.min(...buttons.map((rect) => rect.height)),
        colors: {
          native: inactiveLabels[0]
            ? getComputedStyle(inactiveLabels[0]).color
            : "",
          translated: inactiveLabels[1]
            ? getComputedStyle(inactiveLabels[1]).color
            : "",
          panelText,
          panelMuted,
        },
      };
    });
    expect(languageModalMetrics).toMatchObject({
      horizontalOverflow: false,
      surfaceWithinViewport: true,
      backdropFilter: "none",
    });
    expect(languageModalMetrics.contain).toContain("paint");
    expect(languageModalMetrics.optionCount).toBeGreaterThanOrEqual(30);
    expect(languageModalMetrics.minimumButtonWidth).toBeGreaterThanOrEqual(44);
    expect(languageModalMetrics.minimumButtonHeight).toBeGreaterThanOrEqual(44);
    expect(languageModalMetrics.colors.native).toBe(
      languageModalMetrics.colors.panelText,
    );
    expect(languageModalMetrics.colors.translated).toBe(
      languageModalMetrics.colors.panelMuted,
    );
    await page.screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-language-modal.png`,
      ),
      fullPage: true,
    });
    await page.evaluate(() => window.showPage?.("page-play"));
    const accessibleModalMetrics = await page.evaluate(async () => {
      if (!customElements.get("o-modal")) {
        await import("/src/client/components/baseComponents/Modal.ts");
      }
      document.querySelector("[data-vf-visual-qa-modal]")?.remove();
      const overlay = document.createElement("main");
      overlay.dataset.vfVisualQaModal = "accessible";
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif";
      const modal = document.createElement("o-modal") as any;
      modal.title = "Command briefing";
      modal.maxWidth = "620px";
      const content = document.createElement("article");
      content.style.cssText = "padding:24px;display:grid;gap:16px";
      content.innerHTML =
        "<strong>Extraction corridor ready</strong><p>Confirm the route, then return to the live command map.</p><button style='min-height:44px;border-radius:8px;background:#fbbf24;color:#111827;font-weight:800'>Confirm route</button>";
      modal.append(content);
      overlay.append(modal);
      document.body.append(overlay);
      modal.open();
      await modal.updateComplete;
      const dialog =
        modal.shadowRoot?.querySelector<HTMLElement>('[role="dialog"]');
      const close = modal.shadowRoot?.querySelector<HTMLElement>(
        'button[aria-label^="Close"]',
      );
      const dialogRect = dialog?.getBoundingClientRect();
      const closeRect = close?.getBoundingClientRect();
      return {
        role: dialog?.getAttribute("role"),
        ariaModal: dialog?.getAttribute("aria-modal"),
        labelledBy: dialog?.getAttribute("aria-labelledby"),
        dialogWithinViewport: Boolean(
          dialogRect &&
          dialogRect.left >= 0 &&
          dialogRect.right <= innerWidth &&
          dialogRect.top >= 0 &&
          dialogRect.bottom <= innerHeight,
        ),
        closeWidth: closeRect?.width ?? 0,
        closeHeight: closeRect?.height ?? 0,
      };
    });
    expect(accessibleModalMetrics).toMatchObject({
      role: "dialog",
      ariaModal: "true",
      dialogWithinViewport: true,
    });
    expect(accessibleModalMetrics.labelledBy).toBeTruthy();
    expect(accessibleModalMetrics.closeWidth).toBeGreaterThanOrEqual(44);
    expect(accessibleModalMetrics.closeHeight).toBeGreaterThanOrEqual(44);
    await page.locator("[data-vf-visual-qa-modal]").screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-accessible-modal.png`,
      ),
    });
    await page.locator("[data-vf-visual-qa-modal]").evaluate((overlay) => {
      (overlay.querySelector("o-modal") as any)?.close();
      overlay.remove();
    });
    const postMatchMetrics = await page.evaluate(async () => {
      await import("/src/client/graphics/layers/WinModal.ts");
      await Promise.all([
        customElements.whenDefined("win-modal"),
        customElements.whenDefined("certified-match-feedback"),
        customElements.whenDefined("post-match-continuation-card"),
      ]);
      const previous = document.querySelector("[data-vf-visual-qa]");
      previous?.remove();
      const overlay = document.createElement("main");
      overlay.dataset.vfVisualQa = "postmatch";
      overlay.style.cssText =
        "box-sizing:border-box;position:absolute;top:0;left:0;width:100%;min-height:100vh;z-index:2147483647;overflow:visible;padding:40px 20px;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif";
      const modal = document.createElement("win-modal") as any;
      modal.innerHtml = () => "";
      modal.renderRecapSection = () => null;
      modal.game = {
        gameID: () => "visual-proof-game",
        myPlayer: () => ({ isAlive: () => true }),
      };
      modal.isVisible = true;
      modal.showButtons = true;
      modal.isRankedGame = true;
      modal._title = "Certified match result";
      overlay.append(modal);
      document.body.append(overlay);
      modal.requestUpdate();
      await modal.updateComplete;
      const surface = modal.querySelector<HTMLElement>(
        "[data-vf-postmatch-surface]",
      );
      if (!surface) throw new Error("WinModal proof surface did not render");
      const runtimeRect = surface.getBoundingClientRect();
      const runtimeWithinViewport =
        runtimeRect.left >= 0 && runtimeRect.right <= innerWidth;
      surface.style.cssText +=
        ";box-sizing:border-box;position:fixed;top:0;right:auto;bottom:auto;left:0;translate:none;transform:none;width:min(700px,calc(100vw - 40px));max-width:none;max-height:none;overflow:visible;margin:0";
      return { mounted: true, actualWinModal: true, runtimeWithinViewport };
    });
    expect(postMatchMetrics).toEqual({
      mounted: true,
      actualWinModal: true,
      runtimeWithinViewport: true,
    });
    await page
      .getByRole("button", { name: "Match rating 4 out of 5" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await page
      .getByRole("button", { name: "Map rating 2 out of 5" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(
      page.getByRole("button", { name: "Submit both ratings" }),
    ).toBeEnabled();
    const renderedPostMatch = await page
      .locator("[data-vf-visual-qa]")
      .evaluate((overlay) => {
        const surface = overlay.querySelector<HTMLElement>(
          "[data-vf-postmatch-surface]",
        )!;
        const details = surface.querySelector<HTMLDetailsElement>(
          "details[data-post-match-secondary]",
        );
        const summary = details?.querySelector<HTMLElement>("summary");
        const buttons = [...overlay.querySelectorAll("button")];
        const groups = [...overlay.querySelectorAll('[role="group"]')];
        const surfaceRect = surface.getBoundingClientRect();
        const buttonRects = buttons.map((button) =>
          button.getBoundingClientRect(),
        );
        const visibleButtonRects = buttonRects.filter(
          (rect) => rect.width > 0 && rect.height > 0,
        );
        return {
          overlayOverflow: overlay.scrollWidth > overlay.clientWidth,
          surfaceOverflow: surface.scrollWidth > surface.clientWidth,
          surfaceWidth: surfaceRect.width,
          secondaryDisclosurePresent: Boolean(details),
          secondaryDisclosureOpen: details?.open ?? true,
          secondarySummaryHeight: summary?.getBoundingClientRect().height ?? 0,
          secondaryActionCount:
            details?.querySelectorAll("button, a").length ?? 0,
          groupOverflow: groups.some(
            (group) => group.scrollWidth > group.clientWidth,
          ),
          minimumButtonWidth: Math.min(
            ...visibleButtonRects.map((rect) => rect.width),
          ),
          minimumButtonHeight: Math.min(
            ...visibleButtonRects.map((rect) => rect.height),
          ),
        };
      });
    expect(renderedPostMatch).toMatchObject({
      overlayOverflow: false,
      surfaceOverflow: false,
      groupOverflow: false,
      secondaryDisclosurePresent: true,
      secondaryDisclosureOpen: false,
    });
    expect(renderedPostMatch.surfaceWidth).toBeLessThanOrEqual(
      await page.evaluate(() => innerWidth),
    );
    expect(renderedPostMatch.secondarySummaryHeight).toBeGreaterThanOrEqual(44);
    expect(renderedPostMatch.secondaryActionCount).toBeGreaterThanOrEqual(3);
    expect(renderedPostMatch.minimumButtonWidth).toBeGreaterThanOrEqual(44);
    expect(renderedPostMatch.minimumButtonHeight).toBeGreaterThanOrEqual(44);
    await page
      .locator("[data-vf-visual-qa] [data-vf-postmatch-surface]")
      .screenshot({
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
      surfaces: ["play", "stats-showcase", "settings", "postmatch"],
      languageModal: languageModalMetrics,
      agencyDoctrine,
    });
    await page
      .locator("[data-vf-visual-qa]")
      .evaluate((overlay) => overlay.remove());

    const accountHandoff = await page.evaluate(async () => {
      // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
      await import("/src/client/AccountModal.ts");
      const overlay = document.createElement("main");
      overlay.dataset.vfVisualQaAccountHandoff = "obelisk";
      overlay.style.cssText =
        "box-sizing:border-box;position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:16px;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif;display:grid;place-items:center";
      const modal = document.createElement("account-modal") as any;
      modal.inline = true;
      overlay.append(modal);
      document.body.append(overlay);
      modal.requestUpdate();
      await modal.updateComplete;
      const heading = modal.querySelector<HTMLHeadingElement>("h3");
      const button = Array.from(
        modal.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) =>
        candidate.textContent?.includes("Continue with Obelisk"),
      );
      if (!heading || !button) {
        throw new Error("Obelisk account handoff did not render");
      }
      const rect = modal.getBoundingClientRect();
      const text = modal.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return {
        provider: "obelisk",
        heading: heading.textContent?.trim(),
        action: button.textContent?.trim(),
        credentialBoundary:
          text.includes("Obelisk handles passkeys") &&
          text.includes("VaultFront never receives your credentials"),
        horizontalOverflow: overlay.scrollWidth > overlay.clientWidth,
        withinViewport: rect.left >= 0 && rect.right <= innerWidth,
        minimumButtonHeight: button.getBoundingClientRect().height,
      };
    });
    expect(accountHandoff).toMatchObject({
      provider: "obelisk",
      heading: "VaultSpark Passport",
      action: "Continue with Obelisk",
      credentialBoundary: true,
      horizontalOverflow: false,
      withinViewport: true,
    });
    expect(accountHandoff.minimumButtonHeight).toBeGreaterThanOrEqual(44);
    await page.locator("[data-vf-visual-qa-account-handoff]").screenshot({
      path: path.join(
        artifactDir,
        testInfo.project.name + "-" + theme + "-account-handoff.png",
      ),
    });
    await page
      .locator("[data-vf-visual-qa-account-handoff]")
      .evaluate((overlay) => overlay.remove());

    const multiTabCollision = await page.evaluate(async () => {
      // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
      await import("/src/client/graphics/layers/MultiTabModal.ts");
      const overlay = document.createElement("main");
      overlay.dataset.vfVisualQaMultiTab = "collision";
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif";
      const modal = document.createElement("multi-tab-modal") as any;
      modal.game = { myPlayer: () => ({ isAlive: () => true }) };
      overlay.append(modal);
      document.body.append(overlay);
      modal.show(10_000);
      await modal.updateComplete;
      const dialog = modal.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) throw new Error("multi-tab collision did not render");
      const rect = dialog.getBoundingClientRect();
      const text = dialog.textContent ?? "";
      const normalizedText = text.replace(/\s+/g, " ").trim();
      return {
        role: dialog.getAttribute("role"),
        ariaModal: dialog.getAttribute("aria-modal"),
        horizontalOverflow: overlay.scrollWidth > overlay.clientWidth,
        withinViewport: rect.left >= 0 && rect.right <= innerWidth,
        truthfulScope:
          normalizedText.includes("same-origin browser storage collision") &&
          normalizedText.includes("does not create a server report"),
        text,
      };
    });
    expect(multiTabCollision).toMatchObject({
      role: "dialog",
      ariaModal: "true",
      horizontalOverflow: false,
      withinViewport: true,
      truthfulScope: true,
    });
    await page.locator("[data-vf-visual-qa-multi-tab]").screenshot({
      path: path.join(
        artifactDir,
        testInfo.project.name + "-" + theme + "-multi-tab-collision.png",
      ),
    });
    await page.evaluate(() => {
      const modal = document.querySelector<any>(
        "[data-vf-visual-qa-multi-tab] multi-tab-modal",
      );
      modal?.dispose();
      document.querySelector("[data-vf-visual-qa-multi-tab]")?.remove();
    });

    const progressionDoctrine = await page.evaluate(async () => {
      // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
      await import("/src/client/components/ProgressionDebrief.ts");
      const overlay = document.createElement("main");
      overlay.dataset.vfVisualQaProgressionDoctrine = "verified";
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif";
      const debrief = document.createElement("progression-debrief") as any;
      debrief.visible = true;
      debrief.loading = false;
      debrief.certification = "verified";
      debrief.masteryText = "Replay the decisive convoy pattern";
      debrief.masteryEvidence =
        "Certified match dividend · postgres · sha256:7f4a21c0";
      debrief.eloText = "+18 rating · 1266";
      debrief.milestoneText = "Convoy Vanguard 4/5";
      debrief.achievementText = "+1 achievements";
      debrief.doctrineId = "convoy-architect";
      debrief.doctrineName = "Convoy Architect";
      debrief.doctrineRole = "Route planner";
      debrief.doctrineBrief = "Build the safest decisive lane.";
      overlay.append(debrief);
      document.body.append(overlay);
      debrief.requestUpdate();
      await debrief.updateComplete;
      const aside = debrief.querySelector<HTMLElement>(
        '[aria-label="Progression Debrief"]',
      );
      if (!aside) throw new Error("progression doctrine did not render");
      const rect = aside.getBoundingClientRect();
      const text = aside.textContent ?? "";
      return {
        horizontalOverflow: overlay.scrollWidth > overlay.clientWidth,
        withinViewport: rect.left >= 0 && rect.right <= innerWidth,
        doctrineBound:
          text.includes("Active Doctrine") &&
          text.includes("Convoy Architect") &&
          text.includes("never combat power"),
      };
    });
    expect(progressionDoctrine).toMatchObject({
      horizontalOverflow: false,
      withinViewport: true,
      doctrineBound: true,
    });
    await page.locator("[data-vf-visual-qa-progression-doctrine]").screenshot({
      path: path.join(
        artifactDir,
        testInfo.project.name + "-" + theme + "-progression-doctrine.png",
      ),
    });
    await page.evaluate(() => {
      const debrief = document.querySelector<any>(
        "[data-vf-visual-qa-progression-doctrine] progression-debrief",
      );
      debrief?.dispose();
      document
        .querySelector("[data-vf-visual-qa-progression-doctrine]")
        ?.remove();
    });

    const predictionLeague = await page.evaluate(async () => {
      // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
      await import("/src/client/components/PredictionLeaguePanel.ts");
      const overlay = document.createElement("main");
      overlay.dataset.vfVisualQaPredictionLeague = "verified";
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;overflow:auto;padding:16px;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif";
      const panel = document.createElement("prediction-league-panel") as any;
      panel.visible = true;
      panel.accuracy = 67;
      panel.notice = "Prediction locked for this certified match";
      panel.consensus = {
        gameId: "visual-proof",
        deliveryPct: 62,
        interceptPct: 38,
        total: 8,
        status: "open",
        durability: "postgres",
      };
      overlay.append(panel);
      document.body.append(overlay);
      panel.requestUpdate();
      await panel.updateComplete;
      const surface = panel.querySelector<HTMLElement>(".prediction-panel");
      const actions = [
        ...panel.querySelectorAll<HTMLElement>(".prediction-action"),
      ];
      if (!surface || actions.length !== 2) {
        throw new Error("prediction league did not render");
      }
      surface.style.position = "relative";
      surface.style.inset = "auto";
      const rect = surface.getBoundingClientRect();
      return {
        horizontalOverflow: overlay.scrollWidth > overlay.clientWidth,
        withinViewport: rect.left >= 0 && rect.right <= innerWidth,
        minActionHeight: Math.min(
          ...actions.map((action) => action.getBoundingClientRect().height),
        ),
        hasConsensus:
          surface.textContent?.includes("Delivery 62%") &&
          surface.textContent?.includes("Intercept 38%"),
      };
    });
    expect(predictionLeague).toMatchObject({
      horizontalOverflow: false,
      withinViewport: true,
      hasConsensus: true,
    });
    expect(predictionLeague.minActionHeight).toBeGreaterThanOrEqual(44);
    await page.locator("[data-vf-visual-qa-prediction-league]").screenshot({
      path: path.join(
        artifactDir,
        testInfo.project.name + "-" + theme + "-prediction-league.png",
      ),
    });
    await page.evaluate(() => {
      document.querySelector("[data-vf-visual-qa-prediction-league]")?.remove();
    });

    results[results.length - 1].accountHandoff = accountHandoff;
    results[results.length - 1].multiTabCollision = multiTabCollision;
    results[results.length - 1].progressionDoctrine = progressionDoctrine;
    results[results.length - 1].predictionLeague = predictionLeague;
    const prematchProof: Array<Record<string, unknown>> = [];
    for (const state of ["loading", "degraded", "ready"] as const) {
      const metrics = await page.evaluate(async (state) => {
        document.querySelector("[data-vf-visual-qa-prematch]")?.remove();
        // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
        await import("/src/client/GameStartingModal.ts");
        const overlay = document.createElement("main");
        overlay.dataset.vfVisualQaPrematch = state;
        overlay.style.cssText =
          "position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif";
        const modal = document.createElement(
          "game-starting-modal",
        ) as HTMLElement & {
          isVisible: boolean;
          intelligenceStatus: string;
          prophecy: string | null;
          prophecyVisible: boolean;
          prematchBrief: string | null;
          myPrediction: Record<string, unknown> | null;
          requestUpdate(): void;
          updateComplete: Promise<unknown>;
        };
        modal.isVisible = true;
        modal.intelligenceStatus = state;
        if (state === "ready") {
          modal.prematchBrief =
            "Secure the western vault lane, then reserve your escort for the first pulse.";
          modal.prophecy = "The quiet convoy carries the loudest consequence.";
          modal.prophecyVisible = true;
          modal.myPrediction = {
            playerId: "visual-player",
            deltaIfWin: 18,
            deltaIfLoss: -11,
            threat: "The eastern interceptor",
          };
        }
        overlay.append(modal);
        document.body.append(overlay);
        modal.requestUpdate();
        await modal.updateComplete;
        const dialog = modal.querySelector<HTMLElement>('[role="dialog"]');
        if (!dialog) throw new Error("prematch dialog did not render");
        const rect = dialog.getBoundingClientRect();
        return {
          state,
          role: dialog.getAttribute("role"),
          ariaModal: dialog.getAttribute("aria-modal"),
          horizontalOverflow: overlay.scrollWidth > overlay.clientWidth,
          verticalFit: rect.height <= innerHeight * 0.86,
          withinViewport: rect.left >= 0 && rect.right <= innerWidth,
          text: dialog.textContent,
        };
      }, state);
      expect(metrics).toMatchObject({
        state,
        role: "dialog",
        ariaModal: "true",
        horizontalOverflow: false,
        verticalFit: true,
        withinViewport: true,
      });
      await page.locator("[data-vf-visual-qa-prematch]").screenshot({
        path: path.join(
          artifactDir,
          `${testInfo.project.name}-${theme}-prematch-${state}.png`,
        ),
      });
      prematchProof.push(metrics);
      await page
        .locator("[data-vf-visual-qa-prematch]")
        .evaluate((overlay) => overlay.remove());
    }

    const connectionProof: Array<Record<string, unknown>> = [];
    for (const state of [
      "waiting",
      "synchronizing",
      "restored",
      "fatal",
      "overflow",
    ] as const) {
      const metrics = await page.evaluate(async (state) => {
        const [{ EventBus }, presenterModule, transportModule] =
          await Promise.all([
            // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
            import("/src/core/EventBus.ts"),
            // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
            import("/src/client/ConnectionRecoveryPresenter.ts"),
            // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
            import("/src/client/Transport.ts"),
          ]);
        const backdrop = document.createElement("main");
        backdrop.dataset.vfVisualQaConnection = state;
        backdrop.style.cssText =
          "position:fixed;inset:0;z-index:9999;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif";
        document.body.append(backdrop);
        const bus = new EventBus();
        const presenter = new presenterModule.ConnectionRecoveryPresenter(bus);
        if (state === "waiting") {
          bus.emit(
            new transportModule.TransportConnectionStateEvent(
              "waiting",
              2,
              3,
              1_250,
              "socket-error",
            ),
          );
        } else if (state === "synchronizing") {
          bus.emit(
            new transportModule.TransportConnectionStateEvent(
              "synchronizing",
              2,
              3,
            ),
          );
        } else if (state === "restored") {
          bus.emit(
            new transportModule.TransportConnectionStateEvent(
              "waiting",
              1,
              2,
              250,
              "socket-error",
            ),
          );
          bus.emit(
            new transportModule.TransportConnectionStateEvent("open", 0, 0),
          );
        } else if (state === "fatal") {
          bus.emit(
            new transportModule.TransportConnectionStateEvent(
              "closed",
              1,
              0,
              null,
              "protocol-refused",
            ),
          );
        } else {
          bus.emit(
            new transportModule.TransportOutboxOverflowEvent(
              256,
              256,
              "intent",
            ),
          );
        }
        const element = document.querySelector<HTMLElement>(
          "#connection-recovery-status",
        );
        if (!element) throw new Error("connection presenter did not render");
        const rect = element.getBoundingClientRect();
        (
          window as typeof window & { __vfConnectionCleanup?: () => void }
        ).__vfConnectionCleanup = () => {
          presenter.dispose();
          backdrop.remove();
        };
        return {
          state,
          renderedState: element.dataset.state,
          role: element.getAttribute("role"),
          hidden: element.hidden,
          withinViewport: rect.left >= 0 && rect.right <= innerWidth,
          foregroundZ: Number(getComputedStyle(element).zIndex),
          backdropZ: Number(getComputedStyle(backdrop).zIndex),
          text: element.textContent,
        };
      }, state);
      expect(metrics).toMatchObject({
        state,
        renderedState: state,
        hidden: false,
        withinViewport: true,
      });
      expect(metrics.foregroundZ).toBeGreaterThan(metrics.backdropZ);
      await page.screenshot({
        path: path.join(
          artifactDir,
          `${testInfo.project.name}-${theme}-connection-${state}.png`,
        ),
      });
      connectionProof.push(metrics);
      await page.evaluate(() => {
        const target = window as typeof window & {
          __vfConnectionCleanup?: () => void;
        };
        target.__vfConnectionCleanup?.();
        delete target.__vfConnectionCleanup;
      });
    }

    const narratorProof = await page.evaluate(async () => {
      // @ts-expect-error Vite serves this production TypeScript module to the browser harness.
      const { CertifiedNarratorLayer } =
        await import("/src/client/graphics/layers/CertifiedNarratorLayer.ts");
      const backdrop = document.createElement("main");
      backdrop.dataset.vfVisualQaNarrator = "certified";
      backdrop.style.cssText =
        "position:fixed;inset:0;z-index:30;background:var(--vf-bg,#07111f);color:var(--vf-text,#f8fafc);font-family:Overpass,sans-serif";
      document.body.append(backdrop);
      const layer = new CertifiedNarratorLayer("visual-proof-game") as {
        init(): void;
        present(text: string): void;
        dispose(): void;
      };
      layer.init();
      layer.present("A vault heist was committed.");
      const element = document.querySelector<HTMLElement>(
        "#certified-narrator",
      );
      if (!element) throw new Error("certified narrator did not render");
      const rect = element.getBoundingClientRect();
      (
        window as typeof window & { __vfNarratorCleanup?: () => void }
      ).__vfNarratorCleanup = () => {
        layer.dispose();
        backdrop.remove();
      };
      return {
        authority: element.dataset.authority,
        role: element.getAttribute("role"),
        hidden: element.hidden,
        withinViewport: rect.left >= 0 && rect.right <= innerWidth,
        foregroundZ: Number(getComputedStyle(element).zIndex),
        backdropZ: Number(getComputedStyle(backdrop).zIndex),
        text: element.textContent,
      };
    });
    expect(narratorProof).toMatchObject({
      authority: "accepted-game-intent",
      role: "status",
      hidden: false,
      withinViewport: true,
      text: "A vault heist was committed.",
    });
    expect(narratorProof.foregroundZ).toBeGreaterThan(narratorProof.backdropZ);
    await page.screenshot({
      path: path.join(
        artifactDir,
        `${testInfo.project.name}-${theme}-narrator-certified.png`,
      ),
    });
    await page.evaluate(() => {
      const target = window as typeof window & {
        __vfNarratorCleanup?: () => void;
      };
      target.__vfNarratorCleanup?.();
      delete target.__vfNarratorCleanup;
    });
    results[results.length - 1].prematch = prematchProof;
    results[results.length - 1].connectionRecovery = connectionProof;
    results[results.length - 1].certifiedNarrator = narratorProof;

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
    results[results.length - 1].surfaces = [...THEME_PROOF_SURFACES];
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
