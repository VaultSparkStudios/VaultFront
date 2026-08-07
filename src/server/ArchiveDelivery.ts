import type { GameRecord } from "../core/Schemas";
import { replacer } from "../core/Util";
import { pool } from "./db/pool";

export type ArchiveDeliveryKind = "certified" | "incomplete";
export type ArchiveDeliveryState =
  "queued" | "delivering" | "delivered" | "dead-letter";
export type ArchiveDeliveryDurability = "postgres" | "process-local";

export interface ArchiveDeliveryEntry {
  deliveryId: string;
  gameId: string;
  kind: ArchiveDeliveryKind;
  certificateId: string | null;
  payload: string;
  state: ArchiveDeliveryState;
  attempts: number;
  nextAttemptAt: number;
  leaseUntil: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface ArchiveDeliveryReceipt {
  deliveryId: string;
  gameId: string;
  kind: ArchiveDeliveryKind;
  certificateId: string | null;
  state: "delivered" | "queued" | "dead-letter" | "rejected";
  durability: ArchiveDeliveryDurability;
  attempts: number;
  lastError: string | null;
}

export interface ArchiveDeliverySnapshot {
  durability: ArchiveDeliveryDurability;
  accepted: number;
  delivered: number;
  queued: number;
  deadLettered: number;
  retries: number;
  rejected: number;
  lastDeliveryAt: string | null;
  lastFailureAt: string | null;
}

interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface ArchiveDeliveryDatabase {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface ArchiveDeliveryOutbox {
  durability(): ArchiveDeliveryDurability;
  enqueue(entry: ArchiveDeliveryEntry): Promise<ArchiveDeliveryEntry>;
  get(deliveryId: string): Promise<ArchiveDeliveryEntry | null>;
  claim(
    deliveryId: string,
    leaseMs: number,
  ): Promise<ArchiveDeliveryEntry | null>;
  claimDue(limit: number, leaseMs: number): Promise<ArchiveDeliveryEntry[]>;
  markDelivered(deliveryId: string): Promise<void>;
  markRetry(
    deliveryId: string,
    nextAttemptAt: number,
    error: string,
  ): Promise<void>;
  markDeadLetter(deliveryId: string, error: string): Promise<void>;
}

function cloneEntry(entry: ArchiveDeliveryEntry): ArchiveDeliveryEntry {
  return { ...entry };
}

export class MemoryArchiveDeliveryOutbox implements ArchiveDeliveryOutbox {
  private readonly entries = new Map<string, ArchiveDeliveryEntry>();

  public constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 512,
  ) {}

  public durability(): ArchiveDeliveryDurability {
    return "process-local";
  }

  public async enqueue(
    entry: ArchiveDeliveryEntry,
  ): Promise<ArchiveDeliveryEntry> {
    const existing = this.entries.get(entry.deliveryId);
    if (existing) return cloneEntry(existing);
    if (this.entries.size >= this.maxEntries) {
      const disposable = [...this.entries.values()]
        .filter((candidate) => candidate.state === "delivered")
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      if (!disposable) throw new Error("archive-outbox-capacity-exhausted");
      this.entries.delete(disposable.deliveryId);
    }
    this.entries.set(entry.deliveryId, cloneEntry(entry));
    return cloneEntry(entry);
  }

  public async get(deliveryId: string): Promise<ArchiveDeliveryEntry | null> {
    const entry = this.entries.get(deliveryId);
    return entry ? cloneEntry(entry) : null;
  }

  public async claim(
    deliveryId: string,
    leaseMs: number,
  ): Promise<ArchiveDeliveryEntry | null> {
    const entry = this.entries.get(deliveryId);
    if (!entry || entry.state === "delivered" || entry.state === "dead-letter")
      return null;
    const now = this.now();
    if (entry.nextAttemptAt > now) return null;
    if (
      entry.state === "delivering" &&
      entry.leaseUntil !== null &&
      entry.leaseUntil > now
    )
      return null;
    entry.state = "delivering";
    entry.attempts += 1;
    entry.leaseUntil = now + leaseMs;
    return cloneEntry(entry);
  }

  public async claimDue(
    limit: number,
    leaseMs: number,
  ): Promise<ArchiveDeliveryEntry[]> {
    const due = [...this.entries.values()]
      .filter((entry) => entry.nextAttemptAt <= this.now())
      .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt)
      .slice(0, limit);
    const claimed = await Promise.all(
      due.map((entry) => this.claim(entry.deliveryId, leaseMs)),
    );
    return claimed.filter(
      (entry): entry is ArchiveDeliveryEntry => entry !== null,
    );
  }

