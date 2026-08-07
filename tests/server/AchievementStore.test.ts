import { describe, expect, test, vi } from "vitest";
import { AchievementStore } from "../../src/server/AchievementStore";

vi.mock("../../src/server/db/pool", () => ({
  pool: null,
  getDatabasePosture: () => ({ configured: false, state: "disabled" }),
}));
vi.mock("../../src/server/Logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

type Row = { achievement_id: string; unlocked_at: Date };

function memoryDatabase() {
  const rows = new Map<string, Map<string, Date>>();
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    const actor = String(values[0]);
    if (text.includes("SELECT achievement_id")) {
      return {
        rows: [...(rows.get(actor)?.entries() ?? [])].map(
          ([achievement_id, unlocked_at]): Row => ({
            achievement_id,
            unlocked_at,
          }),
        ),
        rowCount: rows.get(actor)?.size ?? 0,
      };
    }
    if (text.includes("INSERT INTO player_achievements")) {
      const achievementId = String(values[1]);
      const actorRows = rows.get(actor) ?? new Map<string, Date>();
      rows.set(actor, actorRows);
      if (actorRows.has(achievementId)) return { rows: [], rowCount: 0 };
      actorRows.set(achievementId, new Date("2026-08-05T12:00:00.000Z"));
      return {
        rows: [{ achievement_id: achievementId }],
        rowCount: 1,
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  return { rows, query, database: { query } };
}

const readyPosture = () => ({ configured: true, state: "ready" });

describe("AchievementStore authoritative hydration", () => {
  test("rehydrates unlocks after restart before exposing progress", async () => {
    const db = memoryDatabase();
    const first = new AchievementStore({
      database: () => db.database,
      databasePosture: readyPosture,
    });
    expect(
      await first.checkAndUnlock("actor-1", {
        type: "vault_captured",
        count: 1,
      }),
    ).toMatchObject([{ id: "first_vault" }]);

    const restarted = new AchievementStore({
      database: () => db.database,
      databasePosture: readyPosture,
    });
    expect(restarted.getHydrationState("actor-1").status).toBe("unhydrated");
    await restarted.ensureHydrated("actor-1");
    expect(restarted.getUnlocked("actor-1")).toContain("first_vault");
    expect(
      restarted.getProgress("actor-1").find(({ id }) => id === "first_vault"),
    ).toMatchObject({ progress: 100, progressLabel: "Unlocked" });
    expect(restarted.getHydrationState("actor-1")).toMatchObject({
      status: "ready",
      source: "postgres",
      errorCode: null,
    });
  });

  test("singleflights concurrent actor hydration", async () => {
    let release!: (value: { rows: Row[]; rowCount: number }) => void;
    const pending = new Promise<{ rows: Row[]; rowCount: number }>(
      (resolve) => {
        release = resolve;
      },
    );
    const query = vi.fn(() => pending);
    const store = new AchievementStore({
      database: () => ({ query }),
      databasePosture: readyPosture,
    });

    const first = store.ensureHydrated("same-actor");
    const second = store.ensureHydrated("same-actor");
    expect(query).toHaveBeenCalledOnce();
    release({
      rows: [
        {
          achievement_id: "first_vault",
          unlocked_at: new Date("2026-08-05T12:00:00.000Z"),
        },
      ],
      rowCount: 1,
    });
    expect(await first).toEqual(await second);
    expect(store.getUnlocked("same-actor")).toEqual(["first_vault"]);
  });

  test("deduplicates the same unlock across worker-local stores", async () => {
    const db = memoryDatabase();
    const firstWorker = new AchievementStore({
      database: () => db.database,
      databasePosture: readyPosture,
    });
    const secondWorker = new AchievementStore({
      database: () => db.database,
      databasePosture: readyPosture,
    });

    const results = await Promise.all([
      firstWorker.checkAndUnlock("shared-actor", {
        type: "vault_captured",
        count: 1,
      }),
      secondWorker.checkAndUnlock("shared-actor", {
        type: "vault_captured",
        count: 1,
      }),
    ]);

    expect(results.flat().map(({ id }) => id)).toEqual(["first_vault"]);
    expect(firstWorker.getUnlocked("shared-actor")).toContain("first_vault");
    expect(secondWorker.getUnlocked("shared-actor")).toContain("first_vault");
    expect(db.rows.get("shared-actor")?.has("first_vault")).toBe(true);
  });

  test("bounds a failed persistence path and exposes degraded truth", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(new Error("database unavailable"));
    const store = new AchievementStore({
      database: () => ({ query }),
      databasePosture: readyPosture,
      queryTimeoutMs: 25,
    });

    const unlocked = await store.checkAndUnlock("degraded-actor", {
      type: "vault_captured",
      count: 1,
    });
    expect(unlocked).toMatchObject([{ id: "first_vault" }]);
    expect(store.getUnlocked("degraded-actor")).toContain("first_vault");
    expect(store.getHydrationState("degraded-actor")).toMatchObject({
      status: "degraded",
      source: "process-local",
      errorCode: "query-failed",
      pendingWrites: false,
    });
  });

  test("persists meta-chain unlocks through the canonical insert queue", async () => {
    const db = memoryDatabase();
    db.rows.set(
      "meta-actor",
      new Map([
        ["first_vault", new Date("2026-08-01T00:00:00.000Z")],
        ["five_vaults", new Date("2026-08-02T00:00:00.000Z")],
      ]),
    );
    const store = new AchievementStore({
      database: () => db.database,
      databasePosture: readyPosture,
    });

    const unlocked = await store.checkAndUnlock("meta-actor", {
      type: "match_ended",
      won: false,
      durationSeconds: 900,
      onMutator: false,
      eloRating: 1900,
    });
    expect(unlocked.map(({ id }) => id)).toEqual([
      "grandmaster",
      "vault_sovereign",
    ]);
    expect([...db.rows.get("meta-actor")!.keys()]).toEqual(
      expect.arrayContaining(["grandmaster", "vault_sovereign"]),
    );
    expect(
      db.query.mock.calls.filter(([text]) =>
        String(text).includes("INSERT INTO player_achievements"),
      ),
    ).toHaveLength(2);
  });

  test("refreshes expired actors and evicts the least-recently-used cache", async () => {
    const db = memoryDatabase();
    let now = Date.parse("2026-08-05T12:00:00.000Z");
    const store = new AchievementStore({
      database: () => db.database,
      databasePosture: readyPosture,
      now: () => now,
      hydrationTtlMs: 10,
      maxCachedActors: 1,
    });
    await store.ensureHydrated("actor-a");
    now += 11;
    await store.ensureHydrated("actor-b");
    expect(store.getHydrationState("actor-a").status).toBe("unhydrated");
    expect(
      db.query.mock.calls.filter(([text]) =>
        String(text).includes("SELECT achievement_id"),
      ),
    ).toHaveLength(2);
  });
});
