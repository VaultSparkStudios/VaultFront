import { describe, expect, it } from "vitest";
import { resolveTestSignal } from "../../scripts/lib/test-signal.mjs";

describe("chronological test evidence", () => {
  it("keeps the latest complete authority while a newer attempt is inconclusive", () => {
    const signal = resolveTestSignal({
      testsPassing: 288,
      testsTotal: 288,
      testsLastRun: "2026-08-16",
      testsAssertionsPassing: 1501,
      testsAssertionsTotal: 1501,
      testsAssertionsLastRun: "2026-08-16",
      testsLatestAttempt: {
        at: "2026-08-22",
        state: "inconclusive",
        passingFiles: 32,
        totalFiles: 290,
        passingAssertions: 231,
        reason: "worker-start exhaustion",
      },
    });

    expect(signal.state).toBe("bounded");
    expect(signal.ok).toBe(false);
    expect(signal.detail).toContain("latest complete: 288/288 files");
    expect(signal.detail).toContain("newer attempt 2026-08-22 INCONCLUSIVE");
    expect(signal.detail).toContain("32/290 files");
  });

  it("keeps a newer assertion failure red", () => {
    const signal = resolveTestSignal({
      testsPassing: 288,
      testsTotal: 288,
      testsLastRun: "2026-08-16",
      testsLatestAttempt: {
        at: "2026-08-23",
        state: "red",
        reason: "one assertion failed",
      },
    });

    expect(signal.state).toBe("red");
    expect(signal.detail).toContain("newer attempt 2026-08-23 RED");
  });
});