  public async markDelivered(deliveryId: string): Promise<void> {
    const entry = this.entries.get(deliveryId);
    if (!entry) return;
    entry.state = "delivered";
    entry.leaseUntil = null;
    entry.lastError = null;
  }

  public async markRetry(
    deliveryId: string,
    nextAttemptAt: number,
    error: string,
  ): Promise<void> {
    const entry = this.entries.get(deliveryId);
    if (!entry) return;
    entry.state = "queued";
    entry.nextAttemptAt = nextAttemptAt;
    entry.leaseUntil = null;
    entry.lastError = error;
  }

  public async markDeadLetter(
    deliveryId: string,
    error: string,
  ): Promise<void> {
    const entry = this.entries.get(deliveryId);
    if (!entry) return;
    entry.state = "dead-letter";
    entry.leaseUntil = null;
    entry.lastError = error;
  }
}

interface ArchiveDeliveryRow {
  delivery_id: string;
  game_id: string;
  delivery_kind: ArchiveDeliveryKind;
  certificate_id: string | null;
  payload: GameRecord | string;
  state: ArchiveDeliveryState;
  attempts: number;
  next_attempt_at: Date | string;
  lease_until: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
}

function rowToEntry(row: ArchiveDeliveryRow): ArchiveDeliveryEntry {
  return {
    deliveryId: row.delivery_id,
    gameId: row.game_id,
    kind: row.delivery_kind,
    certificateId: row.certificate_id,
    payload:
      typeof row.payload === "string"
        ? row.payload
        : JSON.stringify(row.payload),
    state: row.state,
    attempts: row.attempts,
    nextAttemptAt: new Date(row.next_attempt_at).getTime(),
    leaseUntil:
      row.lease_until === null ? null : new Date(row.lease_until).getTime(),
    lastError: row.last_error,
    createdAt: new Date(row.created_at).getTime(),
  };
}

const RETURNING_COLUMNS = `delivery_id, game_id, delivery_kind, certificate_id,
  payload, state, attempts, next_attempt_at, lease_until, last_error, created_at`;
const QUALIFIED_RETURNING_COLUMNS = `outbox.delivery_id, outbox.game_id,
  outbox.delivery_kind, outbox.certificate_id, outbox.payload, outbox.state,
  outbox.attempts, outbox.next_attempt_at, outbox.lease_until,
  outbox.last_error, outbox.created_at`;

export class PostgresArchiveDeliveryOutbox implements ArchiveDeliveryOutbox {
  public constructor(
    private readonly database: () => ArchiveDeliveryDatabase | null = () =>
      pool as ArchiveDeliveryDatabase | null,
  ) {}

  public durability(): ArchiveDeliveryDurability {
    return "postgres";
  }

  private requireDatabase(): ArchiveDeliveryDatabase {
    const database = this.database();
    if (!database) throw new Error("archive-outbox-database-unavailable");
    return database;
  }

  public async enqueue(
    entry: ArchiveDeliveryEntry,
  ): Promise<ArchiveDeliveryEntry> {
    const result = await this.requireDatabase().query<ArchiveDeliveryRow>(
      `INSERT INTO game_archive_outbox
        (delivery_id, game_id, delivery_kind, certificate_id, payload, state,
         attempts, next_attempt_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', 0, $6, $7, $7)
       ON CONFLICT (delivery_id) DO UPDATE SET
         payload = CASE
           WHEN game_archive_outbox.state = 'delivered' THEN game_archive_outbox.payload
           ELSE EXCLUDED.payload
         END,
         updated_at = EXCLUDED.updated_at
       RETURNING ${RETURNING_COLUMNS}`,
      [
        entry.deliveryId,
        entry.gameId,
        entry.kind,
        entry.certificateId,
        entry.payload,
        new Date(entry.nextAttemptAt).toISOString(),
        new Date(entry.createdAt).toISOString(),
      ],
    );
    return rowToEntry(result.rows[0]);
  }

  public async get(deliveryId: string): Promise<ArchiveDeliveryEntry | null> {
    const result = await this.requireDatabase().query<ArchiveDeliveryRow>(
      `SELECT ${RETURNING_COLUMNS} FROM game_archive_outbox WHERE delivery_id = $1`,
      [deliveryId],
    );
    return result.rows[0] ? rowToEntry(result.rows[0]) : null;
  }

