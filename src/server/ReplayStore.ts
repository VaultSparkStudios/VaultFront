/**
 * ReplayStore — records per-game input logs for replay playback.
 *
 * Architecture:
 * - The deterministic core re-runs from a seed + ordered input list.
 * - Each game records: initial seed, map, config, and every player intent in
 *   turn order.
 * - On playback the client receives the input log and drives the simulation
 *   forward at configurable speed.
 * - Manifests are HMAC-signed on finalization; verify before consuming for
 *   achievement/Elo purposes to prevent tampered replay submissions.
 *
 * Storage: in-memory for development; swap `save`/`load` for S3 or Postgres
 * by implementing the ReplayBackend interface.
 *
 * Status: SCAFFOLDED — wire ReplayStore.record() into GameServer turn loop,
 * then expose /api/replay/:id on Worker.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { Pool } from "pg";
import {
  vaultFrontBalanceIdentity,
  type VaultFrontBalanceIdentity,
} from "./VaultFrontBalanceIdentity";

export interface ReplayIntent {
  /** Serialized player intent (matches existing transport format) */
  serialized: Uint8Array;
  /** Turn number the intent was applied */
  turn: number;
  /** Small player ID */
  playerSmallID: number;
}

/** Lightweight record of a single game turn — same shape as ServerTurnMessage.turn */
export interface ReplayTurn {
  turnNumber: number;
  /** Intents are stored as plain objects for replay */
  intents: unknown[];
}

export interface ReplayManifest {
  gameId: string;
  mapName: string;
  seed: number;
  configSnapshot: Record<string, unknown>;
  startedAt: number;
  endedAt?: number;
  durationTurns: number;
  intents: ReplayIntent[];
  /** Full turn log — preferred over intents[] for playback when present */
  turns?: ReplayTurn[];
  /** HMAC-SHA256 over canonical fields — set by finishRecording(), verified by verifySignature() */
  signature?: string;
}

export interface ReplayBalanceCompatibility {
  compatible: boolean;
  status: "compatible" | "legacy" | "incompatible";
  recorded: VaultFrontBalanceIdentity | null;
  expected: VaultFrontBalanceIdentity;
}

export function verifyReplayBalanceCompatibility(
  manifest: ReplayManifest,
  expected: VaultFrontBalanceIdentity = vaultFrontBalanceIdentity,
): ReplayBalanceCompatibility {
  const candidate = manifest.configSnapshot.vaultFrontBalanceIdentity;
  const recorded =
    typeof candidate === "object" &&
    candidate !== null &&
    "authority" in candidate &&
    typeof candidate.authority === "string" &&
    "authorityFingerprint" in candidate &&
    typeof candidate.authorityFingerprint === "string"
      ? (candidate as VaultFrontBalanceIdentity)
      : null;
  if (!recorded) {
    return { compatible: false, status: "legacy", recorded: null, expected };
  }
  const compatible =
    recorded.authority === expected.authority &&
    recorded.authorityFingerprint === expected.authorityFingerprint;
  return {
    compatible,
    status: compatible ? "compatible" : "incompatible",
    recorded,
    expected,
  };
}

// ---------------------------------------------------------------------------
// HMAC helpers — prevent tampered replays from faking achievements in tournaments
// ---------------------------------------------------------------------------

function developmentReplayKey(): string {
  // Deterministic local-only HMAC material. This is deliberately derived,
  // non-secret, and never accepted as release evidence.
  return createHash("sha256")
    .update(["vaultfront", "development", "replay", "v1"].join(":"))
    .digest("hex");
}

export interface ReplayIntegrityPosture {
  status: "configured" | "development-only" | "missing";
  canSignAndVerify: boolean;
  evidence: string;
}

function isDevelopmentRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.GAME_ENV?.toLowerCase() === "dev"
  );
}

function replaySecret(): string | null {
  const configured = process.env.REPLAY_SECRET?.trim();
  if (configured) return configured;
  return isDevelopmentRuntime() ? developmentReplayKey() : null;
}

export function getReplayIntegrityPosture(): ReplayIntegrityPosture {
  if (process.env.REPLAY_SECRET?.trim()) {
    return {
      status: "configured",
      canSignAndVerify: true,
      evidence: "Replay HMAC key is configured for this process.",
    };
  }
  if (isDevelopmentRuntime()) {
    return {
      status: "development-only",
      canSignAndVerify: true,
      evidence:
        "Replay HMAC uses a development-only key; this posture is not release evidence.",
    };
  }
  return {
    status: "missing",
    canSignAndVerify: false,
    evidence:
      "Replay HMAC key is missing; replay recording and consumption fail closed.",
  };
}

