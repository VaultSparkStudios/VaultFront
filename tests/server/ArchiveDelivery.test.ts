import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameRecord } from "../../src/core/Schemas";

vi.mock("../../src/server/db/pool", () => ({ pool: null }));

import {
  ArchiveDeliveryManager,
  HybridArchiveDeliveryOutbox,
  MemoryArchiveDeliveryOutbox,
  PostgresArchiveDeliveryOutbox,
  type ArchiveDeliveryDatabase,
} from "../../src/server/ArchiveDelivery";

function record(certified = true): GameRecord {
  return {
    info: { gameID: "game-archive-1" },
    telemetry: certified
      ? { resultCertificate: { certificateId: "certificate-1" } }
      : undefined,
  } as unknown as GameRecord;
}

const managers: ArchiveDeliveryManager[] = [];

afterEach(() => {
  for (const manager of managers) manager.stop();
  managers.length = 0;
});

function manager(options: {
  fetchImpl: typeof fetch;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  maxAttempts?: number;
  immediateAttempts?: number;
  timeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  const created = new ArchiveDeliveryManager({
    outbox: new MemoryArchiveDeliveryOutbox(now),
    endpointForGame: (gameId) => `https://archive.test/game/${gameId}`,
    apiKey: () => "test-api-key",
    baseRetryMs: 1,
    pumpIntervalMs: 60_000,
    ...options,
  });
  managers.push(created);
  return created;
}

describe("ArchiveDeliveryManager", () => {
  it("delivers one certificate-bound idempotent payload exactly once locally", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const delivery = manager({ fetchImpl });

    const first = await delivery.deliver(record(), "certified");
    const repeat = await delivery.deliver(record(), "certified");

    expect(first).toMatchObject({
      deliveryId: "certified:game-archive-1:certificate-1",
      kind: "certified",
      state: "delivered",
      attempts: 1,
    });
    expect(repeat.state).toBe("delivered");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://archive.test/game/game-archive-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "certified:game-archive-1:certificate-1",
          "x-vaultfront-archive-kind": "certified",
        }),
      }),
    );
  });

  it("times out, retries with a bounded backoff, and dead-letters visibly", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const delivery = manager({
      fetchImpl,
      now: () => now,
      sleep: async (delayMs) => {
        now += delayMs;
      },
      timeoutMs: 5,
      maxAttempts: 2,
      immediateAttempts: 2,
    });

    const receipt = await delivery.deliver(record(false), "incomplete");

    expect(receipt).toMatchObject({
      kind: "incomplete",
      state: "dead-letter",
      attempts: 2,
      lastError: "archive-delivery-timeout",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(delivery.snapshot()).toMatchObject({
      deadLettered: 1,
      retries: 1,
      delivered: 0,
    });
  });

  it("rejects certificate-kind contradictions before provider work", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const delivery = manager({ fetchImpl });

    await expect(
      delivery.deliver(record(false), "certified"),
    ).resolves.toMatchObject({
      state: "rejected",
      lastError: "certified-archive-requires-certificate",
    });
    await expect(
      delivery.deliver(record(true), "incomplete"),
    ).resolves.toMatchObject({
      state: "rejected",
      lastError: "incomplete-archive-cannot-carry-certificate",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("recovers a due entry that existed before the delivery manager started", async () => {
    const now = 2_000;
    const outbox = new MemoryArchiveDeliveryOutbox(() => now);
    await outbox.enqueue({
      deliveryId: "incomplete:recovered-game",
      gameId: "recovered-game",
      kind: "incomplete",
      certificateId: null,
      payload: "{}",
      state: "queued",
      attempts: 0,
      nextAttemptAt: now,
      leaseUntil: null,
      lastError: null,
      createdAt: now - 1_000,
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const delivery = new ArchiveDeliveryManager({
      outbox,
      fetchImpl,
      endpointForGame: (gameId) => `https://archive.test/game/${gameId}`,
      apiKey: () => "test-api-key",
      now: () => now,
      pumpIntervalMs: 60_000,
    });
    managers.push(delivery);

    await delivery.flushDue();

    await expect(
      outbox.get("incomplete:recovered-game"),
    ).resolves.toMatchObject({ state: "delivered", attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("claims PostgreSQL retries with one leased SKIP LOCKED statement", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const database = { query } as unknown as ArchiveDeliveryDatabase;
    const outbox = new PostgresArchiveDeliveryOutbox(() => database);

    await outbox.claimDue(8, 4_000);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("lease_until");
    expect(sql).toContain("attempts = outbox.attempts + 1");
  });

  it("fails closed instead of fabricating process-local durability when PostgreSQL is configured", async () => {
    const outbox = new HybridArchiveDeliveryOutbox(
      () => null,
      Date.now,
      () => true,
    );

    await expect(
      outbox.enqueue({
        deliveryId: "incomplete:game-archive-1",
        gameId: "game-archive-1",
        kind: "incomplete",
        certificateId: null,
        payload: "{}",
        state: "queued",
        attempts: 0,
        nextAttemptAt: Date.now(),
        leaseUntil: null,
        lastError: null,
        createdAt: Date.now(),
      }),
    ).rejects.toThrow("archive-outbox-database-unavailable");
    expect(outbox.durability()).toBe("postgres");
  });
});
