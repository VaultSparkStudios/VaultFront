import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessReleaseParityCell,
  RELEASE_PARITY_EXPECTED_CELL_COUNT,
  RELEASE_PARITY_THEMES,
  RELEASE_PARITY_VIEWPORTS,
  summarizeReleaseParity,
  validateReleaseParityMatrix,
} from "../../scripts/lib/release-parity.mjs";
import { spawnSync } from "../../scripts/lib/safe-spawn.mjs";

const healthyCell = {
  vitals: { lcpMs: 1200, inpMs: 80, cls: 0.01 },
  dom: {
    horizontalOverflowPx: 0,
    navigationReachable: true,
    smallTargets: [],
  },
  securityHeaders: {
    strictTransportSecurity: "max-age=31536000",
    contentSecurityPolicy: "default-src 'self'",
  },
};

describe("release parity assessment", () => {
  it("keeps the executable capture script syntactically valid", () => {
    const result = spawnSync(
      process.execPath,
      ["--check", path.resolve("scripts/capture-release-parity.mjs")],
      { encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("pins both public-shell and game-settings theme authorities", () => {
    const capture = fs.readFileSync(
      path.resolve("scripts/capture-release-parity.mjs"),
      "utf8",
    );
    expect(capture).toContain(
      'localStorage.setItem("vf-theme", selectedTheme)',
    );
    expect(capture).toContain(
      'localStorage.setItem("settings.brandTheme", selectedTheme)',
    );
  });

  it("owns unexpected dialog dismissal so browser teardown cannot reject it", () => {
    const capture = fs.readFileSync(
      path.resolve("scripts/capture-release-parity.mjs"),
      "utf8",
    );
    expect(capture).toContain('page.on("dialog"');
    expect(capture).toContain("pendingDialogDismissals");
    expect(capture).toContain("Promise.allSettled");
    expect(capture).toContain("closingContext");
    expect(capture).toContain("page.isClosed()");
  });

  it("retains bounded element-level diagnostics without changing thresholds", () => {
    const capture = fs.readFileSync(
      path.resolve("scripts/capture-release-parity.mjs"),
      "utf8",
    );
    expect(capture).toContain("lcpEntries");
    expect(capture).toContain("layoutShifts");
    expect(capture).toContain(".slice(-20)");
    expect(capture).toContain(".slice(0, 10)");
    expect(capture).toContain("responseStartMs");
    expect(capture).toContain("domainLookupStartMs");
    expect(capture).toContain("secureConnectionStartMs");
    expect(capture).toContain("requestStartMs");
    expect(capture).toContain("allowedWidths.includes(width)");
    expect(capture).toContain("RELEASE_PARITY_THEMES.includes(requestedTheme)");
  });

  it("owns the full CANON-041 device-width and orientation matrix", () => {
    expect(RELEASE_PARITY_VIEWPORTS.map((viewport) => viewport.id)).toEqual([
      "phone-360-portrait",
      "phone-360-landscape",
      "phone-390-portrait",
      "phone-390-landscape",
      "phone-414-portrait",
      "phone-414-landscape",
      "tablet-768-portrait",
      "tablet-768-landscape",
      "desktop-1440",
    ]);
    expect(RELEASE_PARITY_EXPECTED_CELL_COUNT).toBe(27);
  });

  it("requires every theme, device width, and orientation exactly once", () => {
    const healthyDrawer = {
      visible: true,
      containedInViewport: true,
      scrollRegionPresent: true,
      scrollableWhenNeeded: true,
      dynamicViewportHeight: true,
      safeAreaPadding: true,
      closeReachable: true,
      scrollLockActive: true,
      scrollLockReleased: true,
      closedAriaSynchronized: true,
    };
    const cells = RELEASE_PARITY_THEMES.flatMap((theme) =>
      RELEASE_PARITY_VIEWPORTS.map((viewport) => {
        const cell = {
          ...healthyCell,
          ...viewport,
          viewportId: viewport.id,
          theme,
          dom: {
            ...healthyCell.dom,
            reducedMotionRespected: true,
            mobileDrawer: viewport.width < 1024 ? healthyDrawer : null,
          },
        };
        return { ...cell, assessment: assessReleaseParityCell(cell) };
      }),
    );
    expect(validateReleaseParityMatrix(cells)).toEqual({
      pass: true,
      expectedCellCount: 27,
      observedCellCount: 27,
      errors: [],
    });
    expect(summarizeReleaseParity(cells)).toMatchObject({
      pass: true,
      cellCount: 27,
      findingCount: 0,
      matrix: { pass: true },
    });
    expect(validateReleaseParityMatrix(cells.slice(1)).errors).toContain(
      "missing-cell:vaultfront:phone-360-portrait",
    );
  });

  it("binds drawer capture to dynamic viewport, safe-area, close, and lock evidence", () => {
    const capture = fs.readFileSync(
      path.resolve("scripts/capture-release-parity.mjs"),
      "utf8",
    );
    const index = fs.readFileSync(path.resolve("index.html"), "utf8");
    const mobileNav = fs.readFileSync(
      path.resolve("src/client/components/MobileNavBar.ts"),
      "utf8",
    );
    const layout = fs.readFileSync(
      path.resolve("src/client/Layout.ts"),
      "utf8",
    );
    expect(index).toContain("h-dvh");
    expect(index).toContain("#sidebar-menu.open");
    expect(index).toContain("transform: translateX(0)");
    expect(index).toContain("desktop-nav-bar .nav-menu-item");
    expect(index).toContain("min-height: 44px");
    expect(mobileNav).toContain("data-mobile-nav-scroll-region");
    expect(mobileNav).toContain('id="mobile-menu-close"');
    expect(mobileNav).toContain("min-h-11 min-w-11");
    expect(layout).toContain('clickedElement?.id === "mobile-menu-close"');
    for (const invariant of [
      "dynamicViewportHeight",
      "safeAreaPadding",
      "closeReachable",
      "closeControlRect",
      "scrollLockActive",
      "scrollLockReleased",
      "closedAriaSynchronized",
      "reducedMotionRespected",
    ])
      expect(capture).toContain(invariant);
    expect(capture).toContain("sidebarRect.left >= -1");
    expect(capture).toContain("sidebarRect.right <= innerWidth + 1");
    expect(capture).toContain("Math.min(innerWidth * 0.82, 384)");
    expect(capture).toContain("Math.abs(rect.left) <= 1");
    expect(capture).toContain("Math.round(closeRect.width)");
    expect(capture).toContain("closeRect.right <= innerWidth + 1");
    expect(capture).toContain("/^[0-9a-f]{40}$/i.test(candidateRevision)");
    expect(capture).toContain('waitUntil: "domcontentloaded"');
    expect(capture).toContain("Page.captureScreenshot");
    expect(capture).toContain('return "cdp-font-timeout-fallback"');
  });

  it("passes measured CWV, responsive, and security-header evidence", () => {
    expect(assessReleaseParityCell(healthyCell)).toEqual({
      pass: true,
      findings: [],
    });
  });

  it("names every independent failed release invariant", () => {
    expect(
      assessReleaseParityCell({
        vitals: { lcpMs: 1800, inpMs: 201, cls: 0.101 },
        dom: {
          horizontalOverflowPx: 12,
          navigationReachable: false,
          smallTargets: [{ label: "Menu", width: 40, height: 40 }],
        },
        securityHeaders: {},
      }).findings,
    ).toEqual([
      "lcp-1800ms",
      "inp-201ms",
      "cls-0.101",
      "horizontal-overflow-12px",
      "navigation-unreachable",
      "small-targets-1",
      "hsts-missing",
      "csp-missing",
    ]);
  });

  it("summarizes the worst measured cell without hiding failures", () => {
    const cells = [
      {
        ...healthyCell,
        assessment: assessReleaseParityCell(healthyCell),
      },
      {
        ...healthyCell,
        vitals: { lcpMs: 1700, inpMs: 190, cls: 0.09 },
        assessment: { pass: false, findings: ["navigation-unreachable"] },
      },
    ];
    expect(summarizeReleaseParity(cells)).toMatchObject({
      pass: false,
      cellCount: 2,
      findingCount: 1,
      worst: { lcpMs: 1700, inpMs: 190, cls: 0.09 },
      matrix: { pass: false, expectedCellCount: 27, observedCellCount: 2 },
    });
  });
});
