import { afterEach, describe, expect, test } from "vitest";
import {
  executionCompletionPalette,
  hudTransitionAlpha,
  projectExecutionChainHud,
  surgeOverlayPulse,
  VaultFrontLayer,
} from "../../../../src/client/graphics/layers/VaultFrontLayer";
import { projectVaultFrontMutatorBalance } from "../../../../src/core/execution/VaultFrontRuntimeBalance";
import {
  GameUpdateType,
  type VaultFrontStatusUpdate,
} from "../../../../src/core/game/GameUpdates";

function statusFor(
  mutator: "none" | "execution_rush",
  expiresAtTick: number,
): VaultFrontStatusUpdate {
  const balance = projectVaultFrontMutatorBalance(mutator);
  return {
    type: GameUpdateType.VaultFrontStatus,
    weeklyMutator: mutator,
    captureTicksRequired: balance.vaultCaptureTicks,
    cooldownTicksTotal: balance.vaultCooldownTicks,
    executionChainWindowTicks: balance.executionChainWindowTicks,
    executionChainRewardMultiplier: balance.executionChainRewardMultiplier,
    sites: [],
    convoys: [],
    beacons: [],
    executionChains: {
      7: {
        step: 2,
        expiresAtTick,
        lastResetReason: null,
        lastResetTick: 0,
        lastResetFromStep: 0,
      },
    },
    surges: {},
    squadObjectives: [],
    pressure: {},
  };
}

afterEach(() => {
  document.querySelector("[data-vaultfront-execution-chain-status]")?.remove();
});

describe("VaultFront execution-chain HUD", () => {
  test("projects normal authority without client-side balance constants", () => {
    const projection = projectExecutionChainHud(
      statusFor("none", 1_750),
      7,
      1_000,
    );

    expect(projection).toMatchObject({
      step: 2,
      remainingTicks: 750,
      durationTicks: 1_500,
      progressRatio: 0.5,
      rewardMultiplier: 1.2,
      nextAction: "Deny an enemy pulse with Jam Breaker",
    });
    expect(projection?.accessibleText).toContain(
      "75 seconds remaining. Next convoy reward ×1.2.",
    );
  });

  test("projects execution-rush window and reward from authoritative balance", () => {
    const projection = projectExecutionChainHud(
      statusFor("execution_rush", 2_500),
      7,
      1_000,
    );

    expect(projection).toMatchObject({
      remainingTicks: 1_500,
      durationTicks: 3_000,
      progressRatio: 0.5,
      rewardMultiplier: 1.5,
    });
    expect(projection?.accessibleText).toContain(
      "150 seconds remaining. Next convoy reward ×1.5.",
    );
  });

  test("mirrors the canvas state to an atomic polite live region", () => {
    let status = statusFor("execution_rush", 2_500);
    const game = {
      ticks: () => 1_000,
      myPlayer: () => ({ smallID: () => 7 }),
      updatesSinceLastTick: () => ({
        [GameUpdateType.VaultFrontStatus]: [status],
        [GameUpdateType.VaultFrontActivity]: [],
      }),
    };
    const layer = new VaultFrontLayer(game as any, {} as any);
    layer.init();
    layer.tick();

    const mirror = document.querySelector<HTMLElement>(
      "[data-vaultfront-execution-chain-status]",
    );
    expect(mirror).not.toBeNull();
    expect(mirror?.getAttribute("role")).toBe("status");
    expect(mirror?.getAttribute("aria-live")).toBe("polite");
    expect(mirror?.getAttribute("aria-atomic")).toBe("true");
    expect(mirror?.textContent).toContain("Next convoy reward ×1.5.");

    status = {
      ...status,
      executionChains: {
        7: {
          step: 0,
          expiresAtTick: 0,
          lastResetReason: "completed",
          lastResetTick: 1400,
          lastResetFromStep: 2,
        },
      },
    };
    layer.tick();
    expect(mirror?.textContent).toBe("");
  });

  test("freezes surge glow under reduced motion while preserving animation otherwise", () => {
    expect(surgeOverlayPulse(0, true)).toBe(0.45);
    expect(surgeOverlayPulse(9, true)).toBe(0.45);
    expect(surgeOverlayPulse(1, false)).not.toBe(surgeOverlayPulse(2, false));
    expect(hudTransitionAlpha(0, 30, true)).toBe(1);
    expect(hudTransitionAlpha(29, 30, true)).toBe(1);
    expect(hudTransitionAlpha(15, 30, false)).toBe(0.5);
  });

  test("uses a dark semantic completion color on the light theme", () => {
    expect(executionCompletionPalette("light")).toEqual({
      foreground: "#065f46",
      shadow: "rgba(5, 150, 105, 0.35)",
    });
    expect(executionCompletionPalette("vaultfront").foreground).toBe("#6ee7b7");
  });
});
