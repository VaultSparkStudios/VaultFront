import type { VaultFrontPlaytestPulseSummary } from "./VaultFrontPlaytestPulse";
import type { VaultFrontReadinessPayload } from "./VaultFrontReadiness";

export interface VaultFrontAlphaGateRunbook {
  title: string;
  status: VaultFrontPlaytestPulseSummary["alphaGate"]["status"];
  readinessStatus: VaultFrontReadinessPayload["checks"]["playtestPulse"];
  headline: string;
  checklist: string[];
  successCriteria: string[];
  evidenceFields: string[];
  warnings: string[];
}

const CHECK_LABELS: Record<
  keyof VaultFrontPlaytestPulseSummary["alphaGate"]["checks"],
  string
> = {
  fresh: "Fresh evidence within 24 hours",
  sampleSize: "Evidence from at least three authenticated human actors",
  tutorial: "Tutorial advance 50%+ and completion 35%+",
  feedback: "At least one post-match feedback signal",
  rivalExposure: "Rival Challenge card shown",
  rivalAction: "Rival Challenge action rate 25%+",
  certifiedCapture: "Fresh server-certified Vault capture",
  certifiedConvoyOutcome: "Fresh server-certified convoy outcome",
  certifiedPressure: "Fresh server-certified Vault Pressure",
  certifiedBreach: "Fresh server-certified Breach opening",
  certifiedDecisiveDelivery: "Fresh server-certified decisive delivery",
  certifiedOrderedLoop:
    "One fresh ordered Capture-to-decisive-delivery player timeline",
};

export function buildVaultFrontAlphaGateRunbook(input: {
  pulse: VaultFrontPlaytestPulseSummary;
  readiness: VaultFrontReadinessPayload;
}): VaultFrontAlphaGateRunbook {
  const { pulse, readiness } = input;
  const failedChecks = Object.entries(pulse.alphaGate.checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key as keyof typeof pulse.alphaGate.checks);
  const checkRows = Object.entries(pulse.alphaGate.checks).map(
    ([key, passed]) =>
      `${passed ? "PASS" : "TODO"} - ${CHECK_LABELS[key as keyof typeof CHECK_LABELS]}`,
  );
  const warnings: string[] = [];

  if (readiness.checks.playtestPulse !== "pass") {
    warnings.push("Readiness still treats playtest-pulse as a warning.");
  }
  if (readiness.checks.revenueSignal !== "pass") {
    warnings.push(
      "Revenue remains unverified; do not clear the revenue warning from alpha-gate evidence.",
    );
  }
  if (pulse.alphaGate.status !== "ready") {
    warnings.push(pulse.alphaGate.nextCheck);
  }

  return {
    title: "VaultFront Alpha Gate Operator Runbook",
    status: pulse.alphaGate.status,
    readinessStatus: readiness.checks.playtestPulse,
    headline:
      pulse.alphaGate.status === "ready"
        ? "Alpha gate evidence is complete; preserve freshness before launch review."
        : pulse.operatorNext.headline,
    checklist: [...pulse.operatorNext.steps, ...checkRows],
    successCriteria: [
      pulse.operatorNext.successMetric,
      pulse.alphaGate.passLabel,
      "Readiness playtest-pulse check is pass before any alpha clearance.",
    ],
    evidenceFields: [
      `alphaGate.status=${pulse.alphaGate.status}`,
      `alphaGate.nextCheck=${pulse.alphaGate.nextCheck}`,
      `freshness.ageMinutes=${pulse.freshness.ageMinutes ?? "none"}`,
      `rates.tutorialAdvance=${pulse.rates.tutorialAdvance}`,
      `rates.tutorialCompletion=${pulse.rates.tutorialCompletion}`,
      `rates.matchFeedback=${pulse.rates.matchFeedback}`,
      `rates.retentionAction=${pulse.rates.retentionAction}`,
      `failedChecks=${failedChecks.length ? failedChecks.join(",") : "none"}`,
    ],
    warnings,
  };
}
