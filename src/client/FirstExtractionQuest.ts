export const FIRST_EXTRACTION_TITLE = "First Extraction";

export const VAULTFRONT_VICTORY_LOOP = {
  summary:
    "Capture a vault, deliver or disrupt its convoy, build Vault Pressure, then deliver during the Breach Window to win.",
  pressureRule:
    "Three convoy deliveries open a 90-second Breach Window. Deliver one more convoy before it closes to win.",
} as const;

export const FIRST_EXTRACTION_CONVOY_ACTION_LABEL =
  "Deliver, shield, or intercept one Vault Convoy";

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
  key: "focusSet" | "vaultCaptured" | "convoyAction" | "pulseTriggered";
  label: string;
}

export const FIRST_EXTRACTION_STEPS: readonly FirstExtractionStep[] = [
  { key: "focusSet", label: "Set Resource Focus once" },
  { key: "vaultCaptured", label: "Capture one vault" },
  { key: "convoyAction", label: FIRST_EXTRACTION_CONVOY_ACTION_LABEL },
  { key: "pulseTriggered", label: "Trigger one Defense Factory pulse" },
];

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
  progress: Record<FirstExtractionStep["key"], boolean>,
): boolean {
  return FIRST_EXTRACTION_STEPS.every((step) => progress[step.key]);
}
