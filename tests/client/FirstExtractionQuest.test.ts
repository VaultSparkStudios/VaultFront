import { describe, expect, it } from "vitest";
import {
  advanceFirstExtractionProgress,
  breachVictoryCallout,
  buildFirstExtractionEvidenceReceipt,
  EMPTY_FIRST_EXTRACTION_PROGRESS,
  FIRST_EXTRACTION_CONVOY_ACTION_LABEL,
  FIRST_EXTRACTION_ORIENTATION,
  FIRST_EXTRACTION_STEPS,
  FIRST_EXTRACTION_TITLE,
  firstExtractionComplete,
  firstExtractionTrackerMode,
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

  it("never converts shared team pressure into personal accomplishments", () => {
    const earlyIntercept = advanceFirstExtractionProgress(
      EMPTY_FIRST_EXTRACTION_PROGRESS,
      { convoyAction: true },
    );
    expect(earlyIntercept).toEqual(EMPTY_FIRST_EXTRACTION_PROGRESS);

    const firstPressure = advanceFirstExtractionProgress(
      EMPTY_FIRST_EXTRACTION_PROGRESS,
      { teamPressure: 2, teamPressureThreshold: 3, currentTick: 100 },
    );
    expect(firstPressure).toEqual(EMPTY_FIRST_EXTRACTION_PROGRESS);

    const personalContribution = advanceFirstExtractionProgress(
      EMPTY_FIRST_EXTRACTION_PROGRESS,
      {
        vaultCaptured: true,
        personalPressureContributions: 1,
        teamPressure: 2,
        teamPressureThreshold: 3,
      },
    );
    expect(personalContribution).toMatchObject({
      vaultCaptured: true,
      convoyAction: true,
      pressureStarted: true,
      breachOpened: false,
    });

    const breach = advanceFirstExtractionProgress(personalContribution, {
      personalPressureContributions: 1,
      teamPressure: 3,
      teamPressureThreshold: 3,
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
      { decisiveDelivery: true },
    );
    expect(victory).toEqual({
      vaultCaptured: false,
      convoyAction: false,
      pressureStarted: false,
      breachOpened: true,
      decisiveDelivery: true,
    });
    expect(firstExtractionComplete(victory)).toBe(false);
    expect(
      firstExtractionComplete({
        ...victory,
        vaultCaptured: true,
        convoyAction: true,
        pressureStarted: true,
      }),
    ).toBe(true);
  });

  it("issues a compact personal/team evidence receipt without borrowed credit", () => {
    expect(
      buildFirstExtractionEvidenceReceipt({
        vaultCaptured: true,
        personalPressureContributions: 1,
        teamPressure: 3,
        teamPressureThreshold: 3,
        breachWindowUntilTick: 200,
        currentTick: 100,
      }),
    ).toMatchObject({
      source: "server-status-and-activity",
      personal: {
        vaultCaptured: true,
        convoyAction: true,
        pressureDeliveries: 1,
        decisiveDelivery: false,
      },
      team: { pressure: 3, threshold: 3, breachActive: true },
      summary: "You: 1 Pressure delivery · Team: 3/3 · Breach live",
    });
  });

  it("keeps an incomplete core-loop spine visible after dismissal and timeout", () => {
    expect(
      firstExtractionTrackerMode(EMPTY_FIRST_EXTRACTION_PROGRESS, {
        dismissed: false,
        hudCompact: false,
        currentTick: 100,
        expandedDurationTicks: 1_800,
      }),
    ).toBe("expanded");
    expect(
      firstExtractionTrackerMode(
        { ...EMPTY_FIRST_EXTRACTION_PROGRESS, vaultCaptured: true },
        {
          dismissed: true,
          hudCompact: false,
          currentTick: 100,
          expandedDurationTicks: 1_800,
        },
      ),
    ).toBe("compact");
    expect(
      firstExtractionTrackerMode(
        {
          vaultCaptured: true,
          convoyAction: true,
          pressureStarted: true,
          breachOpened: false,
          decisiveDelivery: false,
        },
        {
          dismissed: false,
          hudCompact: false,
          currentTick: 1_801,
          expandedDurationTicks: 1_800,
        },
      ),
    ).toBe("compact");
    expect(
      firstExtractionTrackerMode(
        {
          vaultCaptured: true,
          convoyAction: true,
          pressureStarted: true,
          breachOpened: true,
          decisiveDelivery: true,
        },
        {
          dismissed: false,
          hudCompact: false,
          currentTick: 2_000,
          expandedDurationTicks: 1_800,
        },
      ),
    ).toBe("hidden");
  });
});