  public async claim(
    deliveryId: string,
    leaseMs: number,
  ): Promise<ArchiveDeliveryEntry | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const result = await this.requireDatabase().query<ArchiveDeliveryRow>(
      `UPDATE game_archive_outbox
       SET state = 'delivering', attempts = attempts + 1,
           lease_until = $2, updated_at = $1
       WHERE delivery_id = $3
         AND state NOT IN ('delivered', 'dead-letter')
         AND next_attempt_at <= $1
         AND (state <> 'delivering' OR lease_until IS NULL OR lease_until <= $1)
       RETURNING ${RETURNING_COLUMNS}`,
      [now.toISOString(), leaseUntil.toISOString(), deliveryId],
    );
    return result.rows[0] ? rowToEntry(result.rows[0]) : null;
  }

  public async claimDue(
    limit: number,
    leaseMs: number,
  ): Promise<ArchiveDeliveryEntry[]> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const result = await this.requireDatabase().query<ArchiveDeliveryRow>(
      `WITH due AS (
         SELECT delivery_id FROM game_archive_outbox
         WHERE state NOT IN ('delivered', 'dead-letter')
           AND next_attempt_at <= $1
           AND (state <> 'delivering' OR lease_until IS NULL OR lease_until <= $1)
         ORDER BY next_attempt_at, created_at
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       UPDATE game_archive_outbox AS outbox
       SET state = 'delivering', attempts = outbox.attempts + 1,
           lease_until = $2, updated_at = $1
       FROM due WHERE outbox.delivery_id = due.delivery_id
       RETURNING ${QUALIFIED_RETURNING_COLUMNS}`,
      [now.toISOString(), leaseUntil.toISOString(), limit],
    );
    return result.rows.map(rowToEntry);
  }

  public async markDelivered(deliveryId: string): Promise<void> {
    await this.requireDatabase().query(
      `UPDATE game_archive_outbox SET state = 'delivered', lease_until = NULL,
         last_error = NULL, delivered_at = NOW(), updated_at = NOW()
       WHERE delivery_id = $1`,
      [deliveryId],
    );
  }

  public async markRetry(
    deliveryId: string,
    nextAttemptAt: number,
    error: string,
  ): Promise<void> {
    await this.requireDatabase().query(
      `UPDATE game_archive_outbox SET state = 'queued', lease_until = NULL,
         next_attempt_at = $2, last_error = $3, updated_at = NOW()
       WHERE delivery_id = $1`,
      [deliveryId, new Date(nextAttemptAt).toISOString(), error],
    );
  }

  public async markDeadLetter(
    deliveryId: string,
    error: string,
  ): Promise<void> {
    await this.requireDatabase().query(
      `UPDATE game_archive_outbox SET state = 'dead-letter', lease_until = NULL,
         last_error = $2, updated_at = NOW()
       WHERE delivery_id = $1`,
      [deliveryId, error],
    );
  }
}

/**
 * Selects the durable backend at operation time. Database bootstrap is async,
 * so choosing once in a module constructor would incorrectly pin a healthy
 * release worker to process memory before `databaseReady` resolves.
 */
export class HybridArchiveDeliveryOutbox implements ArchiveDeliveryOutbox {
  private readonly memory: MemoryArchiveDeliveryOutbox;
  private readonly postgres: PostgresArchiveDeliveryOutbox;

  public constructor(
    private readonly database: () => ArchiveDeliveryDatabase | null = () =>
      pool as ArchiveDeliveryDatabase | null,
    now: () => number = Date.now,
    private readonly databaseConfigured: () => boolean = () =>
      Boolean(process.env.DATABASE_URL),
  ) {
    this.memory = new MemoryArchiveDeliveryOutbox(now);
    this.postgres = new PostgresArchiveDeliveryOutbox(database);
  }

  private backend(): ArchiveDeliveryOutbox {
    // A configured release database must fail closed while connecting/failed;
    // silently accepting a process-local archive would fabricate durability.
    return this.database() || this.databaseConfigured()
      ? this.postgres
      : this.memory;
  }

  public durability(): ArchiveDeliveryDurability {
    return this.backend().durability();
  }

  public enqueue(entry: ArchiveDeliveryEntry): Promise<ArchiveDeliveryEntry> {
    return this.backend().enqueue(entry);
  }

  public get(deliveryId: string): Promise<ArchiveDeliveryEntry | null> {
    return this.backend().get(deliveryId);
  }

  public claim(
    deliveryId: string,
    leaseMs: number,
  ): Promise<ArchiveDeliveryEntry | null> {
    return this.backend().claim(deliveryId, leaseMs);
  }

