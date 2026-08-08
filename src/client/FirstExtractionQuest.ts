export const FIRST_EXTRACTION_TITLE = "First Extraction";

export const VAULTFRONT_VICTORY_LOOP = {
  summary:
    "Capture a vault, deliver or disrupt its convoy, build Vault Pressure, then deliver during the Breach Window to win.",
  pressureRule:
    "Three convoy deliveries open a 90-second Breach Window. Deliver one more convoy before it closes to win.",
} as const;

export const FIRST_EXTRACTION_CONVOY_ACTION_LABEL =
  "Engage one Vault Convoy — deliver, shield, or intercept";

const FIRST_EXTRACTION_CONVOY_ACTIVITIES = new Set([
  "convoy_delivered",
  "convoy_escorted",
  "convoy_intercepted",
]);

export function isFirstExtractionConvoyActivity(activity: string): boolean {
  return FIRST_EXTRACTION_CONVOY_ACTIVITIES.has(activity);
}

export function breachVictoryCallout(secondsRemaining: number): string {
  return `BREACH WINDOW ${Math.max(0, Math.ceil(secondsRemaining))}s — deliver one convoy to win`;
}

export interface FirstExtractionStep {
  key:
    | "vaultCaptured"
    | "convoyAction"
    | "pressureStarted"
    | "breachOpened"
    | "decisiveDelivery";
  label: string;
}

export const FIRST_EXTRACTION_STEPS: readonly FirstExtractionStep[] = [
  { key: "vaultCaptured", label: "Capture one vault" },
  { key: "convoyAction", label: FIRST_EXTRACTION_CONVOY_ACTION_LABEL },
  { key: "pressureStarted", label: "Contribute a Vault Pressure delivery" },
  { key: "breachOpened", label: "Help your side open a 3/3 Breach" },
  {
    key: "decisiveDelivery",
    label: "Land the decisive Breach delivery",
  },
];

export const VAULTFRONT_MATCH_READY_EVENT = "vaultfront-match-ready";

export interface FirstExtractionProgress {
  vaultCaptured: boolean;
  convoyAction: boolean;
  pressureStarted: boolean;
  breachOpened: boolean;
  decisiveDelivery: boolean;
}

export interface FirstExtractionSignals {
  vaultCaptured?: boolean;
  convoyAction?: boolean;
  personalPressureContributions?: number;
  teamPressure?: number;
  teamPressureThreshold?: number;
  breachWindowUntilTick?: number;
  currentTick?: number;
  decisiveDelivery?: boolean;
}

export interface FirstExtractionEvidenceReceipt {
  source: "server-status-and-activity";
  personal: {
    vaultCaptured: boolean;
    convoyAction: boolean;
    pressureDeliveries: number;
    decisiveDelivery: boolean;
  };
  team: {
    pressure: number;
    threshold: number;
    breachActive: boolean;
  };
  summary: string;
}

/** Compact, player-readable provenance for every personal/team quest claim. */
export function buildFirstExtractionEvidenceReceipt(
  signals: FirstExtractionSignals,
): FirstExtractionEvidenceReceipt {
  const pressureDeliveries = Math.max(
    0,
    Math.floor(signals.personalPressureContributions ?? 0),
  );
  const pressure = Math.max(0, Math.floor(signals.teamPressure ?? 0));
  const threshold = Math.max(0, Math.floor(signals.teamPressureThreshold ?? 0));
  const breachActive =
    (signals.breachWindowUntilTick ?? 0) > (signals.currentTick ?? 0);
  return {
    source: "server-status-and-activity",
    personal: {
      vaultCaptured: signals.vaultCaptured === true,
      convoyAction: signals.convoyAction === true || pressureDeliveries > 0,
      pressureDeliveries,
      decisiveDelivery: signals.decisiveDelivery === true,
    },
    team: { pressure, threshold, breachActive },
    summary: `You: ${pressureDeliveries} Pressure ${pressureDeliveries === 1 ? "delivery" : "deliveries"} · Team: ${pressure}/${threshold}${breachActive ? " · Breach live" : ""}`,
  };
}

export const EMPTY_FIRST_EXTRACTION_PROGRESS: FirstExtractionProgress = {
  vaultCaptured: false,
  convoyAction: false,
  pressureStarted: false,
  breachOpened: false,
  decisiveDelivery: false,
};

/**
 * Projects the player-facing tutorial from certified personal activity and the
 * team's status authority. Team state never implies a personal action: every
 * personal step needs personal evidence, even after reconnect.
 */
export function advanceFirstExtractionProgress(
  previous: FirstExtractionProgress,
  signals: FirstExtractionSignals,
): FirstExtractionProgress {
  const evidence = buildFirstExtractionEvidenceReceipt(signals);
  const decisiveDelivery =
    previous.decisiveDelivery || evidence.personal.decisiveDelivery;
  const breachActive = evidence.team.breachActive;
  const thresholdReached =
    evidence.team.threshold > 0 &&
    evidence.team.pressure >= evidence.team.threshold;
  const contributed = evidence.personal.pressureDeliveries > 0;
  const breachOpened =
    previous.breachOpened ||
    (contributed && (breachActive || thresholdReached)) ||
    decisiveDelivery;
  const pressureStarted = previous.pressureStarted || contributed;
  const vaultCaptured =
    previous.vaultCaptured || evidence.personal.vaultCaptured;
  const convoyAction =
    vaultCaptured && (previous.convoyAction || evidence.personal.convoyAction);

  return {
    vaultCaptured,
    convoyAction,
    pressureStarted,
    breachOpened,
    decisiveDelivery,
  };
}

export const FIRST_EXTRACTION_ORIENTATION = [
  {
    icon: "🏦",
    title: "Find the First Extraction tracker",
    body: "The live tracker beside your vault controls is the source of truth. It advances from your real match actions—no separate tutorial checklist to reconcile.",
  },
  {
    icon: "🚛",
    title: "Build Pressure, then breach",
    body: `${VAULTFRONT_VICTORY_LOOP.summary} ${VAULTFRONT_VICTORY_LOOP.pressureRule}`,
  },
] as const;

export function firstExtractionComplete(
  progress: FirstExtractionProgress,
): boolean {
  return FIRST_EXTRACTION_STEPS.every((step) => progress[step.key]);
}

export type FirstExtractionTrackerMode = "hidden" | "compact" | "expanded";

/**
 * The core-loop spine remains reachable until every certified stage is done.
 * Player dismissal, a compact HUD, or the initial coaching timeout collapses
 * detail; none of them may erase the next required action.
 */
export function firstExtractionTrackerMode(
  progress: FirstExtractionProgress,
  options: {
    dismissed: boolean;
    hudCompact: boolean;
    currentTick: number;
    expandedDurationTicks: number;
  },
): FirstExtractionTrackerMode {
  if (firstExtractionComplete(progress)) return "hidden";
  return options.dismissed ||
    options.hudCompact ||
    options.currentTick > options.expandedDurationTicks
    ? "compact"
    : "expanded";
}
