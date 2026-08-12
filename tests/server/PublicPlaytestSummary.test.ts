import { describe, expect, it } from "vitest";
import { projectPublicPlaytestSummary } from "../../src/server/PublicPlaytestSummary";
import { buildVaultFrontPlaytestPulseSummaryFromEvents } from "../../src/server/VaultFrontPlaytestPulse";

function summaryForActors(count: number) {
  return buildVaultFrontPlaytestPulseSummaryFromEvents(
    Array.from({ length: count }, (_, index) => ({
      surface: "tutorial" as const,
      event: "shown",
      value: 1 as const,
      at: 1_000 + index,
      evidenceSessionId: `session-${index}`,
      eventId: `event-${index}`,
      source: "human" as const,
      actorKey: `actor-${index}`,
    })),
    2_000,
  );
}

describe("public playtest projection", () => {
  it("bands small cohorts and suppresses behavior, rates, time, and timeline", () => {
    const projected = projectPublicPlaytestSummary(summaryForActors(3));
    expect(projected.privacy).toEqual({
      smallCountThreshold: 5,
      suppressed: true,
      cohortBand: "1-4",
    });
    expect(projected.evidence.uniqueHumanActors).toBe(0);
    expect(projected.totals.tutorialShown).toBe(0);
    expect(projected.freshness.lastEventAt).toBeNull();
    expect(projected.recent).toEqual([]);
    expect(projected.alphaGate.passLabel).toContain("threshold");
  });

  it("publishes aggregates at threshold but never publishes recent event timelines", () => {
    const projected = projectPublicPlaytestSummary(summaryForActors(5));
    expect(projected.privacy.suppressed).toBe(false);
    expect(projected.evidence.uniqueHumanActors).toBe(5);
    expect(projected.totals.tutorialShown).toBe(5);
    expect(projected.recent).toEqual([]);
  });
});