  public claimDue(
    limit: number,
    leaseMs: number,
  ): Promise<ArchiveDeliveryEntry[]> {
    return this.backend().claimDue(limit, leaseMs);
  }

  public markDelivered(deliveryId: string): Promise<void> {
    return this.backend().markDelivered(deliveryId);
  }

  public markRetry(
    deliveryId: string,
    nextAttemptAt: number,
    error: string,
  ): Promise<void> {
    return this.backend().markRetry(deliveryId, nextAttemptAt, error);
  }

  public markDeadLetter(deliveryId: string, error: string): Promise<void> {
    return this.backend().markDeadLetter(deliveryId, error);
  }
}

export interface ArchiveDeliveryManagerOptions {
  outbox?: ArchiveDeliveryOutbox;
  fetchImpl?: typeof fetch;
  endpointForGame: (gameId: string) => string;
  apiKey: () => string;
  timeoutMs?: number;
  maxAttempts?: number;
  immediateAttempts?: number;
  baseRetryMs?: number;
  pumpIntervalMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
}

export class ArchiveDeliveryManager {
  private readonly outbox: ArchiveDeliveryOutbox;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly immediateAttempts: number;
  private readonly baseRetryMs: number;
  private readonly pumpIntervalMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly now: () => number;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private pumpInFlight: Promise<void> | null = null;
  private counters = {
    accepted: 0,
    delivered: 0,
    queued: 0,
    deadLettered: 0,
    retries: 0,
    rejected: 0,
    lastDeliveryAt: null as string | null,
    lastFailureAt: null as string | null,
  };

  public constructor(private readonly options: ArchiveDeliveryManagerOptions) {
    this.outbox = options.outbox ?? new HybridArchiveDeliveryOutbox();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.immediateAttempts = options.immediateAttempts ?? 3;
    this.baseRetryMs = options.baseRetryMs ?? 250;
    this.pumpIntervalMs = options.pumpIntervalMs ?? 10_000;
    this.sleep =
      options.sleep ??
      ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.now = options.now ?? Date.now;
    // Every process participates in restart recovery. PostgreSQL leases plus
    // SKIP LOCKED keep this safe when several release workers start together.
    this.ensurePump();
  }

  public snapshot(): ArchiveDeliverySnapshot {
    return { durability: this.outbox.durability(), ...this.counters };
  }

  public async deliver(
    record: GameRecord,
    kind: ArchiveDeliveryKind,
  ): Promise<ArchiveDeliveryReceipt> {
    const certificateId =
      record.telemetry?.resultCertificate?.certificateId ?? null;
    if (kind === "certified" && certificateId === null) {
      this.counters.rejected += 1;
      return this.rejectedReceipt(
        record.info.gameID,
        kind,
        certificateId,
        "certified-archive-requires-certificate",
      );
    }
    if (kind === "incomplete" && certificateId !== null) {
      this.counters.rejected += 1;
      return this.rejectedReceipt(
        record.info.gameID,
        kind,
        certificateId,
        "incomplete-archive-cannot-carry-certificate",
      );
    }

    const deliveryId =
      kind === "certified"
        ? `certified:${record.info.gameID}:${certificateId}`
        : `incomplete:${record.info.gameID}`;
    const now = this.now();
    const entry: ArchiveDeliveryEntry = {
      deliveryId,
      gameId: record.info.gameID,
      kind,
      certificateId,
      payload: JSON.stringify(record, replacer),
      state: "queued",
      attempts: 0,
      nextAttemptAt: now,
      leaseUntil: null,
      lastError: null,
      createdAt: now,
    };

    let stored: ArchiveDeliveryEntry;
    try {
      stored = await this.outbox.enqueue(entry);
    } catch (error) {
      this.counters.rejected += 1;
      return this.rejectedReceipt(
        entry.gameId,
        kind,
        certificateId,
        this.errorCode(error),
        deliveryId,
      );
    }
    this.counters.accepted += 1;
    try {
      if (stored.state === "delivered") return this.receipt(stored);
      if (stored.state === "dead-letter") return this.receipt(stored);

      for (let attempt = 0; attempt < this.immediateAttempts; attempt += 1) {
        const claimed = await this.outbox.claim(
          deliveryId,
          this.timeoutMs + 1_000,
        );
        if (!claimed) {
          const current = await this.outbox.get(deliveryId);
          this.ensurePump();
          return current ? this.receipt(current) : this.receipt(stored);
        }
        const outcome = await this.attempt(claimed);
        if (outcome.state === "delivered" || outcome.state === "dead-letter")
          return outcome;
        if (attempt + 1 < this.immediateAttempts) {
          await this.sleep(Math.max(0, outcome.nextAttemptAt - this.now()));
        }
      }
      const current = (await this.outbox.get(deliveryId)) ?? stored;
      this.ensurePump();
      return this.receipt(current);
    } catch (error) {
      const errorCode = this.errorCode(error);
      this.counters.lastFailureAt = new Date(this.now()).toISOString();
      this.counters.queued += 1;
      this.ensurePump();
      return this.receipt({
        ...stored,
        state: "queued",
        lastError: errorCode,
      });
    }
  }

