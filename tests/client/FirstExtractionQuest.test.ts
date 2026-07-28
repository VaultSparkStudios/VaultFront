import { describe, expect, it } from "vitest";
import {
  breachVictoryCallout,
  FIRST_EXTRACTION_CONVOY_ACTION_LABEL,
  FIRST_EXTRACTION_ORIENTATION,
  FIRST_EXTRACTION_STEPS,
  FIRST_EXTRACTION_TITLE,
  firstExtractionComplete,
  isFirstExtractionConvoyActivity,
  VAULTFRONT_VICTORY_LOOP,
} from "../../src/client/FirstExtractionQuest";

describe("First Extraction quest contract", () => {
  it("owns one four-action vocabulary for desktop and mobile surfaces", () => {
    expect(FIRST_EXTRACTION_TITLE).toBe("First Extraction");
    expect(FIRST_EXTRACTION_STEPS.map((step) => step.key)).toEqual([
      "focusSet",
      "vaultCaptured",
      "convoyAction",
      "pulseTriggered",
    ]);
    expect(FIRST_EXTRACTION_STEPS[2].label).toBe(
      FIRST_EXTRACTION_CONVOY_ACTION_LABEL,
    );
    expect(FIRST_EXTRACTION_CONVOY_ACTION_LABEL).toBe(
      "Deliver, shield, or intercept one Vault Convoy",
    );
  });

  it("owns the player-facing victory explanation and breach callout", () => {
    expect(VAULTFRONT_VICTORY_LOOP.pressureRule).toContain(
      "Three convoy deliveries",
    );
    expect(VAULTFRONT_VICTORY_LOOP.pressureRule).toContain(
      "90-second Breach Window",
    );
    expect(FIRST_EXTRACTION_ORIENTATION[1].body).toContain(
      VAULTFRONT_VICTORY_LOOP.summary,
    );
    expect(breachVictoryCallout(14.2)).toBe(
      "BREACH WINDOW 15s — deliver one convoy to win",
    );
  });

  it("aligns convoy-action completion with certified player activities", () => {
    expect(isFirstExtractionConvoyActivity("convoy_delivered")).toBe(true);
    expect(isFirstExtractionConvoyActivity("convoy_escorted")).toBe(true);
    expect(isFirstExtractionConvoyActivity("convoy_intercepted")).toBe(true);
    expect(isFirstExtractionConvoyActivity("convoy_launched")).toBe(false);
  });

  it("unlocks advanced coaching only after every core action", () => {
    expect(
      firstExtractionComplete({
        focusSet: true,
        vaultCaptured: true,
        convoyAction: true,
        pulseTriggered: false,
      }),
    ).toBe(false);
    expect(
      firstExtractionComplete({
        focusSet: true,
        vaultCaptured: true,
        convoyAction: true,
        pulseTriggered: true,
      }),
    ).toBe(true);
  });
});
