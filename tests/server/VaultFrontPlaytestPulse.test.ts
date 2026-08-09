import { beforeEach, describe, expect, it } from "vitest";
import {
  attachCertifiedLoopAlphaEvidence,
  buildVaultFrontPlaytestPulseSummary,
  buildVaultFrontPlaytestPulseSummaryFromEvents,
  isAllowedVaultFrontPulseEvent,
  recordVaultFrontPlaytestPulse,
  resetVaultFrontPlaytestPulseForTests,
  type VaultFrontPlaytestPulseEvent,
} from "../../src/server/VaultFrontPlaytestPulse";

let humanEventSequence = 0;
function recordHumanEvidence(
  input: Omit<
    VaultFrontPlaytestPulseEvent,
    "source" | "actorKey" | "evidenceSessionId" | "eventId"
  >,
  fixtureId = "default",
) {
  return recordVaultFrontPlaytestPulse({
    ...input,
    value: 1,
    source: "human",
    actorKey: `human-actor-fixture-${fixtureId}`,
    evidenceSessionId: `human-session-fixture-${fixtureId}`,
    eventId: `human-event-fixture-${fixtureId}-${humanEventSequence++}`,
  });
}
describe("VaultFront playtest pulse", () => {
  beforeEach(() => {
    resetVaultFrontPlaytestPulseForTests();
  });

  it("starts with no live alpha signal", () => {
    const summary = buildVaultFrontPlaytestPulseSummary(1_000);

    expect(summary.status).toBe("no-signal");
    expect(summary.score).toBe(0);
    expect(summary.freshness.lastEventAt).toBeNull();
    expect(summary.actionInsights[0]).toContain(
      "Run one guided internal match",
    );
    expect(summary.operatorNext.headline).toContain("guided first-match");
    expect(summary.operatorNext.steps.join(" ")).toContain("tutorial strip");
    expect(summary.alphaGate.status).toBe("not-started");
    expect(summary.alphaGate.nextCheck).toContain("Refresh playtest evidence");
  });

  it("aggregates tutorial, match, tournament, and retention signals", () => {
    recordHumanEvidence({
      surface: "tutorial",
      event: "shown",
      at: 10_000,
    });
    recordHumanEvidence({
      surface: "tutorial",
      event: "advance",
      at: 10_500,
    });
    recordHumanEvidence({
      surface: "tutorial",
      event: "complete",
      at: 11_000,
    });
    recordHumanEvidence({
      surface: "match",
      event: "feedback_epic",
      at: 12_000,
    });
    recordHumanEvidence({
      surface: "tournament",
      event: "seed_bracket",
      at: 13_000,
    });
    recordHumanEvidence({
      surface: "retention",
      event: "rival_challenge_shown",
      at: 14_000,
    });
    const summary = buildVaultFrontPlaytestPulseSummary(15_000);

    expect(summary.status).toBe("ready");
    expect(summary.totals.tutorialShown).toBe(1);
    expect(summary.totals.tutorialAdvanced).toBe(1);
    expect(summary.totals.tutorialCompleted).toBe(1);
    expect(summary.totals.matchFeedback).toBe(1);
    expect(summary.totals.tournamentActions).toBe(1);
    expect(summary.totals.retentionSignals).toBe(1);
    expect(summary.totals.retentionChallengeShown).toBe(1);
    expect(summary.rates.tutorialAdvance).toBe(1);
    expect(summary.rates.tutorialCompletion).toBe(1);
    expect(summary.insights.join(" ")).toContain("post-match feedback");
    expect(summary.actionInsights.join(" ")).toContain("not converting");
    expect(summary.operatorNext.successMetric).toContain(
      "Rival Challenge action rate",
    );
    expect(summary.alphaGate.status).toBe("warming");
    expect(summary.alphaGate.checks.rivalExposure).toBe(true);
    expect(summary.alphaGate.checks.rivalAction).toBe(false);
    expect(summary.alphaGate.nextCheck).toContain("Rival Challenge action");
  });

  it("calculates Rival Challenge action conversion", () => {
    recordHumanEvidence({
      surface: "retention",
      event: "rival_challenge_shown",
      at: 20_000,
    });
    recordHumanEvidence({
      surface: "retention",
      event: "rival_requeue_clicked",
      at: 21_000,
    });
    recordHumanEvidence({
      surface: "match",
      event: "feedback_epic",
      at: 21_500,
    });
    const summary = buildVaultFrontPlaytestPulseSummary(22_000);

    expect(summary.totals.retentionChallengeShown).toBe(1);
    expect(summary.totals.retentionRequeued).toBe(1);
    expect(summary.rates.retentionAction).toBe(1);
    expect(summary.actionInsights.join(" ")).toContain(
      "focused rivalry/rematch",
    );
    expect(summary.operatorNext.steps.join(" ")).toContain(
      "guided rivalry scenario",
    );
    expect(summary.alphaGate.status).toBe("warming");
    expect(summary.alphaGate.checks.rivalAction).toBe(true);
    expect(summary.alphaGate.nextCheck).toContain("Prove onboarding");
  });

  it("turns stale activity into an operator refresh script", () => {
    recordHumanEvidence({
      surface: "tutorial",
      event: "shown",
      at: 1_000,
    });

    const summary = buildVaultFrontPlaytestPulseSummary(25 * 60 * 60 * 1000);

    expect(summary.actionInsights.join(" ")).toContain("older than 24 hours");
    expect(summary.operatorNext.steps.length).toBeGreaterThanOrEqual(3);
    expect(summary.alphaGate.status).toBe("blocked");
    expect(summary.alphaGate.checks.fresh).toBe(false);
    expect(summary.alphaGate.nextCheck).toContain("older than 24 hours");
  });

  it("marks the alpha gate ready when the full rivalry/rematch sample is fresh", () => {
    for (let actor = 1; actor <= 3; actor += 1) {
      const fixtureId = String(actor);
      recordHumanEvidence(
        { surface: "tutorial", event: "shown", at: 10_000 },
        fixtureId,
      );
      recordHumanEvidence(
        { surface: "tutorial", event: "advance", at: 11_000 },
        fixtureId,
      );
      recordHumanEvidence(
        { surface: "tutorial", event: "complete", at: 12_000 },
        fixtureId,
      );
      recordHumanEvidence(
        { surface: "match", event: "feedback_epic", at: 13_000 },
        fixtureId,
      );
      recordHumanEvidence(
        { surface: "tournament", event: "seed_bracket", at: 13_500 },
        fixtureId,
      );
      recordHumanEvidence(
        { surface: "retention", event: "rival_challenge_shown", at: 14_000 },
        fixtureId,
      );
      recordHumanEvidence(
        {
          surface: "retention",
          event: "rival_rematch_requested",
          at: 15_000,
        },
        fixtureId,
      );
    }
    const summary = buildVaultFrontPlaytestPulseSummary(16_000);

    expect(summary.status).toBe("ready");
    expect(summary.alphaGate.status).toBe("ready");
    expect(summary.alphaGate.checks).toEqual({
      fresh: true,
      sampleSize: true,
      tutorial: true,
      feedback: true,
      rivalExposure: true,
      rivalAction: true,
    });
    expect(summary.alphaGate.passLabel).toContain("Alpha gate passed");

    const unavailable = attachCertifiedLoopAlphaEvidence(summary, null, 16_000);
    expect(unavailable.alphaGate.status).toBe("warming");
    expect(unavailable.alphaGate.checks.certifiedOrderedLoop).toBe(false);
    expect(unavailable.alphaGate.nextCheck).toContain("unavailable");

    const certifiedEvidence = {
      windowStartAt: 0,
      windowEndAt: 16_000,
      latestEvidenceAt: 15_000,
      vaultParticipants: 1,
      outcomeParticipants: 1,
      pressureParticipants: 1,
      breachParticipants: 1,
      decisiveDeliveryParticipants: 1,
      certifiedLoopParticipants: 1,
    };
    const certified = attachCertifiedLoopAlphaEvidence(
      summary,
      certifiedEvidence,
      16_000,
    );
    expect(certified.alphaGate.status).toBe("ready");
    expect(certified.alphaGate.checks).toMatchObject({
      certifiedCapture: true,
      certifiedConvoyOutcome: true,
      certifiedPressure: true,
      certifiedBreach: true,
      certifiedDecisiveDelivery: true,
      certifiedOrderedLoop: true,
    });
    expect(certified.alphaGate.passLabel).toContain("server-certified");

    const missingPressure = attachCertifiedLoopAlphaEvidence(
      summary,
      { ...certifiedEvidence, pressureParticipants: 0 },
      16_000,
    );
    expect(missingPressure.alphaGate.status).toBe("warming");
    expect(missingPressure.alphaGate.checks.certifiedPressure).toBe(false);
    expect(missingPressure.alphaGate.nextCheck).toContain("Pressure");

    const stale = attachCertifiedLoopAlphaEvidence(
      summary,
      {
        ...certifiedEvidence,
        windowStartAt: 60 * 60 * 1000,
        windowEndAt: 25 * 60 * 60 * 1000,
        latestEvidenceAt: 1,
      },
      25 * 60 * 60 * 1000,
    );
    expect(stale.alphaGate.status).toBe("blocked");
    expect(stale.alphaGate.nextCheck).toContain("within 24 hours");
  });
  it("deduplicates event ids and excludes non-human sources from the gate", () => {
    const shared = {
      surface: "tutorial" as const,
      event: "shown",
      value: 1 as const,
      at: 10_000,
      evidenceSessionId: "human-session-dedupe",
      eventId: "human-event-dedupe",
      source: "human" as const,
      actorKey: "human-evidence-dedupe",
    };
    recordVaultFrontPlaytestPulse(shared);
    recordVaultFrontPlaytestPulse(shared);
    recordVaultFrontPlaytestPulse({
      surface: "tutorial",
      event: "shown",
      value: 1,
      at: 11_000,
      evidenceSessionId: "agent-session",
      eventId: "agent-event-0001",
      source: "agent",
      actorKey: "agent-fixture",
    });

    const summary = buildVaultFrontPlaytestPulseSummary(12_000);
    expect(summary.totals.events).toBe(1);
    expect(summary.evidence.uniqueHumanSessions).toBe(1);
    expect(summary.evidence.duplicateEvents).toBe(1);
    expect(summary.evidence.excludedBySource.agent).toBe(1);
  });

  it("rejects caller-selected weights and unknown event names", () => {
    recordVaultFrontPlaytestPulse({
      surface: "match",
      event: "feedback_epic",
      value: 50,
      source: "human",
      actorKey: "human-evidence-invalid",
      evidenceSessionId: "human-session-invalid",
      eventId: "human-event-invalid-1",
    } as unknown as VaultFrontPlaytestPulseEvent);
    recordVaultFrontPlaytestPulse({
      surface: "match",
      event: "caller_selected_claim",
      source: "human",
      actorKey: "human-evidence-invalid",
      evidenceSessionId: "human-session-invalid",
      eventId: "human-event-invalid-2",
    });

    const summary = buildVaultFrontPlaytestPulseSummary();
    expect(summary.totals.events).toBe(0);
    expect(summary.evidence.rejectedEvents).toBe(2);
    expect(summary.alphaGate.status).toBe("not-started");
  });

  it("defaults source, eventId, and evidenceSessionId when the caller omits them", () => {
    recordVaultFrontPlaytestPulse({ surface: "tutorial", event: "shown" });

    const summary = buildVaultFrontPlaytestPulseSummary(5_000);
    expect(summary.evidence.excludedBySource.system).toBe(1);
    expect(summary.totals.events).toBe(0);
  });

  it("rejects a human event with no actorKey", () => {
    recordVaultFrontPlaytestPulse({
      surface: "match",
      event: "feedback_epic",
      source: "human",
      evidenceSessionId: "human-session-no-actor",
      eventId: "human-event-no-actor",
    });

    const summary = buildVaultFrontPlaytestPulseSummary();
    expect(summary.totals.events).toBe(0);
    expect(summary.evidence.rejectedEvents).toBe(1);
  });

  it("rejects a human event whose actorKey conflicts with the session's established actor", () => {
    recordVaultFrontPlaytestPulse({
      surface: "match",
      event: "feedback_epic",
      source: "human",
      actorKey: "human-actor-first",
      evidenceSessionId: "human-session-conflict",
      eventId: "human-event-conflict-1",
    });
    recordVaultFrontPlaytestPulse({
      surface: "match",
      event: "feedback_epic",
      source: "human",
      actorKey: "human-actor-second",
      evidenceSessionId: "human-session-conflict",
      eventId: "human-event-conflict-2",
    });

    const summary = buildVaultFrontPlaytestPulseSummary();
    expect(summary.totals.events).toBe(1);
    expect(summary.evidence.rejectedEvents).toBe(1);
  });

  it("counts tutorial skip and rival goal-saved events", () => {
    recordHumanEvidence({ surface: "tutorial", event: "shown", at: 1_000 });
    recordHumanEvidence({ surface: "tutorial", event: "skip", at: 1_100 });
    recordHumanEvidence({
      surface: "retention",
      event: "rival_goal_saved",
      at: 1_200,
    });

    const summary = buildVaultFrontPlaytestPulseSummary(2_000);
    expect(summary.totals.tutorialSkipped).toBe(1);
    expect(summary.totals.retentionGoalSaved).toBe(1);
  });

  it("evicts the oldest seen event id once the dedupe window exceeds 20,000 entries", () => {
    for (let i = 0; i < 20_001; i += 1) {
      recordVaultFrontPlaytestPulse({
        surface: "tutorial",
        event: "shown",
        source: "system",
        eventId: `overflow-event-${i}`,
        evidenceSessionId: `overflow-session-${i}`,
      });
    }
    // The very first eventId should have been evicted, so replaying it is
    // accepted again instead of being treated as a duplicate.
    recordVaultFrontPlaytestPulse({
      surface: "tutorial",
      event: "shown",
      source: "system",
      eventId: "overflow-event-0",
      evidenceSessionId: "overflow-session-replay",
    });

    const summary = buildVaultFrontPlaytestPulseSummary();
    expect(summary.evidence.duplicateEvents).toBe(0);
  }, 15_000);

  it("suggests seeding a rivalry scenario once pulse activity is broad but rivalry exposure is zero", () => {
    for (let i = 0; i < 10; i += 1) {
      recordHumanEvidence(
        { surface: "match", event: "feedback_epic", at: 1_000 + i },
        `broad-${i}`,
      );
    }

    const summary = buildVaultFrontPlaytestPulseSummary(2_000);
    expect(summary.totals.retentionChallengeShown).toBe(0);
    expect(summary.totals.events).toBeGreaterThanOrEqual(10);
    expect(summary.actionInsights.join(" ")).toContain(
      "seed a rivalry scenario",
    );
    expect(summary.operatorNext.headline).toContain(
      "Seed a rivalry rematch scenario",
    );
  });

  it("builds a cohort summary directly from an event list without touching process state", () => {
    const events: VaultFrontPlaytestPulseEvent[] = [
      {
        surface: "tutorial",
        event: "shown",
        source: "human",
        actorKey: "cohort-actor",
        evidenceSessionId: "cohort-session",
        eventId: "cohort-event-1",
        at: 1_000,
      },
    ];

    const summary = buildVaultFrontPlaytestPulseSummaryFromEvents(
      events,
      2_000,
      "process-local",
    );
    expect(summary.totals.tutorialShown).toBe(1);
    expect(summary.durability).toBe("process-local");

    // Confirms this call path never mutated the shared process-local state.
    const isolated = buildVaultFrontPlaytestPulseSummary(2_000);
    expect(isolated.totals.tutorialShown).toBe(0);
  });

  it.each([
    ["vaultParticipants", "Vault capture"],
    ["outcomeParticipants", "convoy delivery or loss"],
    ["breachParticipants", "certified Breach"],
    ["decisiveDeliveryParticipants", "decisive delivery before the Breach"],
    ["certifiedLoopParticipants", "in order in one certified player timeline"],
  ] as const)(
    "names the next certified stage to complete when only %s is zero",
    (zeroField, expectedSubstring) => {
      for (let actor = 1; actor <= 3; actor += 1) {
        const fixtureId = `stage-${zeroField}-${actor}`;
        recordHumanEvidence(
          { surface: "tutorial", event: "shown", at: 10_000 },
          fixtureId,
        );
        recordHumanEvidence(
          { surface: "tutorial", event: "advance", at: 11_000 },
          fixtureId,
        );
        recordHumanEvidence(
          { surface: "tutorial", event: "complete", at: 12_000 },
          fixtureId,
        );
        recordHumanEvidence(
          { surface: "match", event: "feedback_epic", at: 13_000 },
          fixtureId,
        );
        recordHumanEvidence(
          { surface: "retention", event: "rival_challenge_shown", at: 14_000 },
          fixtureId,
        );
        recordHumanEvidence(
          {
            surface: "retention",
            event: "rival_rematch_requested",
            at: 15_000,
          },
          fixtureId,
        );
      }
      const summary = buildVaultFrontPlaytestPulseSummary(16_000);
      expect(summary.alphaGate.status).toBe("ready");

      const certifiedEvidence = {
        windowStartAt: 0,
        windowEndAt: 16_000,
        latestEvidenceAt: 15_000,
        vaultParticipants: 1,
        outcomeParticipants: 1,
        pressureParticipants: 1,
        breachParticipants: 1,
        decisiveDeliveryParticipants: 1,
        certifiedLoopParticipants: 1,
        [zeroField]: 0,
      };

      const result = attachCertifiedLoopAlphaEvidence(
        summary,
        certifiedEvidence,
        16_000,
      );
      expect(result.alphaGate.status).toBe("warming");
      expect(result.alphaGate.nextCheck).toContain(expectedSubstring);
    },
  );

  it("validates event shape without recording via isAllowedVaultFrontPulseEvent", () => {
    expect(
      isAllowedVaultFrontPulseEvent({
        surface: "tutorial",
        event: "shown",
        value: 1,
      }),
    ).toBe(true);
    expect(
      isAllowedVaultFrontPulseEvent({ surface: "tutorial", event: "shown" }),
    ).toBe(true);
    expect(
      isAllowedVaultFrontPulseEvent({
        surface: "tutorial",
        event: "not_a_real_event",
        value: 1,
      }),
    ).toBe(false);
    expect(
      isAllowedVaultFrontPulseEvent({
        surface: "tutorial",
        event: "shown",
        value: 50 as unknown as 1,
      }),
    ).toBe(false);
  });
});
