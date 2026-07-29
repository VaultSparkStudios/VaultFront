import type { GameID } from "../core/Schemas";
import { GAME_ID_ALPHABET, GAME_ID_LENGTH, generateID } from "../core/Util";

export interface WorkerGameIdOptions {
  workerId: number;
  workerIndex: (gameId: GameID) => number;
  isTaken?: (gameId: GameID) => boolean;
  generateSeed?: () => GameID;
  maxSeeds?: number;
}

export type WorkerGameIdResult =
  | {
      ok: true;
      gameId: GameID;
      workerId: number;
      seedBudget: number;
      seedsTried: number;
      candidatesChecked: number;
    }
  | {
      ok: false;
      reason:
        | "invalid-worker-id"
        | "invalid-seed"
        | "route-exhausted"
        | "witness-invalid";
      seedsTried: number;
      candidatesChecked: number;
    };

const DEFAULT_MAX_SEEDS = 64;
const GAME_ID_PATTERN = new RegExp(
  `^[${GAME_ID_ALPHABET}]{${GAME_ID_LENGTH}}$`,
);

/**
 * Finds an eight-character preimage for the canonical workerIndex function.
 * Seven random characters retain the public GameID shape and entropy; the last
 * character is searched in seed-rotated order. Collision checks stay inside
 * the same authority so matchmaking and rematch allocation cannot drift.
 */
export function createWorkerRoutedGameId(
  options: WorkerGameIdOptions,
): WorkerGameIdResult {
  const {
    workerId,
    workerIndex,
    isTaken = () => false,
    generateSeed = generateID,
    maxSeeds = DEFAULT_MAX_SEEDS,
  } = options;
  if (!Number.isSafeInteger(workerId) || workerId < 0) {
    return {
      ok: false,
      reason: "invalid-worker-id",
      seedsTried: 0,
      candidatesChecked: 0,
    };
  }

  const boundedSeeds = Math.max(1, Math.min(256, Math.floor(maxSeeds)));
  let candidatesChecked = 0;
  for (let seedsTried = 1; seedsTried <= boundedSeeds; seedsTried += 1) {
    const seed = generateSeed();
    if (!GAME_ID_PATTERN.test(seed)) {
      return {
        ok: false,
        reason: "invalid-seed",
        seedsTried,
        candidatesChecked,
      };
    }
    const prefix = seed.slice(0, GAME_ID_LENGTH - 1);
    const rotation = GAME_ID_ALPHABET.indexOf(seed.at(-1)!);
    for (let offset = 0; offset < GAME_ID_ALPHABET.length; offset += 1) {
      const suffix =
        GAME_ID_ALPHABET[(rotation + offset) % GAME_ID_ALPHABET.length];
      const candidate = `${prefix}${suffix}` as GameID;
      candidatesChecked += 1;
      if (workerIndex(candidate) !== workerId || isTaken(candidate)) continue;
      return {
        ok: true,
        gameId: candidate,
        workerId,
        seedBudget: boundedSeeds,
        seedsTried,
        candidatesChecked,
      };
    }
  }
  return {
    ok: false,
    reason: "route-exhausted",
    seedsTried: boundedSeeds,
    candidatesChecked,
  };
}

export function verifyWorkerRoutedGameIdResult(
  result: WorkerGameIdResult,
  options: Pick<WorkerGameIdOptions, "workerIndex" | "isTaken">,
): boolean {
  if (!result.ok || !GAME_ID_PATTERN.test(result.gameId)) return false;
  if (!Number.isSafeInteger(result.workerId) || result.workerId < 0)
    return false;
  if (
    !Number.isSafeInteger(result.seedBudget) ||
    result.seedBudget < 1 ||
    result.seedBudget > 256 ||
    !Number.isSafeInteger(result.seedsTried) ||
    result.seedsTried < 1 ||
    result.seedsTried > result.seedBudget ||
    !Number.isSafeInteger(result.candidatesChecked)
  ) {
    return false;
  }
  const minimumCandidates =
    (result.seedsTried - 1) * GAME_ID_ALPHABET.length + 1;
  const maximumCandidates = result.seedsTried * GAME_ID_ALPHABET.length;
  if (
    result.candidatesChecked < minimumCandidates ||
    result.candidatesChecked > maximumCandidates
  ) {
    return false;
  }
  try {
    return (
      options.workerIndex(result.gameId) === result.workerId &&
      !(options.isTaken?.(result.gameId) ?? false)
    );
  } catch {
    return false;
  }
}

/** Consumer-facing allocator: no successful result crosses the boundary until
 * its route witness has been independently re-evaluated. */
export function createVerifiedWorkerRoutedGameId(
  options: WorkerGameIdOptions,
): WorkerGameIdResult {
  const result = createWorkerRoutedGameId(options);
  if (!result.ok || verifyWorkerRoutedGameIdResult(result, options)) {
    return result;
  }
  return {
    ok: false,
    reason: "witness-invalid",
    seedsTried: result.seedsTried,
    candidatesChecked: result.candidatesChecked,
  };
}
