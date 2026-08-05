import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  CertifiedDailyMasteryStore,
  MasteryDoctrineSelectionError,
  verifyMasteryDoctrineReceipt,
  type CertifiedMasteryOutcome,
} from "../../src/server/CertifiedDailyMasteryStore";
vi.mock("../../src/server/Logger", () => {
  const log = {
    child: () => log,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: log };
});

const decisiveOutcome: CertifiedMasteryOutcome = {
  persistentId: "player-1",
  won: true,
  vaultCaptures: 10,
  convoyDeliveries: 10,
  convoyIntercepts: 10,
  executionChains: 10,
  surgeActivations: 10,
};

describe("CertifiedDailyMasteryStore", () => {
  test("derives progress from certified outcomes and awards mastery once", async () => {
    const store = new CertifiedDailyMasteryStore({
      now: () => new Date("2026-07-22T12:00:00.000Z"),
      pool: () => null,
      databaseConfigured: () => false,
    });

    const before = await store.getChallenge("player-1");
    expect(before).toMatchObject({
      progress: 0,
      completed: false,
      masteryBalance: 0,
      evidence: "certified-match-result",
      durability: "process-local",
    });

    const receipt = await store.recordCertifiedMatch(
      "certified-game-1",
      decisiveOutcome,
    );
    expect(receipt).toMatchObject({
      persistentId: "player-1",
      challengeId: before.challengeId,
      completedNow: true,
      masteryBalance: before.rewardMastery,
      durability: "process-local",
    });

    expect(
      await store.recordCertifiedMatch("certified-game-1", decisiveOutcome),
    ).toBeNull();
    const after = await store.getChallenge("player-1");
    expect(after.progress).toBe(after.target);
    expect(after.masteryBalance).toBe(before.rewardMastery);
  });

  test("isolates UTC days and player balances", async () => {
    let now = new Date("2026-07-22T23:59:59.000Z");
    const store = new CertifiedDailyMasteryStore({
      now: () => now,
      pool: () => null,
      databaseConfigured: () => false,
    });
    await store.recordCertifiedMatch("same-game-id", decisiveOutcome);
    now = new Date("2026-07-23T00:00:01.000Z");

    const nextDay = await store.getChallenge("player-1");
    expect(nextDay.progress).toBe(0);
    expect(nextDay.masteryBalance).toBeGreaterThan(0);
    expect(
      await store.recordCertifiedMatch("same-game-id", decisiveOutcome),
    ).not.toBeNull();
    expect((await store.getChallenge("player-2")).masteryBalance).toBe(0);
  });

  test("fails closed when configured persistence is unavailable", async () => {
    const store = new CertifiedDailyMasteryStore({
      pool: () => null,
      databaseConfigured: () => true,
    });
    await expect(store.getChallenge("player-1")).rejects.toThrow(
      "persistence unavailable",
    );
    await expect(
      store.recordCertifiedMatch("game-1", decisiveOutcome),
    ).rejects.toThrow("persistence unavailable");
  });

  test("sanitizes impossible certified counters", async () => {
    const store = new CertifiedDailyMasteryStore({
      now: () => new Date("2026-07-22T12:00:00.000Z"),
      pool: () => null,
      databaseConfigured: () => false,
    });
    const invalid = {
      ...decisiveOutcome,
      won: false,
      vaultCaptures: -1,
      convoyDeliveries: Number.POSITIVE_INFINITY,
      convoyIntercepts: 1.5,
      executionChains: Number.NaN,
      surgeActivations: -3,
    };
    const receipt = await store.recordCertifiedMatch("game-2", invalid);
    expect(receipt?.progress).toBe(0);
    expect(receipt?.completedNow).toBe(false);
  });

  test("unlocks and selects non-power doctrines exactly once per request", async () => {
    const store = new CertifiedDailyMasteryStore({
      now: () => new Date("2026-07-22T12:00:00.000Z"),
      pool: () => null,
      databaseConfigured: () => false,
    });
    const earned = await store.recordCertifiedMatch(
      "game-doctrine",
      decisiveOutcome,
    );
    const before = await store.getChallenge("player-1");
    expect(before.doctrines).toMatchObject({
      ownedIds: [],
      activeId: null,
      effectPolicy: "coaching-and-identity-only",
    });

    const first = await store.selectDoctrine(
      "player-1",
      "route-reader",
      "request-0001",
    );
    expect(first).toMatchObject({
      doctrineId: "route-reader",
      unlockedNow: true,
      spentMastery: 50,
      masteryBalance: (earned?.masteryBalance ?? 0) - 50,
      evidence: "authenticated-mastery-choice",
    });
    expect(verifyMasteryDoctrineReceipt(first)).toBe(true);
    expect(
      verifyMasteryDoctrineReceipt({ ...first, masteryBalance: 999 }),
    ).toBe(false);
    expect(
      await store.selectDoctrine("player-1", "route-reader", "request-0001"),
    ).toEqual(first);
    expect(
      await store.selectDoctrine("player-1", "route-reader", "request-0002"),
    ).toMatchObject({ unlockedNow: false, spentMastery: 0 });
    expect(await store.getChallenge("player-1")).toMatchObject({
      masteryBalance: first.masteryBalance,
      doctrines: { ownedIds: ["route-reader"], activeId: "route-reader" },
    });

    await expect(
      store.selectDoctrine("player-1", "vault-warden", "request-0001"),
    ).rejects.toMatchObject({ code: "request-conflict" });
  });

  test("fails closed when a doctrine cannot be funded", async () => {
    const store = new CertifiedDailyMasteryStore({
      pool: () => null,
      databaseConfigured: () => false,
    });
    await expect(
      store.selectDoctrine("player-empty", "route-reader", "request-0003"),
    ).rejects.toBeInstanceOf(MasteryDoctrineSelectionError);
    await expect(
      store.selectDoctrine("player-empty", "route-reader", "request-0004"),
    ).rejects.toMatchObject({ code: "insufficient-mastery" });
    expect((await store.getChallenge("player-empty")).masteryBalance).toBe(0);
  });

  test("declares durable doctrine wallet, profile, and replay tables", () => {
    const schema = readFileSync(resolve("src/server/db/schema.sql"), "utf8");
    expect(schema).toContain("daily_mastery_doctrine_unlocks");
    expect(schema).toContain("daily_mastery_doctrine_profiles");
    expect(schema).toContain("daily_mastery_doctrine_requests");
    expect(schema).toContain("PRIMARY KEY (persistent_id, request_id)");
  });
});
