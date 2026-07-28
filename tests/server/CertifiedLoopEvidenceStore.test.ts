import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  CertifiedLoopEvidenceStore,
  type CertifiedLoopEvidenceInput,
} from "../../src/server/CertifiedLoopEvidenceStore";

vi.mock("../../src/server/Logger", () => {
  const log = {
    child: () => log,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: log };
});

const input: CertifiedLoopEvidenceInput = {
  gameId: "game-1",
  durationSeconds: 420,
  turnIntervalMs: 100,
  players: [
    {
      vaultCaptures: 2,
      convoyDeliveries: 1,
      convoyIntercepts: 0,
      convoysLost: 0,
      firstVaultCaptureTick: 120,
      firstConvoyOutcomeTick: 300,
      firstVaultPressureTick: 100,
      firstBreachOpenTick: 200,
      decisiveDeliveryTick: 300,
      vaultBreachVictoryTick: 300,
    },
    {
      vaultCaptures: 0,
      convoyDeliveries: 0,
      convoyIntercepts: 1,
      convoysLost: 1,
      firstConvoyOutcomeTick: 500,
      firstVaultPressureTick: 400,
    },
  ],
  intentFunnel: {
    early: { "vault.scout": 3 },
    mid: { "convoy.escort": 2 },
    late: { "convoy.intercept": 1 },
  },
};

