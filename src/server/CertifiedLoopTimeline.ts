export interface CertifiedLoopTimelineInput {
  firstVaultPressureTick?: number;
  firstBreachOpenTick?: number;
  decisiveDeliveryTick?: number;
  vaultBreachVictoryTick?: number;
}

export interface CertifiedLoopTimeline {
  pressureSeconds: number | null;
  breachSeconds: number | null;
  decisiveDeliverySeconds: number | null;
  victorySeconds: number | null;
}

export interface CertifiedLoopAdmissibilityReceipt {
  schemaVersion: 1;
  gameId: string;
  playerSamples: number;
  timelineDigest: `sha256:${string}`;
}

export interface CertifiedLoopAdmissibilityProjection {
  timelines: CertifiedLoopTimeline[];
  receipt: CertifiedLoopAdmissibilityReceipt;
}

export type CertifiedLoopTimelineErrorCode =
  | "invalid-turn-interval"
  | "invalid-stage-tick"
  | "missing-stage-predecessor"
  | "stage-out-of-order";

export class CertifiedLoopTimelineError extends TypeError {
  constructor(
    readonly code: CertifiedLoopTimelineErrorCode,
    readonly stage: string,
    detail: string,
  ) {
    super(`certified loop timeline ${code} at ${stage}: ${detail}`);
    this.name = "CertifiedLoopTimelineError";
  }
}

const STAGES = [
  ["pressure", "firstVaultPressureTick"],
  ["breach", "firstBreachOpenTick"],
  ["decisive-delivery", "decisiveDeliveryTick"],
  ["victory", "vaultBreachVictoryTick"],
] as const;

/**
 * Projects the one admissible certified Pressure → Breach → decisive delivery
 * → victory prefix. Missing future stages are valid; gaps and time reversal are
 * rejected before either process-local or durable evidence can be written.
 */
export function projectCertifiedLoopTimeline(
  input: CertifiedLoopTimelineInput,
  turnIntervalMs: number,
): CertifiedLoopTimeline {
  if (!Number.isFinite(turnIntervalMs) || turnIntervalMs <= 0) {
    throw new CertifiedLoopTimelineError(
      "invalid-turn-interval",
      "timeline",
      String(turnIntervalMs),
    );
  }

  const ticks: Array<number | null> = STAGES.map(([stage, key]) => {
    const value = input[key];
    if (value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CertifiedLoopTimelineError(
        "invalid-stage-tick",
        stage,
        String(value),
      );
    }
    return value;
  });

  let missingPrefix = false;
  let priorTick: number | null = null;
  for (let index = 0; index < STAGES.length; index += 1) {
    const [stage] = STAGES[index];
    const tick = ticks[index];
    if (tick === null) {
      missingPrefix = true;
      continue;
    }
    if (missingPrefix) {
      throw new CertifiedLoopTimelineError(
        "missing-stage-predecessor",
        stage,
        "a later stage exists after an absent stage",
      );
    }
    if (priorTick !== null && tick < priorTick) {
      throw new CertifiedLoopTimelineError(
        "stage-out-of-order",
        stage,
        `${tick} < ${priorTick}`,
      );
    }
    priorTick = tick;
  }

  const seconds = ticks.map((tick) =>
    tick === null ? null : (tick * turnIntervalMs) / 1000,
  );
  return {
    pressureSeconds: seconds[0],
    breachSeconds: seconds[1],
    decisiveDeliverySeconds: seconds[2],
    victorySeconds: seconds[3],
  };
}

function digestAdmissibleTimelines(
  gameId: string,
  turnIntervalMs: number,
  timelines: readonly CertifiedLoopTimeline[],
): `sha256:${string}` {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    gameId,
    turnIntervalMs,
    timelines,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * Projects and receipts the complete match chronology in one pass. The digest
 * binds match identity, interval, player order, and every normalized stage while
 * retaining no actor identifier or raw gameplay payload.
 */
export function projectCertifiedLoopAdmissibility(
  gameId: string,
  inputs: readonly CertifiedLoopTimelineInput[],
  turnIntervalMs: number,
): CertifiedLoopAdmissibilityProjection {
  if (!gameId.trim()) {
    throw new TypeError("certified loop admissibility requires a gameId");
  }
  const timelines = inputs.map((input) =>
    projectCertifiedLoopTimeline(input, turnIntervalMs),
  );
  return {
    timelines,
    receipt: {
      schemaVersion: 1,
      gameId,
      playerSamples: timelines.length,
      timelineDigest: digestAdmissibleTimelines(
        gameId,
        turnIntervalMs,
        timelines,
      ),
    },
  };
}

export function buildCertifiedLoopAdmissibilityReceipt(
  gameId: string,
  inputs: readonly CertifiedLoopTimelineInput[],
  turnIntervalMs: number,
): CertifiedLoopAdmissibilityReceipt {
  return projectCertifiedLoopAdmissibility(gameId, inputs, turnIntervalMs)
    .receipt;
}

export function verifyCertifiedLoopAdmissibilityReceipt(
  receipt: CertifiedLoopAdmissibilityReceipt,
  gameId: string,
  inputs: readonly CertifiedLoopTimelineInput[],
  turnIntervalMs: number,
): boolean {
  try {
    const expected = buildCertifiedLoopAdmissibilityReceipt(
      gameId,
      inputs,
      turnIntervalMs,
    );
    if (
      receipt.schemaVersion !== expected.schemaVersion ||
      receipt.gameId !== expected.gameId ||
      receipt.playerSamples !== expected.playerSamples
    ) {
      return false;
    }
    const actualDigest = Buffer.from(receipt.timelineDigest);
    const expectedDigest = Buffer.from(expected.timelineDigest);
    return (
      actualDigest.length === expectedDigest.length &&
      timingSafeEqual(actualDigest, expectedDigest)
    );
  } catch {
    return false;
  }
}
import { createHash, timingSafeEqual } from "node:crypto";
