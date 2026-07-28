import { describe, expect, it } from "vitest";
import {
  advanceFirstExtractionProgress,
  breachVictoryCallout,
  EMPTY_FIRST_EXTRACTION_PROGRESS,
  FIRST_EXTRACTION_CONVOY_ACTION_LABEL,
  FIRST_EXTRACTION_ORIENTATION,
  FIRST_EXTRACTION_STEPS,
  FIRST_EXTRACTION_TITLE,
  firstExtractionComplete,
  isFirstExtractionConvoyActivity,
  VAULTFRONT_VICTORY_LOOP,
} from "../../src/client/FirstExtractionQuest";

describe("First Extraction quest contract", () => {
  it("owns one progressive Pressure-to-Breach vocabulary", () => {
    expect(FIRST_EXTRACTION_TITLE).toBe("First Extraction");
    expect(FIRST_EXTRACTION_STEPS.map((step) => step.key)).toEqual([
      "vaultCaptured",
      "convoyAction",
      "pressureStarted",
      "breachOpened",
      "decisiveDelivery",
    ]);
    expect(FIRST_EXTRACTION_STEPS[1].label).toBe(
      FIRST_EXTRACTION_CONVOY_ACTION_LABEL,
    );
    expect(FIRST_EXTRACTION_CONVOY_ACTION_LABEL).toBe(
      "Engage one Vault Convoy — deliver, shield, or intercept",
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

  it("advances in authoritative stage order from pressure status", () => {
    const earlyIntercept = advanceFirstExtractionProgress(
      EMPTY_FIRST_EXTRACTION_PROGRESS,
      { convoyAction: true },
    );
    expect(earlyIntercept).toEqual(EMPTY_FIRST_EXTRACTION_PROGRESS);

    const firstPressure = advanceFirstExtractionProgress(
      EMPTY_FIRST_EXTRACTION_PROGRESS,
      { pressure: 1, pressureThreshold: 3, currentTick: 100 },
    );
    expect(firstPressure).toEqual({
      vaultCaptured: true,
      convoyAction: true,
      pressureStarted: true,
      breachOpened: false,
      decisiveDelivery: false,
    });

    const breach = advanceFirstExtractionProgress(firstPressure, {
      pressure: 3,
      pressureThreshold: 3,
      breachWindowUntilTick: 200,
      currentTick: 100,
    });
    expect(breach).toEqual({
      vaultCaptured: true,
      convoyAction: true,
      pressureStarted: true,
      breachOpened: true,
      decisiveDelivery: false,
    });
  });

  it("requires the decisive breach delivery before completion", () => {
    expect(
      firstExtractionComplete({
        vaultCaptured: true,
        convoyAction: true,
        pressureStarted: true,
        breachOpened: true,
        decisiveDelivery: false,
      }),
    ).toBe(false);

    const victory = advanceFirstExtractionProgress(
      EMPTY_FIRST_EXTRACTION_PROGRESS,
      { victorySecured: true },
    );
    expect(victory).toEqual({
      vaultCaptured: true,
      convoyAction: true,
      pressureStarted: true,
      breachOpened: true,
      decisiveDelivery: true,
    });
    expect(firstExtractionComplete(victory)).toBe(true);
  });
});
