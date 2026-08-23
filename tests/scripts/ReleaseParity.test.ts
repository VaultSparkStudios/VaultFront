import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessReleaseParityCell,
  summarizeReleaseParity,
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
    expect(capture).toContain("allowedThemes.includes(requestedTheme)");
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
    expect(summarizeReleaseParity(cells)).toEqual({
      pass: false,
      cellCount: 2,
      findingCount: 1,
      worst: { lcpMs: 1700, inpMs: 190, cls: 0.09 },
    });
  });
});
