import { describe, expect, it } from "vitest";
import {
  GAME_ID_ALPHABET,
  GAME_ID_LENGTH,
  simpleHash,
} from "../../src/core/Util";
import {
  createWorkerRoutedGameId,
  verifyWorkerRoutedGameIdResult,
} from "../../src/server/WorkerGameId";

const seed = "12345678";

describe("worker-routed GameID authority", () => {
  it("preserves the exact public ID shape and routes every configured worker", () => {
    const workerCount = 16;
    const workerIndex = (gameId: string) => simpleHash(gameId) % workerCount;
    for (let workerId = 0; workerId < workerCount; workerId += 1) {
      const result = createWorkerRoutedGameId({
        workerId,
        workerIndex,
        generateSeed: () => seed,
      });
      expect(result).toMatchObject({ ok: true, seedsTried: 1 });
      if (!result.ok) throw new Error(result.reason);
      expect(result.gameId).toHaveLength(GAME_ID_LENGTH);
      expect(
        [...result.gameId].every((char) => GAME_ID_ALPHABET.includes(char)),
      ).toBe(true);
      expect(result.gameId.slice(0, -1)).toBe(seed.slice(0, -1));
      expect(workerIndex(result.gameId)).toBe(workerId);
    }
  });

  it("keeps collision handling inside the routing authority", () => {
    let firstCandidate: string | null = null;
    const result = createWorkerRoutedGameId({
      workerId: 0,
      workerIndex: () => 0,
      generateSeed: () => seed,
      isTaken: (candidate) => {
        firstCandidate ??= candidate;
        return candidate === firstCandidate;
      },
    });

    expect(result).toMatchObject({ ok: true, candidatesChecked: 2 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.gameId).not.toBe(firstCandidate);
  });

  it("returns typed evidence for invalid inputs and bounded exhaustion", () => {
    expect(
      createWorkerRoutedGameId({
        workerId: -1,
        workerIndex: () => 0,
      }),
    ).toMatchObject({ ok: false, reason: "invalid-worker-id" });
    expect(
      createWorkerRoutedGameId({
        workerId: 0,
        workerIndex: () => 0,
        generateSeed: () => "not-valid",
      }),
    ).toMatchObject({ ok: false, reason: "invalid-seed" });
    expect(
      createWorkerRoutedGameId({
        workerId: 1,
        workerIndex: () => 0,
        generateSeed: () => seed,
        maxSeeds: 2,
      }),
    ).toMatchObject({
      ok: false,
      reason: "route-exhausted",
      seedsTried: 2,
      candidatesChecked: GAME_ID_ALPHABET.length * 2,
    });
  });

  it("rejects every tampered route witness dimension", () => {
    const workerIndex = (gameId: string) => simpleHash(gameId) % 4;
    const result = createWorkerRoutedGameId({
      workerId: 2,
      workerIndex,
      generateSeed: () => seed,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(verifyWorkerRoutedGameIdResult(result, { workerIndex })).toBe(true);

    for (const tampered of [
      { ...result, gameId: "invalid!" },
      { ...result, workerId: 3 },
      { ...result, seedBudget: 0 },
      { ...result, seedsTried: result.seedBudget + 1 },
      { ...result, candidatesChecked: 0 },
      {
        ...result,
        candidatesChecked: result.seedsTried * GAME_ID_ALPHABET.length + 1,
      },
    ]) {
      expect(
        verifyWorkerRoutedGameIdResult(tampered as typeof result, {
          workerIndex,
        }),
      ).toBe(false);
    }
    expect(
      verifyWorkerRoutedGameIdResult(result, {
        workerIndex,
        isTaken: () => true,
      }),
    ).toBe(false);
  });
});
