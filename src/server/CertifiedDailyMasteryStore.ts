/**
 * Daily mastery derived exclusively from server-certified match outcomes.
 *
 * PostgreSQL provides durable, cross-process exactly-once semantics. Local
 * development uses a process-local fallback and exposes that scope in every
 * snapshot and completion receipt.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { getDatabasePosture, pool } from "./db/pool";
import { logger } from "./Logger";

const log = logger.child({ comp: "CertifiedDailyMasteryStore" });

export type CertifiedMasteryMetric =
  | "wins"
  | "vault_captures"
  | "convoy_deliveries"
  | "convoy_intercepts"
  | "execution_chains"
  | "surge_activations";

export interface DailyMasteryDefinition {
  id: string;
  description: string;
  metric: CertifiedMasteryMetric;
  target: number;
  rewardMastery: number;
}

export interface DailyMasterySnapshot {
  challengeId: string;
  description: string;
  progress: number;
  target: number;
  rewardMastery: number;
  completed: boolean;
  masteryBalance: number;
  dateUtc: string;
  evidence: "certified-match-result";
  durability: "postgres" | "process-local";
  doctrines: MasteryDoctrineVault;
}

export type MasteryDoctrineId =
  "route-reader" | "breach-architect" | "vault-warden";

export interface MasteryDoctrineDefinition {
  id: MasteryDoctrineId;
  name: string;
  costMastery: number;
  role: string;
  brief: string;
}

export interface MasteryDoctrineVault {
  catalog: readonly MasteryDoctrineDefinition[];
  ownedIds: MasteryDoctrineId[];
  activeId: MasteryDoctrineId | null;
  effectPolicy: "coaching-and-identity-only";
}

export interface MasteryDoctrineSelectionReceipt {
  persistentId: string;
  requestId: string;
  doctrineId: MasteryDoctrineId;
  unlockedNow: boolean;
  spentMastery: number;
  masteryBalance: number;
  durability: "postgres" | "process-local";
  evidence: "authenticated-mastery-choice";
  receiptDigest: string;
}

type MasteryDoctrineReceiptPayload = Omit<
  MasteryDoctrineSelectionReceipt,
  "receiptDigest"
>;

export function masteryDoctrineReceiptDigest(
  receipt: MasteryDoctrineReceiptPayload,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        receipt.persistentId,
        receipt.requestId,
        receipt.doctrineId,
        receipt.unlockedNow,
        receipt.spentMastery,
        receipt.masteryBalance,
        receipt.durability,
        receipt.evidence,
      ]),
    )
    .digest("hex");
}

export function verifyMasteryDoctrineReceipt(
  receipt: MasteryDoctrineSelectionReceipt,
): boolean {
  if (!/^[a-f0-9]{64}$/u.test(receipt.receiptDigest)) return false;
  const expected = Buffer.from(masteryDoctrineReceiptDigest(receipt), "hex");
  const actual = Buffer.from(receipt.receiptDigest, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class MasteryDoctrineSelectionError extends Error {
  constructor(
    readonly code:
      "invalid-doctrine" | "insufficient-mastery" | "request-conflict",
    message: string,
  ) {
    super(message);
    this.name = "MasteryDoctrineSelectionError";
  }
}

export interface DailyMasteryCompletionReceipt {
  persistentId: string;
  challengeId: string;
  dateUtc: string;
  progress: number;
  target: number;
  rewardMastery: number;
  completedNow: boolean;
  masteryBalance: number;
  durability: "postgres" | "process-local";
}

export interface CertifiedMasteryOutcome {
  persistentId: string;
  won: boolean;
  vaultCaptures: number;
  convoyDeliveries: number;
  convoyIntercepts: number;
  executionChains: number;
  surgeActivations: number;
}

const CHALLENGES: readonly DailyMasteryDefinition[] = [
  {
    id: "intercept-3",
    description: "Intercept 3 enemy convoys",
    metric: "convoy_intercepts",
    target: 3,
    rewardMastery: 60,
  },
  {
    id: "vault-5",
    description: "Capture 5 vault sites",
    metric: "vault_captures",
    target: 5,
    rewardMastery: 50,
  },
  {
    id: "deliver-5",
    description: "Deliver 5 convoys safely",
    metric: "convoy_deliveries",
    target: 5,
    rewardMastery: 50,
  },
  {
    id: "chain-3",
    description: "Execute 3 clean convoy chains",
    metric: "execution_chains",
    target: 3,
    rewardMastery: 65,
  },
  {
    id: "surge-2",
    description: "Activate Surge twice",
    metric: "surge_activations",
    target: 2,
    rewardMastery: 55,
  },
  {
    id: "victory-1",
    description: "Win a certified match",
    metric: "wins",
    target: 1,
    rewardMastery: 75,
  },
] as const;

export const MASTERY_DOCTRINES: readonly MasteryDoctrineDefinition[] = [
  {
    id: "route-reader",
    name: "Route Reader",
    costMastery: 50,
    role: "Convoy tactician",
    brief: "Frame the next match around escort timing and interception lanes.",
  },
  {
    id: "breach-architect",
    name: "Breach Architect",
    costMastery: 100,
    role: "Pressure shot-caller",
    brief:
      "Frame coaching around contribution tempo and the decisive delivery.",
  },
  {
    id: "vault-warden",
    name: "Vault Warden",
    costMastery: 150,
    role: "Extraction controller",
    brief:
      "Frame coaching around vault defense, recapture, and safe conversion.",
  },
] as const;

interface MemoryProgress {
  progress: number;
  completed: boolean;
}

export interface DailyMasteryStoreOptions {
  now?: () => Date;
  pool?: () => Pool | null;
  databaseConfigured?: () => boolean;
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function metricAmount(
  outcome: CertifiedMasteryOutcome,
  metric: CertifiedMasteryMetric,
): number {
  if (metric === "wins") return outcome.won ? 1 : 0;
  const fields = {
    vault_captures: "vaultCaptures",
    convoy_deliveries: "convoyDeliveries",
    convoy_intercepts: "convoyIntercepts",
    execution_chains: "executionChains",
    surge_activations: "surgeActivations",
  } as const;
  return safeCount(outcome[fields[metric]]);
}

export class CertifiedDailyMasteryStore {
  private readonly progress = new Map<string, MemoryProgress>();
  private readonly processed = new Set<string>();
  private readonly balances = new Map<string, number>();
  private readonly doctrineUnlocks = new Map<string, Set<MasteryDoctrineId>>();
  private readonly activeDoctrines = new Map<string, MasteryDoctrineId>();
  private readonly doctrineRequests = new Map<
    string,
    { doctrineId: MasteryDoctrineId; receipt: MasteryDoctrineSelectionReceipt }
  >();
  private readonly now: () => Date;
  private readonly poolProvider: () => Pool | null;
  private readonly databaseConfigured: () => boolean;

  constructor(options: DailyMasteryStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.poolProvider = options.pool ?? (() => pool);
    this.databaseConfigured =
      options.databaseConfigured ?? (() => getDatabasePosture().configured);
  }

  private dateUtc(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private definition(dateUtc: string): DailyMasteryDefinition {
    let seed = 0;
    for (const char of dateUtc) {
      seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    }
    return CHALLENGES[seed % CHALLENGES.length];
  }

  private progressKey(persistentId: string, dateUtc: string): string {
    return `${persistentId}:${dateUtc}`;
  }

  async getChallenge(persistentId: string): Promise<DailyMasterySnapshot> {
    const dateUtc = this.dateUtc();
    const challenge = this.definition(dateUtc);
    const database = this.poolProvider();
    if (database) {
      const result = await database.query(
        `SELECT p.progress, p.completed_at,
                COALESCE(w.mastery_balance, 0) AS mastery_balance
           FROM (SELECT $1::varchar AS persistent_id) subject
           LEFT JOIN daily_mastery_progress p
             ON p.persistent_id = subject.persistent_id
            AND p.challenge_date = $2::date
           LEFT JOIN daily_mastery_wallet w
             ON w.persistent_id = subject.persistent_id`,
        [persistentId, dateUtc],
      );
      const row = result.rows[0] ?? {};
      const [unlocks, profile] = await Promise.all([
        database.query(
          "SELECT doctrine_id FROM daily_mastery_doctrine_unlocks WHERE persistent_id = $1 ORDER BY unlocked_at, doctrine_id",
          [persistentId],
        ),
        database.query(
          "SELECT active_doctrine_id FROM daily_mastery_doctrine_profiles WHERE persistent_id = $1",
          [persistentId],
        ),
      ]);
      return this.snapshot(
        challenge,
        dateUtc,
        Number(row.progress ?? 0),
        Boolean(row.completed_at),
        Number(row.mastery_balance ?? 0),
        "postgres",
        unlocks.rows.map((entry) => entry.doctrine_id as MasteryDoctrineId),
        (profile.rows[0]?.active_doctrine_id as
          MasteryDoctrineId | undefined) ?? null,
      );
    }
    if (this.databaseConfigured()) {
      throw new Error("daily mastery persistence unavailable");
    }
    const state = this.progress.get(this.progressKey(persistentId, dateUtc));
    return this.snapshot(
      challenge,
      dateUtc,
      state?.progress ?? 0,
      state?.completed ?? false,
      this.balances.get(persistentId) ?? 0,
      "process-local",
      [...(this.doctrineUnlocks.get(persistentId) ?? [])],
      this.activeDoctrines.get(persistentId) ?? null,
    );
  }

  async selectDoctrine(
    persistentId: string,
    doctrineId: string,
    requestId: string,
  ): Promise<MasteryDoctrineSelectionReceipt> {
    const doctrine = MASTERY_DOCTRINES.find((item) => item.id === doctrineId);
    if (!doctrine) {
      throw new MasteryDoctrineSelectionError(
        "invalid-doctrine",
        "Unknown Mastery Doctrine",
      );
    }
    const database = this.poolProvider();
    if (database) {
      return this.selectDoctrinePostgres(
        database,
        persistentId,
        doctrine,
        requestId,
      );
    }
    if (this.databaseConfigured()) {
      throw new Error("daily mastery persistence unavailable");
    }
    return this.selectDoctrineMemory(persistentId, doctrine, requestId);
  }

  private selectDoctrineMemory(
    persistentId: string,
    doctrine: MasteryDoctrineDefinition,
    requestId: string,
  ): MasteryDoctrineSelectionReceipt {
    const requestKey = `${persistentId}:${requestId}`;
    const replay = this.doctrineRequests.get(requestKey);
    if (replay) {
      if (replay.doctrineId !== doctrine.id) {
        throw new MasteryDoctrineSelectionError(
          "request-conflict",
          "Request ID was already used for another doctrine",
        );
      }
      return replay.receipt;
    }
    const owned = this.doctrineUnlocks.get(persistentId) ?? new Set();
    const unlockedNow = !owned.has(doctrine.id);
    const spentMastery = unlockedNow ? doctrine.costMastery : 0;
    const balance = this.balances.get(persistentId) ?? 0;
    if (balance < spentMastery) {
      throw new MasteryDoctrineSelectionError(
        "insufficient-mastery",
        `Requires ${doctrine.costMastery} Mastery`,
      );
    }
    if (unlockedNow) owned.add(doctrine.id);
    this.doctrineUnlocks.set(persistentId, owned);
    this.activeDoctrines.set(persistentId, doctrine.id);
    this.balances.set(persistentId, balance - spentMastery);
    const receipt = this.doctrineReceipt(
      persistentId,
      requestId,
      doctrine.id,
      unlockedNow,
      spentMastery,
      balance - spentMastery,
      "process-local",
    );
    this.doctrineRequests.set(requestKey, {
      doctrineId: doctrine.id,
      receipt,
    });
    return receipt;
  }

  private async selectDoctrinePostgres(
    database: Pool,
    persistentId: string,
    doctrine: MasteryDoctrineDefinition,
    requestId: string,
  ): Promise<MasteryDoctrineSelectionReceipt> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const reservation = await client.query(
        `INSERT INTO daily_mastery_doctrine_requests
           (persistent_id, request_id, doctrine_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING request_id`,
        [persistentId, requestId, doctrine.id],
      );
      if (reservation.rowCount === 0) {
        const prior = await client.query(
          `SELECT doctrine_id, receipt
             FROM daily_mastery_doctrine_requests
            WHERE persistent_id = $1 AND request_id = $2`,
          [persistentId, requestId],
        );
        if (prior.rows[0]?.doctrine_id !== doctrine.id) {
          throw new MasteryDoctrineSelectionError(
            "request-conflict",
            "Request ID was already used for another doctrine",
          );
        }
        const receipt = prior.rows[0]?.receipt as
          MasteryDoctrineSelectionReceipt | undefined;
        if (!receipt) throw new Error("Mastery Doctrine receipt unavailable");
        await client.query("COMMIT");
        return receipt;
      }
      await client.query(
        `INSERT INTO daily_mastery_wallet (persistent_id, mastery_balance)
         VALUES ($1, 0) ON CONFLICT DO NOTHING`,
        [persistentId],
      );
      const wallet = await client.query(
        "SELECT mastery_balance FROM daily_mastery_wallet WHERE persistent_id = $1 FOR UPDATE",
        [persistentId],
      );
      const balance = Number(wallet.rows[0]?.mastery_balance ?? 0);
      const existing = await client.query(
        `SELECT doctrine_id FROM daily_mastery_doctrine_unlocks
          WHERE persistent_id = $1 AND doctrine_id = $2`,
        [persistentId, doctrine.id],
      );
      const unlockedNow = existing.rowCount === 0;
      const spentMastery = unlockedNow ? doctrine.costMastery : 0;
      if (balance < spentMastery) {
        throw new MasteryDoctrineSelectionError(
          "insufficient-mastery",
          `Requires ${doctrine.costMastery} Mastery`,
        );
      }
      if (unlockedNow) {
        await client.query(
          `UPDATE daily_mastery_wallet
              SET mastery_balance = mastery_balance - $2, updated_at = NOW()
            WHERE persistent_id = $1`,
          [persistentId, spentMastery],
        );
        await client.query(
          `INSERT INTO daily_mastery_doctrine_unlocks
             (persistent_id, doctrine_id, cost_mastery)
           VALUES ($1, $2, $3)`,
          [persistentId, doctrine.id, spentMastery],
        );
      }
      await client.query(
        `INSERT INTO daily_mastery_doctrine_profiles
           (persistent_id, active_doctrine_id, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (persistent_id) DO UPDATE SET
           active_doctrine_id = EXCLUDED.active_doctrine_id,
           updated_at = NOW()`,
        [persistentId, doctrine.id],
      );
      const receipt = this.doctrineReceipt(
        persistentId,
        requestId,
        doctrine.id,
        unlockedNow,
        spentMastery,
        balance - spentMastery,
        "postgres",
      );
      await client.query(
        `UPDATE daily_mastery_doctrine_requests SET receipt = $3::jsonb
          WHERE persistent_id = $1 AND request_id = $2`,
        [persistentId, requestId, JSON.stringify(receipt)],
      );
      await client.query("COMMIT");
      return receipt;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordCertifiedMatch(
    gameId: string,
    outcome: CertifiedMasteryOutcome,
  ): Promise<DailyMasteryCompletionReceipt | null> {
    const dateUtc = this.dateUtc();
    const challenge = this.definition(dateUtc);
    const amount = metricAmount(outcome, challenge.metric);
    const database = this.poolProvider();
    if (database) {
      return this.recordPostgres(
        database,
        gameId,
        outcome.persistentId,
        dateUtc,
        challenge,
        amount,
      );
    }
    if (this.databaseConfigured()) {
      throw new Error("daily mastery persistence unavailable");
    }
    return this.recordMemory(
      gameId,
      outcome.persistentId,
      dateUtc,
      challenge,
      amount,
    );
  }

  private recordMemory(
    gameId: string,
    persistentId: string,
    dateUtc: string,
    challenge: DailyMasteryDefinition,
    amount: number,
  ): DailyMasteryCompletionReceipt | null {
    const eventKey = `${persistentId}:${dateUtc}:${gameId}`;
    if (this.processed.has(eventKey)) return null;
    this.processed.add(eventKey);
    const key = this.progressKey(persistentId, dateUtc);
    const prior = this.progress.get(key) ?? { progress: 0, completed: false };
    const progress = Math.min(challenge.target, prior.progress + amount);
    const completedNow = !prior.completed && progress >= challenge.target;
    this.progress.set(key, {
      progress,
      completed: prior.completed || completedNow,
    });
    const masteryBalance =
      (this.balances.get(persistentId) ?? 0) +
      (completedNow ? challenge.rewardMastery : 0);
    this.balances.set(persistentId, masteryBalance);
    return this.receipt(
      persistentId,
      challenge,
      dateUtc,
      progress,
      completedNow,
      masteryBalance,
      "process-local",
    );
  }

  private async recordPostgres(
    database: Pool,
    gameId: string,
    persistentId: string,
    dateUtc: string,
    challenge: DailyMasteryDefinition,
    amount: number,
  ): Promise<DailyMasteryCompletionReceipt | null> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO daily_mastery_events
           (persistent_id, challenge_date, game_id, challenge_id, metric, amount)
         VALUES ($1, $2::date, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING RETURNING game_id`,
        [persistentId, dateUtc, gameId, challenge.id, challenge.metric, amount],
      );
      if (inserted.rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const priorResult = await client.query(
        `SELECT progress, completed_at
           FROM daily_mastery_progress
          WHERE persistent_id = $1 AND challenge_date = $2::date
          FOR UPDATE`,
        [persistentId, dateUtc],
      );
      const prior = priorResult.rows[0];
      const progress = Math.min(
        challenge.target,
        Number(prior?.progress ?? 0) + amount,
      );
      const completedNow = !prior?.completed_at && progress >= challenge.target;
      await client.query(
        `INSERT INTO daily_mastery_progress
           (persistent_id, challenge_date, challenge_id, progress, target,
            reward_mastery, completed_at, updated_at)
         VALUES ($1, $2::date, $3, $4, $5, $6,
                 CASE WHEN $7 THEN NOW() ELSE NULL END, NOW())
         ON CONFLICT (persistent_id, challenge_date) DO UPDATE
           SET progress = EXCLUDED.progress,
               completed_at = COALESCE(
                 daily_mastery_progress.completed_at,
                 EXCLUDED.completed_at
               ),
               updated_at = NOW()`,
        [
          persistentId,
          dateUtc,
          challenge.id,
          progress,
          challenge.target,
          challenge.rewardMastery,
          completedNow,
        ],
      );
      let masteryBalance = 0;
      if (completedNow) {
        const wallet = await client.query(
          `INSERT INTO daily_mastery_wallet
             (persistent_id, mastery_balance, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (persistent_id) DO UPDATE
             SET mastery_balance =
                   daily_mastery_wallet.mastery_balance +
                   EXCLUDED.mastery_balance,
                 updated_at = NOW()
           RETURNING mastery_balance`,
          [persistentId, challenge.rewardMastery],
        );
        masteryBalance = Number(wallet.rows[0].mastery_balance);
      } else {
        const wallet = await client.query(
          "SELECT mastery_balance FROM daily_mastery_wallet WHERE persistent_id = $1",
          [persistentId],
        );
        masteryBalance = Number(wallet.rows[0]?.mastery_balance ?? 0);
      }
      await client.query("COMMIT");
      return this.receipt(
        persistentId,
        challenge,
        dateUtc,
        progress,
        completedNow,
        masteryBalance,
        "postgres",
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private snapshot(
    challenge: DailyMasteryDefinition,
    dateUtc: string,
    progress: number,
    completed: boolean,
    masteryBalance: number,
    durability: DailyMasterySnapshot["durability"],
    ownedIds: MasteryDoctrineId[],
    activeId: MasteryDoctrineId | null,
  ): DailyMasterySnapshot {
    return {
      challengeId: challenge.id,
      description: challenge.description,
      progress,
      target: challenge.target,
      rewardMastery: challenge.rewardMastery,
      completed,
      masteryBalance,
      dateUtc,
      evidence: "certified-match-result",
      durability,
      doctrines: {
        catalog: MASTERY_DOCTRINES,
        ownedIds,
        activeId,
        effectPolicy: "coaching-and-identity-only",
      },
    };
  }

  private doctrineReceipt(
    persistentId: string,
    requestId: string,
    doctrineId: MasteryDoctrineId,
    unlockedNow: boolean,
    spentMastery: number,
    masteryBalance: number,
    durability: MasteryDoctrineSelectionReceipt["durability"],
  ): MasteryDoctrineSelectionReceipt {
    const receipt: MasteryDoctrineReceiptPayload = {
      persistentId,
      requestId,
      doctrineId,
      unlockedNow,
      spentMastery,
      masteryBalance,
      durability,
      evidence: "authenticated-mastery-choice",
    };
    return { ...receipt, receiptDigest: masteryDoctrineReceiptDigest(receipt) };
  }

  private receipt(
    persistentId: string,
    challenge: DailyMasteryDefinition,
    dateUtc: string,
    progress: number,
    completedNow: boolean,
    masteryBalance: number,
    durability: DailyMasteryCompletionReceipt["durability"],
  ): DailyMasteryCompletionReceipt {
    const receipt = {
      persistentId,
      challengeId: challenge.id,
      dateUtc,
      progress,
      target: challenge.target,
      rewardMastery: challenge.rewardMastery,
      completedNow,
      masteryBalance,
      durability,
    };
    if (completedNow) {
      log.info("certified daily mastery completed", receipt);
    }
    return receipt;
  }
}

export const certifiedDailyMasteryStore = new CertifiedDailyMasteryStore();
