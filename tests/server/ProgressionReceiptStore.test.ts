import { describe, expect, test, vi } from "vitest";
import { ProgressionReceiptStore } from "../../src/server/ProgressionReceiptStore";

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("../../src/server/db/pool", () => ({ pool: null }));

describe("ProgressionReceiptStore", () => {
  test("returns process-local receipts only to bound actors and clones reads", async () => {
    const store = new ProgressionReceiptStore(() => null);
    const receipt = {
      gameId: "game-1",
      recordedAt: "2026-08-01T20:00:00.000Z",
      durability: "process-local",
      duplicate: false,
      playersRecorded: 1,
      achievementsUnlocked: 0,
      predictionOutcome: "delivery",
      predictionsResolved: 0,
      dailyMastery: [],
      seasonContracts: [],
      seasonPass: [],
      loopEvidence: null,
      certifiedOutcomes: null,
      players: [],
      receiptDigest: `sha256:${"a".repeat(64)}`,
    } as any;
    await store.put(receipt, ["actor-1"]);
    expect(await store.getForActor("game-1", "actor-2")).toBeNull();
    const first = await store.getForActor("game-1", "actor-1");
    expect(first).toEqual(receipt);
    first!.playersRecorded = 999;
    expect((await store.get("game-1"))!.playersRecorded).toBe(1);
  });

  test("deletes actor-bound receipts at the exact 30-day privacy boundary", async () => {
    let now = Date.parse("2026-08-01T20:00:00.000Z");
    const store = new ProgressionReceiptStore(
      () => null,
      () => now,
    );
    const receipt = {
      gameId: "expiring",
      recordedAt: new Date(now).toISOString(),
      durability: "process-local",
      players: [],
      receiptDigest: `sha256:${"b".repeat(64)}`,
    } as any;
    await store.put(receipt, ["actor-1"]);
    now += 30 * 86_400_000;
    expect(await store.pruneExpired()).toBe(0);
    expect(await store.getForActor("expiring", "actor-1")).not.toBeNull();
    now += 1;
    expect(await store.pruneExpired()).toBe(1);
    expect(await store.getForActor("expiring", "actor-1")).toBeNull();
  });
});
