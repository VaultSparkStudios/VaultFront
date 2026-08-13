import { describe, expect, it } from "vitest";
import {
  assessReleaseParityCell,
  summarizeReleaseParity,
} from "../../scripts/lib/release-parity.mjs";

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
