import { describe, expect, it } from "vitest";
import {
  deriveTrustCriticalCoverageOwners,
  evaluateCoverage,
} from "../../scripts/check-coverage-ratchet.mjs";

const metric = (pct: number) => ({ total: 100, covered: pct, pct });
const coverage = (pct: number) => ({
  lines: metric(pct),
  statements: metric(pct),
  functions: metric(pct),
  branches: metric(pct),
});

describe("coverage ratchet", () => {
  const baseline = {
    tolerance: 0.1,
    global: { lines: 50, statements: 50, functions: 50, branches: 50 },
    observedModules: ["src/server/Worker.ts"],
    criticalModules: {
      "src/server/Critical.ts": {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  };

  it("accepts global and critical coverage at the checked-in floors", () => {
    const result = evaluateCoverage(
      {
        "C:\\repo\\src\\server\\Worker.ts": coverage(0),
        total: coverage(50),
        "C:\\repo\\src\\server\\Critical.ts": coverage(80),
      },
      baseline,
    );
    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("reports regressions and missing critical modules", () => {
    const result = evaluateCoverage({ total: coverage(49) }, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("global lines: 49.00% < 50.00% floor");
    expect(result.failures).toContain(
      "src/server/Critical.ts: missing from coverage report",
    );
    expect(result.failures).toContain(
      "src/server/Worker.ts: missing from production coverage surface",
    );
  });

  it("fails closed when a derived trust owner has no measured floor", () => {
    const result = evaluateCoverage(
      {
        "C:\\repo\\src\\server\\Worker.ts": coverage(0),
        total: coverage(50),
        "C:\\repo\\src\\server\\Critical.ts": coverage(80),
      },
      baseline,
      ["src/server/Critical.ts", "src/server/NewAuthOwner.ts"],
    );
    expect(result.failures).toContain(
      "src/server/NewAuthOwner.ts: missing trust-critical baseline floor",
    );
  });

  it("derives owners from live state, route-policy, auth, and release contracts", () => {
    const owners = deriveTrustCriticalCoverageOwners(process.cwd());
    expect(owners).toEqual(
      expect.arrayContaining([
        "src/server/ObeliskAuth.ts",
        "src/server/PlaytestEvidenceStore.ts",
        "src/server/RemoteAiPolicy.ts",
        "src/server/ReplayStore.ts",
        "src/server/WorkerApiProxy.ts",
      ]),
    );
  });
});