  public async flushDue(limit = 8): Promise<void> {
    if (this.pumpInFlight) return this.pumpInFlight;
    this.pumpInFlight = (async () => {
      const due = await this.outbox.claimDue(limit, this.timeoutMs + 1_000);
      await Promise.all(due.map((entry) => this.attempt(entry)));
    })().finally(() => {
      this.pumpInFlight = null;
    });
    return this.pumpInFlight;
  }

  public stop(): void {
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
  }

  private async attempt(
    entry: ArchiveDeliveryEntry,
  ): Promise<ArchiveDeliveryReceipt & { nextAttemptAt: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort("archive-delivery-timeout"),
      this.timeoutMs,
    );
    try {
      const response = await this.fetchImpl(
        this.options.endpointForGame(entry.gameId),
        {
          method: "POST",
          body: entry.payload,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.options.apiKey(),
            "Idempotency-Key": entry.deliveryId,
            "x-vaultfront-archive-kind": entry.kind,
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`archive-http-${response.status}`);
      await this.outbox.markDelivered(entry.deliveryId);
      this.counters.delivered += 1;
      this.counters.lastDeliveryAt = new Date(this.now()).toISOString();
      return {
        ...this.receipt({ ...entry, state: "delivered", lastError: null }),
        nextAttemptAt: entry.nextAttemptAt,
      };
    } catch (error) {
      const errorCode = controller.signal.aborted
        ? "archive-delivery-timeout"
        : this.errorCode(error);
      this.counters.lastFailureAt = new Date(this.now()).toISOString();
      if (entry.attempts >= this.maxAttempts) {
        await this.outbox.markDeadLetter(entry.deliveryId, errorCode);
        this.counters.deadLettered += 1;
        return {
          ...this.receipt({
            ...entry,
            state: "dead-letter",
            lastError: errorCode,
          }),
          nextAttemptAt: entry.nextAttemptAt,
        };
      }
      const nextAttemptAt =
        this.now() + this.baseRetryMs * 2 ** Math.max(0, entry.attempts - 1);
      await this.outbox.markRetry(entry.deliveryId, nextAttemptAt, errorCode);
      this.counters.retries += 1;
      this.counters.queued += 1;
      this.ensurePump();
      return {
        ...this.receipt({
          ...entry,
          state: "queued",
          nextAttemptAt,
          lastError: errorCode,
        }),
        nextAttemptAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private ensurePump(): void {
    if (this.pumpTimer) return;
    this.pumpTimer = setInterval(() => {
      void this.flushDue().catch(() => {
        this.counters.lastFailureAt = new Date(this.now()).toISOString();
      });
    }, this.pumpIntervalMs);
    this.pumpTimer.unref?.();
  }

  private receipt(entry: ArchiveDeliveryEntry): ArchiveDeliveryReceipt {
    return {
      deliveryId: entry.deliveryId,
      gameId: entry.gameId,
      kind: entry.kind,
      certificateId: entry.certificateId,
      state:
        entry.state === "delivering" || entry.state === "queued"
          ? "queued"
          : entry.state,
      durability: this.outbox.durability(),
      attempts: entry.attempts,
      lastError: entry.lastError,
    };
  }

  private rejectedReceipt(
    gameId: string,
    kind: ArchiveDeliveryKind,
    certificateId: string | null,
    error: string,
    deliveryId = `rejected:${kind}:${gameId}`,
  ): ArchiveDeliveryReceipt {
    return {
      deliveryId,
      gameId,
      kind,
      certificateId,
      state: "rejected",
      durability: this.outbox.durability(),
      attempts: 0,
      lastError: error,
    };
  }

  private errorCode(error: unknown): string {
    if (error instanceof Error && error.message.trim())
      return error.message.slice(0, 160);
    return "archive-delivery-failed";
  }
}