function computeSignature(manifest: ReplayManifest): string {
  const secret = replaySecret();
  if (!secret) {
    throw new Error("REPLAY_SECRET is required outside development and tests");
  }
  const canonical = JSON.stringify({
    gameId: manifest.gameId,
    mapName: manifest.mapName,
    seed: manifest.seed,
    configSnapshot: manifest.configSnapshot,
    startedAt: manifest.startedAt,
    endedAt: manifest.endedAt ?? null,
    durationTurns: manifest.durationTurns,
    intents: manifest.intents.map((intent) => ({
      serialized: Array.from(intent.serialized),
      turn: intent.turn,
      playerSmallID: intent.playerSmallID,
    })),
    turns: manifest.turns ?? [],
  });
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

/** Returns true when the manifest's signature matches the computed HMAC. */
export function verifyReplaySignature(manifest: ReplayManifest): boolean {
  if (!manifest.signature) return false;
  try {
    const expected = computeSignature(manifest);
    return timingSafeEqual(
      Buffer.from(manifest.signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

export interface ReplayBackend {
  save(gameId: string, manifest: ReplayManifest): Promise<void>;
  load(gameId: string): Promise<ReplayManifest | null>;
  list(limit?: number): Promise<{ gameId: string; startedAt: number }[]>;
}

/** In-memory backend — suitable for development and single-instance staging */
export class InMemoryReplayBackend implements ReplayBackend {
  private store = new Map<string, ReplayManifest>();

  async save(gameId: string, manifest: ReplayManifest): Promise<void> {
    this.store.set(gameId, manifest);
    // Evict oldest entries if over limit (keep newest 500)
    if (this.store.size > 500) {
      const oldest = [...this.store.entries()].sort(
        ([, a], [, b]) => a.startedAt - b.startedAt,
      )[0];
      this.store.delete(oldest[0]);
    }
  }

  async load(gameId: string): Promise<ReplayManifest | null> {
    return this.store.get(gameId) ?? null;
  }

  async list(limit = 20): Promise<{ gameId: string; startedAt: number }[]> {
    return [...this.store.entries()]
      .map(([gameId, m]) => ({ gameId, startedAt: m.startedAt }))
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }
}

interface PersistedReplayManifest extends Omit<ReplayManifest, "intents"> {
  intents: Array<Omit<ReplayIntent, "serialized"> & { serialized: number[] }>;
}

function persistableManifest(
  manifest: ReplayManifest,
): PersistedReplayManifest {
  return {
    ...manifest,
    intents: manifest.intents.map((intent) => ({
      ...intent,
      serialized: Array.from(intent.serialized),
    })),
  };
}

function hydrateManifest(manifest: PersistedReplayManifest): ReplayManifest {
  return {
    ...manifest,
    intents: manifest.intents.map((intent) => ({
      ...intent,
      serialized: Uint8Array.from(intent.serialized),
    })),
  };
}

/** PostgreSQL backend shared by every worker and restart. */
export class PostgresReplayBackend implements ReplayBackend {
  constructor(private readonly database: Pick<Pool, "query">) {}

  async save(gameId: string, manifest: ReplayManifest): Promise<void> {
    await this.database.query(
      `INSERT INTO replay_manifests (game_id, started_at, manifest)
       VALUES ($1, to_timestamp($2 / 1000.0), $3::jsonb)
       ON CONFLICT (game_id) DO UPDATE SET
         started_at = EXCLUDED.started_at,
         manifest = EXCLUDED.manifest`,
      [
        gameId,
        manifest.startedAt,
        JSON.stringify(persistableManifest(manifest)),
      ],
    );
    await this.database.query(
      "DELETE FROM replay_manifests WHERE started_at < NOW() - INTERVAL '30 days'",
    );
  }

  async load(gameId: string): Promise<ReplayManifest | null> {
    const result = await this.database.query<{
      manifest: PersistedReplayManifest;
    }>("SELECT manifest FROM replay_manifests WHERE game_id = $1", [gameId]);
    const manifest = result.rows[0]?.manifest;
    return manifest ? hydrateManifest(manifest) : null;
  }

  async list(limit = 20): Promise<{ gameId: string; startedAt: number }[]> {
    const result = await this.database.query<{
      game_id: string;
      started_at_ms: string;
    }>(
      `SELECT game_id, (extract(epoch FROM started_at) * 1000)::bigint AS started_at_ms
       FROM replay_manifests
       ORDER BY started_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    );
    return result.rows.map((row) => ({
      gameId: row.game_id,
      startedAt: Number(row.started_at_ms),
    }));
  }
}

let replayDatabase: Pick<Pool, "query"> | null = null;

export function configureReplayDatabase(
  database: Pick<Pool, "query"> | null,
): void {
  replayDatabase = database;
}

/** Resolve storage after the shared pool finishes asynchronous bootstrap. */
export class RuntimeReplayBackend implements ReplayBackend {
  constructor(private readonly local = new InMemoryReplayBackend()) {}

  private current(): ReplayBackend {
    if (replayDatabase) return new PostgresReplayBackend(replayDatabase);
    if (process.env.DATABASE_URL) {
      throw new Error(
        "Replay persistence unavailable while DATABASE_URL is configured",
      );
    }
    return this.local;
  }

  save(gameId: string, manifest: ReplayManifest): Promise<void> {
    return this.current().save(gameId, manifest);
  }

  load(gameId: string): Promise<ReplayManifest | null> {
    return this.current().load(gameId);
  }

  list(limit?: number): Promise<{ gameId: string; startedAt: number }[]> {
    return this.current().list(limit);
  }
}

export class ReplayStore {
  private backend: ReplayBackend;
  private activeRecordings = new Map<string, ReplayManifest>();

  constructor(
    backend: ReplayBackend = new InMemoryReplayBackend(),
    private readonly balanceIdentity = vaultFrontBalanceIdentity,
  ) {
    this.backend = backend;
  }

  /**
   * Begin recording a new game.
   * Call once after the game is created and the seed is known.
   */
  startRecording(
    gameId: string,
    mapName: string,
    seed: number,
    configSnapshot: Record<string, unknown>,
  ): void {
    this.activeRecordings.set(gameId, {
      gameId,
      mapName,
      seed,
      configSnapshot: {
        ...configSnapshot,
        vaultFrontBalanceIdentity: this.balanceIdentity,
      },
      startedAt: Date.now(),
      durationTurns: 0,
      intents: [],
      turns: [],
    });
  }

  /**
   * Record a completed turn (preferred over recordIntent — stores the full turn object).
   * Call once per turn after the game loop finalises it.
   */
  recordTurn(gameId: string, turn: ReplayTurn): void {
    const recording = this.activeRecordings.get(gameId);
    if (!recording) return;
    recording.turns ??= [];
    recording.turns.push(turn);
    recording.durationTurns = Math.max(
      recording.durationTurns,
      turn.turnNumber,
    );
  }

  /**
   * Record a player intent for the current turn.
   * Call once per intent as they are processed by the game loop.
   */
  recordIntent(
    gameId: string,
    turn: number,
    playerSmallID: number,
    serialized: Uint8Array,
  ): void {
    const recording = this.activeRecordings.get(gameId);
    if (!recording) return;
    recording.intents.push({ serialized, turn, playerSmallID });
    recording.durationTurns = Math.max(recording.durationTurns, turn);
  }

  /**
   * Finalize and persist a game recording.
   * Call when the game ends.
   */
  async finishRecording(gameId: string): Promise<void> {
    const recording = this.activeRecordings.get(gameId);
    if (!recording) return;
    recording.endedAt = Date.now();
    recording.signature = computeSignature(recording);
    this.activeRecordings.delete(gameId);
    await this.backend.save(gameId, recording);
  }

  /** Load only manifests that pass complete HMAC verification. */
  async getReplay(gameId: string): Promise<ReplayManifest | null> {
    const manifest = await this.backend.load(gameId);
    if (
      !manifest ||
      !verifyReplaySignature(manifest) ||
      !verifyReplayBalanceCompatibility(manifest, this.balanceIdentity)
        .compatible
    ) {
      return null;
    }
    return manifest;
  }

  async listReplays(
    limit = 20,
  ): Promise<{ gameId: string; startedAt: number }[]> {
    const candidates = await this.backend.list(Math.max(limit, 1) * 2);
    const verified = await Promise.all(
      candidates.map(async (candidate) =>
        (await this.getReplay(candidate.gameId)) ? candidate : null,
      ),
    );
    return verified
      .filter(
        (candidate): candidate is { gameId: string; startedAt: number } =>
          candidate !== null,
      )
      .slice(0, limit);
  }
}

/** Singleton — import and use in Worker.ts */
export const replayStore = new ReplayStore(new RuntimeReplayBackend());
