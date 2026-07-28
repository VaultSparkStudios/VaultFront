import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/db/pool", () => ({ pool: null }));

import {
  TournamentStore,
  tournamentStore,
} from "../../src/server/TournamentStore";

async function seedTwoPlayerMatch(store: TournamentStore, name: string) {
  const tournament = await store.create({
    name,
    createdBy: "organizer",
    maxPlayers: 2,
  });
  await store.register(tournament.id, "alpha", 1500);
  await store.register(tournament.id, "bravo", 1200);
  const seeded = await store.seedBracket(tournament.id);
  if ("error" in seeded) throw new Error(seeded.error);
  return { tournament, match: seeded.rounds[0][0] };
}

describe("TournamentStore operations brief", () => {
  it("summarizes bracket state for an operator", async () => {
    const tournament = await tournamentStore.create({
      name: "Ops Brief Cup",
      createdBy: "organizer",
      maxPlayers: 4,
    });

    await tournamentStore.register(tournament.id, "alpha", 1500);
    await tournamentStore.register(tournament.id, "bravo", 1200);

    const registrationView = await tournamentStore.getBracket(tournament.id);
    expect(registrationView?.operations.missingSlots).toBe(2);
    expect(registrationView?.operations.nextAction).toContain("Recruit");

    const seeded = await tournamentStore.seedBracket(tournament.id);
    expect("error" in seeded).toBe(false);
    if ("error" in seeded) return;

    expect(seeded.operations.nextMatchId).not.toBeNull();
    expect(seeded.operations.nextAction).toContain("match");
    expect(seeded.operations.overlayUrl).toContain(tournament.id);
  });

  it("rolls back the certified report when match persistence fails", async () => {
    const persistence = vi.fn(async (match: { status: string }) => {
      if (match.status === "complete") throw new Error("database unavailable");
    });
    const store = new TournamentStore(persistence);
    const { tournament, match } = await seedTwoPlayerMatch(
      store,
      "Durability Cup",
    );

    const result = await store.reportCertifiedResult(
      match.id,
      "alpha",
      "game-1",
      "certificate-1",
    );

    expect(result).toEqual({
      error: "Certified result persistence failed.",
      code: "PERSISTENCE_FAILED",
    });
    expect(store.getMatch(match.id)).toMatchObject({
      status: "pending",
      winnerId: null,
      gameId: null,
      certificateId: null,
    });
    expect((await store.getBracket(tournament.id))?.tournament.status).toBe(
      "active",
    );
  });

  it("treats the same certified replay as idempotent", async () => {
    const persistence = vi.fn(async (_match: { status: string }) => undefined);
    const store = new TournamentStore(persistence);
    const { match } = await seedTwoPlayerMatch(store, "Replay Cup");

    const first = await store.reportCertifiedResult(
      match.id,
      "alpha",
      "game-1",
      "certificate-1",
    );
    const replay = await store.reportCertifiedResult(
      match.id,
      "alpha",
      "game-1",
      "certificate-1",
    );

    expect("error" in first).toBe(false);
    expect("error" in replay).toBe(false);
    expect(
      persistence.mock.calls.filter(
        ([persisted]) => persisted.status === "complete",
      ),
    ).toHaveLength(1);
  });

  it("serializes conflicting concurrent reports and re-evaluates the loser", async () => {
    let releasePersistence!: () => void;
    let signalPersistenceStarted!: () => void;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const persistenceStarted = new Promise<void>((resolve) => {
      signalPersistenceStarted = resolve;
    });
    const persistence = vi.fn(async (match: { status: string }) => {
      if (match.status !== "complete") return;
      signalPersistenceStarted();
      await persistenceGate;
    });
    const store = new TournamentStore(persistence);
    const { match } = await seedTwoPlayerMatch(store, "Concurrency Cup");

    const accepted = store.reportCertifiedResult(
      match.id,
      "alpha",
      "game-1",
      "certificate-1",
    );
    await persistenceStarted;

    let conflictSettled = false;
    const conflict = store
      .reportCertifiedResult(match.id, "bravo", "game-2", "certificate-2")
      .finally(() => {
        conflictSettled = true;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(conflictSettled).toBe(false);

    releasePersistence();
    expect("error" in (await accepted)).toBe(false);
    await expect(conflict).resolves.toEqual({
      error: "Match already complete.",
      code: "MATCH_ALREADY_COMPLETE",
    });
    expect(
      persistence.mock.calls.filter(
        ([persisted]) => persisted.status === "complete",
      ),
    ).toHaveLength(1);
  });
});
