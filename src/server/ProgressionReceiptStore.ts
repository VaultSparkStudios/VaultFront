import { pool } from "./db/pool";
import type { ProgressionReceipt } from "./MatchProgression";

interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

interface ReceiptDatabase {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

interface StoredRow {
  receipt: ProgressionReceipt | string;
  actor_ids: string[];
}

export const PROGRESSION_RECEIPT_RETENTION_DAYS = 30;
const RETENTION_MS = PROGRESSION_RECEIPT_RETENTION_DAYS * 86_400_000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1_000;

export class ProgressionReceiptStore {
  private readonly memory = new Map<
    string,
    { receipt: ProgressionReceipt; actorIds: Set<string>; recordedAtMs: number }
  >();
  private lastPrunedAt = Number.NEGATIVE_INFINITY;

  public constructor(
    private readonly database: () => ReceiptDatabase | null = () =>
      pool as ReceiptDatabase | null,
    private readonly now: () => number = Date.now,
  ) {}

  public durability(): "postgres" | "process-local" {
    return this.database() ? "postgres" : "process-local";
  }

  public async put(
    receipt: ProgressionReceipt,
    actorIds: string[],
  ): Promise<void> {
    await this.pruneIfDue();
    const canonicalActors = [...new Set(actorIds)].sort();
    const database = this.database();
    if (!database) {
      this.memory.set(receipt.gameId, {
        receipt: structuredClone(receipt),
        actorIds: new Set(canonicalActors),
        recordedAtMs: Date.parse(receipt.recordedAt),
      });
      return;
    }
    const result = await database.query<{ receipt_digest: string }>(
      `INSERT INTO match_progression_receipts
        (game_id, actor_ids, receipt, receipt_digest, recorded_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (game_id) DO NOTHING
       RETURNING receipt_digest`,
      [
        receipt.gameId,
        canonicalActors,
        JSON.stringify(receipt),
        receipt.receiptDigest,
        receipt.recordedAt,
      ],
    );
    if ((result.rowCount ?? result.rows.length) > 0) return;
    const existing = await database.query<{ receipt_digest: string }>(
      "SELECT receipt_digest FROM match_progression_receipts WHERE game_id = $1",
      [receipt.gameId],
    );
    if (existing.rows[0]?.receipt_digest !== receipt.receiptDigest) {
      throw new Error("progression receipt conflict for certified game");
    }
  }

  public async get(gameId: string): Promise<ProgressionReceipt | null> {
    await this.pruneIfDue();
    const local = this.memory.get(gameId);
    if (local) return structuredClone(local.receipt);
    const database = this.database();
    if (!database) return null;
    const result = await database.query<StoredRow>(
      "SELECT receipt, actor_ids FROM match_progression_receipts WHERE game_id = $1",
      [gameId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return typeof row.receipt === "string"
      ? JSON.parse(row.receipt)
      : structuredClone(row.receipt);
  }

  public async getForActor(
    gameId: string,
    actorId: string,
  ): Promise<ProgressionReceipt | null> {
    await this.pruneIfDue();
    const local = this.memory.get(gameId);
    if (local)
      return local.actorIds.has(actorId)
        ? structuredClone(local.receipt)
        : null;
    const database = this.database();
    if (!database) return null;
    const result = await database.query<StoredRow>(
      `SELECT receipt, actor_ids FROM match_progression_receipts
       WHERE game_id = $1 AND $2 = ANY(actor_ids)`,
      [gameId, actorId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return typeof row.receipt === "string"
      ? JSON.parse(row.receipt)
      : structuredClone(row.receipt);
  }

  private async pruneIfDue(): Promise<void> {
    if (this.now() - this.lastPrunedAt < PRUNE_INTERVAL_MS) return;
    await this.pruneExpired();
  }

  public async pruneExpired(): Promise<number> {
    const now = this.now();
    const cutoff = now - RETENTION_MS;
    let removed = 0;
    for (const [gameId, stored] of this.memory.entries()) {
      if (
        !Number.isFinite(stored.recordedAtMs) ||
        stored.recordedAtMs >= cutoff
      )
        continue;
      this.memory.delete(gameId);
      removed += 1;
    }
    const database = this.database();
    if (database) {
      const result = await database.query(
        "DELETE FROM match_progression_receipts WHERE recorded_at < $1",
        [new Date(cutoff).toISOString()],
      );
      removed += result.rowCount ?? 0;
    }
    this.lastPrunedAt = now;
    return removed;
  }
}

export const progressionReceiptStore = new ProgressionReceiptStore();
