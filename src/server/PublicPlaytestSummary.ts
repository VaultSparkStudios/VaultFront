import type { VaultFrontPlaytestPulseSummary } from "./VaultFrontPlaytestPulse";

export const PUBLIC_PLAYTEST_SMALL_COUNT_THRESHOLD = 5;

export type PublicPlaytestPulseSummary = VaultFrontPlaytestPulseSummary & {
  privacy: {
    smallCountThreshold: number;
    suppressed: boolean;
    cohortBand: "0" | "1-4" | "5+";
  };
};

function zeroRecord<T extends Record<string, number>>(record: T): T {
  return Object.fromEntries(Object.keys(record).map((key) => [key, 0])) as T;
}

/** Public projection aligned with /stats.json: cohorts of one to four are banded. */
export function projectPublicPlaytestSummary(
  summary: VaultFrontPlaytestPulseSummary,
): PublicPlaytestPulseSummary {
  const actors = summary.evidence.uniqueHumanActors;
  const suppressed =
    actors > 0 && actors < PUBLIC_PLAYTEST_SMALL_COUNT_THRESHOLD;
  const privacy = {
    smallCountThreshold: PUBLIC_PLAYTEST_SMALL_COUNT_THRESHOLD,
    suppressed,
    cohortBand: (actors === 0 ? "0" : actors < 5 ? "1-4" : "5+") as
      "0" | "1-4" | "5+",
  };
  if (!suppressed) {
    return { ...summary, recent: [], privacy };
  }

  const checks = Object.fromEntries(
    Object.keys(summary.alphaGate.checks).map((key) => [key, false]),
  ) as VaultFrontPlaytestPulseSummary["alphaGate"]["checks"];
  return {
    ...summary,
    status: "warming",
    score: 0,
    totals: zeroRecord(summary.totals),
    rates: zeroRecord(summary.rates),
    freshness: { firstEventAt: null, lastEventAt: null, ageMinutes: null },
    recent: [],
    evidence: {
      acceptedHumanEvents: 0,
      uniqueHumanSessions: 0,
      uniqueHumanActors: 0,
      duplicateEvents: 0,
      rejectedEvents: 0,
      excludedBySource: zeroRecord(summary.evidence.excludedBySource),
    },
    insights: [
      "Early human playtest evidence is withheld until the public reporting threshold is met.",
    ],
    actionInsights: [
      "Continue the private Alpha cohort; public aggregates unlock at five distinct human actors.",
    ],
    operatorNext: {
      headline: "Continue the private Alpha cohort.",
      steps: [
        "Collect authenticated playtest evidence without publishing small-cohort behavior.",
      ],
      successMetric:
        "Reach five distinct human actors before publishing exact aggregates.",
    },
    alphaGate: {
      status: "warming",
      checks,
      passLabel: "Below the public small-count threshold.",
      nextCheck: "Collect evidence from at least five distinct human actors.",
    },
    privacy,
  };
}
