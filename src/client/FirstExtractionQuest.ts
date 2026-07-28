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
  { key: "pressureStarted", label: "Deliver to start Vault Pressure" },
  { key: "breachOpened", label: "Reach 3/3 Pressure to open Breach" },
  {
    key: "decisiveDelivery",
    label: "Deliver during Breach to secure victory",
  },
];

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
  pressure?: number;
  pressureThreshold?: number;
  breachWindowUntilTick?: number;
  currentTick?: number;
  victorySecured?: boolean;
}

export const EMPTY_FIRST_EXTRACTION_PROGRESS: FirstExtractionProgress = {
  vaultCaptured: false,
  convoyAction: false,
  pressureStarted: false,
  breachOpened: false,
  decisiveDelivery: false,
};

/**
 * Projects the player-facing tutorial from the same activity/status authority as
 * the live HUD. Later authoritative stages imply their prerequisites so a
 * reconnect cannot display an impossible, out-of-order quest.
 */
export function advanceFirstExtractionProgress(
  previous: FirstExtractionProgress,
  signals: FirstExtractionSignals,
): FirstExtractionProgress {
  const decisiveDelivery =
    previous.decisiveDelivery || signals.victorySecured === true;
  const breachActive =
    (signals.breachWindowUntilTick ?? 0) > (signals.currentTick ?? 0);
  const thresholdReached =
    (signals.pressureThreshold ?? 0) > 0 &&
    (signals.pressure ?? 0) >= (signals.pressureThreshold ?? 0);
  const breachOpened =
    previous.breachOpened ||
    breachActive ||
    thresholdReached ||
    decisiveDelivery;
  const pressureStarted =
    previous.pressureStarted || (signals.pressure ?? 0) > 0 || breachOpened;
  const vaultCaptured =
    previous.vaultCaptured || signals.vaultCaptured === true || pressureStarted;
  const convoyAction =
    vaultCaptured &&
    (previous.convoyAction || signals.convoyAction === true || pressureStarted);

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
  return progress.decisiveDelivery;
}