describe("CertifiedLoopEvidenceStore", () => {
  test("declares an idempotent PostgreSQL pressure-funnel migration", () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), "src", "server", "db", "schema.sql"),
      "utf8",
    );

    expect(schema).toMatch(
      /pressure_breach_funnel\s+JSONB NOT NULL DEFAULT '\{\}'/,
    );
    expect(schema).toMatch(
      /ADD COLUMN IF NOT EXISTS pressure_breach_funnel JSONB NOT NULL DEFAULT '\{\}'/,
    );
  });

  test("derives privacy-minimal timing and participation once per certified game", async () => {
    const store = new CertifiedLoopEvidenceStore({
      pool: () => null,
      databaseConfigured: () => false,
      now: () => 123,
    });

    await expect(store.recordCertifiedMatch(input)).resolves.toMatchObject({
      gameId: "game-1",
      playerSamples: 2,
      vaultParticipants: 1,
      outcomeParticipants: 2,
      completedCycleParticipants: 1,
      pressureParticipants: 2,
      breachParticipants: 1,
      decisiveDeliveryParticipants: 1,
      victoryParticipants: 1,
      evidence: "certified-match-result",
      durability: "process-local",
    });
    await expect(store.recordCertifiedMatch(input)).resolves.toBeNull();
    await expect(store.getSummary()).resolves.toEqual({
      generatedAt: 123,
      matches: 1,
      playerSamples: 2,
      vaultParticipants: 1,
      outcomeParticipants: 2,
      completedCycleParticipants: 1,
      pressureParticipants: 2,
      breachParticipants: 1,
      decisiveDeliveryParticipants: 1,
      victoryParticipants: 1,
      vaultParticipationRatePct: 50,
      cycleCompletionRatePct: 100,
      averageFirstVaultSeconds: 12,
      averageFirstOutcomeSeconds: 40,
      pressureParticipationRatePct: 100,
      pressureToBreachConversionRatePct: 50,
      breachToDecisiveDeliveryConversionRatePct: 100,
      breachToVictoryConversionRatePct: 100,
      averageFirstPressureSeconds: 25,
      averageFirstBreachSeconds: 20,
      averageDecisiveDeliverySeconds: 30,
      averageVaultBreachVictorySeconds: 30,
      phases: input.intentFunnel,
      evidence: "certified-match-result",
      durability: "process-local",
    });
    expect(JSON.stringify(await store.getSummary())).not.toContain("player-");
  });

  test("isolates matches, sanitizes intent keys, and bounds invalid counters", async () => {
    const store = new CertifiedLoopEvidenceStore({
      pool: () => null,
      databaseConfigured: () => false,
    });
    await store.recordCertifiedMatch({
      ...input,
      gameId: "game-2",
      players: [{ ...input.players[0], vaultCaptures: -1 }],
      intentFunnel: {
        early: { "bad intent!": 100_001 },
        mid: {},
        late: {},
      },
    });
    const summary = await store.getSummary();
    expect(summary.matches).toBe(1);
    expect(summary.vaultParticipants).toBe(0);
    expect(summary.phases.early).toEqual({ bad_intent_: 100_000 });
  });

  test("fails closed when configured persistence is unavailable", async () => {
    const store = new CertifiedLoopEvidenceStore({
      pool: () => null,
      databaseConfigured: () => true,
    });
    await expect(store.recordCertifiedMatch(input)).rejects.toThrow(
      "persistence unavailable",
    );
    await expect(store.getSummary()).rejects.toThrow("persistence unavailable");
  });

  test("returns honest zero conversions and null timings for empty samples", async () => {
    const store = new CertifiedLoopEvidenceStore({
      pool: () => null,
      databaseConfigured: () => false,
      now: () => 456,
    });
    await store.recordCertifiedMatch({
      ...input,
      gameId: "empty",
      players: [],
      intentFunnel: { early: {}, mid: {}, late: {} },
    });

    await expect(store.getSummary()).resolves.toMatchObject({
      generatedAt: 456,
      matches: 1,
      playerSamples: 0,
      pressureParticipants: 0,
      breachParticipants: 0,
      decisiveDeliveryParticipants: 0,
      victoryParticipants: 0,
      pressureParticipationRatePct: 0,
      pressureToBreachConversionRatePct: 0,
      breachToDecisiveDeliveryConversionRatePct: 0,
      breachToVictoryConversionRatePct: 0,
      averageFirstPressureSeconds: null,
      averageFirstBreachSeconds: null,
      averageDecisiveDeliverySeconds: null,
      averageVaultBreachVictorySeconds: null,
    });
  });

  test("uses an idempotent PostgreSQL insert and reports durable evidence", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ game_id: "game-1" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const store = new CertifiedLoopEvidenceStore({
      pool: () => ({ query }) as any,
      databaseConfigured: () => true,
    });
    await expect(store.recordCertifiedMatch(input)).resolves.toMatchObject({
      durability: "postgres",
    });
    await expect(store.recordCertifiedMatch(input)).resolves.toBeNull();
    expect(query.mock.calls[0][0]).toContain("ON CONFLICT DO NOTHING");
    expect(query.mock.calls[0][1]).toHaveLength(12);
    expect(JSON.parse(query.mock.calls[0][1][10])).toMatchObject({
      pressureParticipants: 2,
      breachParticipants: 1,
      decisiveDeliveryParticipants: 1,
      victoryParticipants: 1,
    });
  });

  test("keeps process-local and PostgreSQL aggregate projections identical", async () => {
    let inserted: unknown[] = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("INSERT INTO")) {
        inserted = params;
        return { rows: [{ game_id: params[0] }], rowCount: 1 };
      }
      return {
        rowCount: 1,
        rows: [
          {
            game_id: inserted[0],
            duration_seconds: inserted[1],
            player_samples: inserted[2],
            vault_participants: inserted[3],
            outcome_participants: inserted[4],
            completed_cycle_participants: inserted[5],
            first_vault_seconds_total: inserted[6],
            first_vault_samples: inserted[7],
            first_outcome_seconds_total: inserted[8],
            first_outcome_samples: inserted[9],
            pressure_breach_funnel: JSON.parse(String(inserted[10])),
            intent_funnel: JSON.parse(String(inserted[11])),
          },
        ],
      };
    });
    const postgres = new CertifiedLoopEvidenceStore({
      pool: () => ({ query }) as any,
      databaseConfigured: () => true,
      now: () => 789,
    });
    const processLocal = new CertifiedLoopEvidenceStore({
      pool: () => null,
      databaseConfigured: () => false,
      now: () => 789,
    });

    await postgres.recordCertifiedMatch(input);
    await processLocal.recordCertifiedMatch(input);
    const [postgresSummary, localSummary] = await Promise.all([
      postgres.getSummary(),
      processLocal.getSummary(),
    ]);

    expect(postgresSummary).toEqual({
      ...localSummary,
      durability: "postgres",
    });
    expect(JSON.stringify(postgresSummary)).not.toMatch(/persistent|player-/i);
  });
});
