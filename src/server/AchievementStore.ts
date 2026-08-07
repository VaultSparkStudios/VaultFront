/**
 * AchievementStore — server-side achievement definitions, progress tracking,
 * and unlock detection for VaultFront.
 *
 * Architecture:
 * - PostgreSQL is authoritative when configured; development uses an explicitly
 *   reported process-local fallback.
 * - Authenticated reads and progression singleflight through ensureHydrated().
 * - checkAndUnlock() is the single entry point for event-driven unlock detection
 *   and persists base and meta-chain unlocks through the same bounded queue.
 * - reset() is provided for test isolation only.
 */

import { getDatabasePosture, pool } from "./db/pool";
import { logger } from "./Logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
}

export interface AchievementProgress {
  id: string;
  unlockedAt: number | null;
  /** 0–100 percent toward unlock */
  progress: number;
  /** Human-readable label, e.g. "7 / 10 convoys" */
  progressLabel: string;
}

export type AchievementEvent =
  | { type: "vault_captured"; count: number }
  | { type: "convoy_delivered"; totalCount: number }
  | { type: "execution_chain"; matchCount: number }
  | { type: "surge_activated" }
  | {
      type: "match_ended";
      won: boolean;
      durationSeconds: number;
      onMutator: boolean;
      eloRating: number;
    }
  | { type: "squad_objective_completed" }
  | { type: "jam_broken" }
  | { type: "vault_count"; simultaneous: number }
  | { type: "escort_streak"; consecutive: number }
  | { type: "match_played"; totalMatches: number };

export type AchievementHydrationStatus =
  "unhydrated" | "process-local" | "ready" | "degraded";

export interface AchievementHydrationState {
  status: AchievementHydrationStatus;
  source: "postgres" | "process-local";
  hydratedAt: string | null;
  expiresAt: string | null;
  pendingWrites: boolean;
  errorCode: "database-unavailable" | "query-failed" | "query-timeout" | null;
}

interface AchievementDatabase {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface AchievementStoreOptions {
  database?: () => AchievementDatabase | null;
  databasePosture?: () => { configured: boolean; state: string };
  now?: () => number;
  hydrationTtlMs?: number;
  queryTimeoutMs?: number;
  maxCachedActors?: number;
}

// ---------------------------------------------------------------------------
// Meta-chain definitions — prestige achievements composed of multiple base achievements
// ---------------------------------------------------------------------------

export interface MetaChainDefinition {
  id: string;
  name: string;
  description: string;
  requires: string[]; // base achievement IDs
  reward: { badge: string; title: string };
}

const META_CHAINS: MetaChainDefinition[] = [
  {
    id: "vault_sovereign",
    name: "Vault Sovereign",
    description:
      "Capture your first vault, control five simultaneously, and reach Grandmaster",
    requires: ["first_vault", "five_vaults", "grandmaster"],
    reward: { badge: "crown", title: "Vault Sovereign" },
  },
  {
    id: "convoy_legend",
    name: "Convoy Legend",
    description:
      "Deliver 10 convoys, escort 5 in a row, then deliver 100 total",
    requires: ["ten_convoys", "escort_streak", "hundred_convoys"],
    reward: { badge: "truck_gold", title: "Convoy Legend" },
  },
  {
    id: "surge_master",
    name: "Surge Master",
    description: "Activate surge, then win after surge in a comeback victory",
    requires: ["first_surge", "surge_win"],
    reward: { badge: "lightning_prestige", title: "Surge Master" },
  },
  {
    id: "speed_demon",
    name: "Speed Demon",
    description: "Win in under 10 minutes on any weekly mutator",
    requires: ["speed_run", "mutator_win"],
    reward: { badge: "flame_gold", title: "Speed Demon" },
  },
  {
    id: "grand_architect",
    name: "Grand Architect",
    description: "Complete 50 matches, chain combos, and win a team objective",
    requires: ["veteran", "triple_chain", "squad_objective"],
    reward: { badge: "architect_crest", title: "Grand Architect" },
  },
];

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const DEFINITIONS: AchievementDefinition[] = [
  {
    id: "first_vault",
    name: "First Blood",
    description: "Capture your first vault site",
  },
  {
    id: "ten_convoys",
    name: "Supply Chain",
    description: "Deliver 10 convoys successfully",
  },
  {
    id: "first_chain",
    name: "Chain Reaction",
    description: "Complete your first execution chain combo",
  },
  {
    id: "triple_chain",
    name: "Chain Master",
    description: "Complete 3 execution chain combos in a single match",
  },
  {
    id: "first_surge",
    name: "Comeback Kid",
    description: "Activate your first surge",
  },
  {
    id: "surge_win",
    name: "From the Ashes",
    description: "Win a match after activating surge",
  },
  {
    id: "five_vaults",
    name: "Vault Hoarder",
    description: "Control 5 vault sites simultaneously",
  },
  {
    id: "hundred_convoys",
    name: "Freight Commander",
    description: "Deliver 100 convoys across all matches",
  },
  {
    id: "jam_broken",
    name: "Frequency Jammer",
    description: "Successfully break a jam_breaker interception",
  },
  {
    id: "escort_streak",
    name: "Ironclad Escort",
    description: "Escort 5 consecutive convoys without loss",
  },
  {
    id: "squad_objective",
    name: "Team Player",
    description: "Complete a squad objective window",
  },
  {
    id: "mutator_win",
    name: "Rule Bender",
    description: "Win a match on any weekly mutator",
  },
  {
    id: "speed_run",
    name: "Blitz",
    description: "Win a match in under 10 minutes",
  },
  {
    id: "veteran",
    name: "Seasoned Commander",
    description: "Play 50 matches",
  },
  {
    id: "grandmaster",
    name: "Grandmaster",
    description: "Reach Elo rating 1900",
  },
];

const DEFINITION_MAP = new Map<string, AchievementDefinition>(
  DEFINITIONS.map((d) => [d.id, d]),
);

// ---------------------------------------------------------------------------
// Per-player mutable state (in-memory only)
// ---------------------------------------------------------------------------

interface PlayerState {
  unlocked: Map<string, number>; // achievementId → timestamp (ms)
  // Counters that accumulate across events before an unlock threshold is hit
  convoyCount: number;
  matchCount: number;
  surgeActivatedThisSession: boolean;
}

function makePlayerState(): PlayerState {
  return {
    unlocked: new Map(),
    convoyCount: 0,
    matchCount: 0,
    surgeActivatedThisSession: false,
  };
}

// ---------------------------------------------------------------------------
// Progress calculation (pure, no side effects)
// ---------------------------------------------------------------------------

function calcProgress(
  persistentId: string,
  state: PlayerState,
): AchievementProgress[] {
  return DEFINITIONS.map((def) => {
    const unlockedAt = state.unlocked.get(def.id) ?? null;

    if (unlockedAt !== null) {
      return {
        id: def.id,
        unlockedAt,
        progress: 100,
        progressLabel: "Unlocked",
      };
    }

    // Compute partial progress for trackable achievements
    switch (def.id) {
      case "ten_convoys": {
        const pct = Math.min(100, Math.floor((state.convoyCount / 10) * 100));
        return {
          id: def.id,
          unlockedAt: null,
          progress: pct,
          progressLabel: `${state.convoyCount} / 10 convoys`,
        };
      }
      case "hundred_convoys": {
        const pct = Math.min(100, Math.floor((state.convoyCount / 100) * 100));
        return {
          id: def.id,
          unlockedAt: null,
          progress: pct,
          progressLabel: `${state.convoyCount} / 100 convoys`,
        };
      }
      case "veteran": {
        const pct = Math.min(100, Math.floor((state.matchCount / 50) * 100));
        return {
          id: def.id,
          unlockedAt: null,
          progress: pct,
          progressLabel: `${state.matchCount} / 50 matches`,
        };
      }
      default:
        return {
          id: def.id,
          unlockedAt: null,
          progress: 0,
          progressLabel: "Not yet unlocked",
        };
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface CachedHydration {
  state: AchievementHydrationState;
  expiresAtMs: number;
  lastAccessAtMs: number;
}

const DEFAULT_HYDRATION_TTL_MS = 5 * 60_000;
const DEFAULT_QUERY_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_CACHED_ACTORS = 1_000;

export class AchievementStore {
  private readonly playerStates = new Map<string, PlayerState>();
  private readonly hydration = new Map<string, CachedHydration>();
  private readonly hydrationFlights = new Map<
    string,
    Promise<AchievementHydrationState>
  >();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly database: () => AchievementDatabase | null;
  private readonly databasePosture: () => {
    configured: boolean;
    state: string;
  };
  private readonly now: () => number;
  private readonly hydrationTtlMs: number;
  private readonly queryTimeoutMs: number;
  private readonly maxCachedActors: number;

  constructor(options: AchievementStoreOptions = {}) {
    this.database =
      options.database ?? (() => pool as unknown as AchievementDatabase | null);
    this.databasePosture = options.databasePosture ?? getDatabasePosture;
    this.now = options.now ?? Date.now;
    this.hydrationTtlMs = Math.max(
      1,
      options.hydrationTtlMs ?? DEFAULT_HYDRATION_TTL_MS,
    );
    this.queryTimeoutMs = Math.max(
      1,
      options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    );
    this.maxCachedActors = Math.max(
      1,
      options.maxCachedActors ?? DEFAULT_MAX_CACHED_ACTORS,
    );
  }

  private getOrCreate(persistentId: string): PlayerState {
    let state = this.playerStates.get(persistentId);
    if (!state) {
      state = makePlayerState();
      this.playerStates.set(persistentId, state);
    }
    return state;
  }

  getHydrationState(persistentId: string): AchievementHydrationState {
    const cached = this.hydration.get(persistentId);
    if (cached) {
      cached.lastAccessAtMs = this.now();
      return {
        ...cached.state,
        pendingWrites: this.writeQueues.has(persistentId),
      };
    }
    return {
      status: "unhydrated",
      source: "process-local",
      hydratedAt: null,
      expiresAt: null,
      pendingWrites: this.writeQueues.has(persistentId),
      errorCode: null,
    };
  }

  private cacheHydration(
    persistentId: string,
    status: AchievementHydrationStatus,
    errorCode: AchievementHydrationState["errorCode"],
  ): AchievementHydrationState {
    const now = this.now();
    const expiresAtMs = now + this.hydrationTtlMs;
    const state: AchievementHydrationState = {
      status,
      source: status === "ready" ? "postgres" : "process-local",
      hydratedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      pendingWrites: this.writeQueues.has(persistentId),
      errorCode,
    };
    this.hydration.set(persistentId, {
      state,
      expiresAtMs,
      lastAccessAtMs: now,
    });
    this.evictExpiredOrOverflow(persistentId);
    return { ...state };
  }

  private evictExpiredOrOverflow(protectedActor: string): void {
    const now = this.now();
    for (const [actor, cached] of this.hydration) {
      if (
        actor !== protectedActor &&
        cached.expiresAtMs <= now &&
        !this.hydrationFlights.has(actor) &&
        !this.writeQueues.has(actor)
      ) {
        this.hydration.delete(actor);
        this.playerStates.delete(actor);
      }
    }
    if (this.playerStates.size <= this.maxCachedActors) return;
    const candidates = [...this.hydration.entries()]
      .filter(
        ([actor]) =>
          actor !== protectedActor &&
          !this.hydrationFlights.has(actor) &&
          !this.writeQueues.has(actor),
      )
      .sort(
        ([, left], [, right]) => left.lastAccessAtMs - right.lastAccessAtMs,
      );
    while (
      this.playerStates.size > this.maxCachedActors &&
      candidates.length > 0
    ) {
      const [actor] = candidates.shift()!;
      this.hydration.delete(actor);
      this.playerStates.delete(actor);
    }
  }

  private async boundedQuery<T>(operation: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error("achievement query timed out");
        error.name = "AchievementQueryTimeout";
        reject(error);
      }, this.queryTimeoutMs);
      timeout.unref?.();
    });
    try {
      return await Promise.race([operation, deadline]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async ensureHydrated(
    persistentId: string,
  ): Promise<AchievementHydrationState> {
    const cached = this.hydration.get(persistentId);
    if (cached && cached.expiresAtMs > this.now()) {
      return this.getHydrationState(persistentId);
    }
    const existing = this.hydrationFlights.get(persistentId);
    if (existing) return existing;

    const flight = (async () => {
      const database = this.database();
      if (!database) {
        const posture = this.databasePosture();
        return this.cacheHydration(
          persistentId,
          posture.configured && posture.state !== "ready"
            ? "degraded"
            : "process-local",
          posture.configured && posture.state !== "ready"
            ? "database-unavailable"
            : null,
        );
      }
      try {
        const result = await this.boundedQuery(
          database.query(
            `SELECT achievement_id, unlocked_at FROM player_achievements
             WHERE persistent_id = $1`,
            [persistentId],
          ),
        );
        const state = this.getOrCreate(persistentId);
        for (const row of result.rows as Array<{
          achievement_id: string;
          unlocked_at: Date | string;
        }>) {
          const timestamp = new Date(row.unlocked_at).getTime();
          if (Number.isFinite(timestamp)) {
            state.unlocked.set(row.achievement_id, timestamp);
          }
        }
        return this.cacheHydration(persistentId, "ready", null);
      } catch (error) {
        const timedOut =
          error instanceof Error && error.name === "AchievementQueryTimeout";
        logger.error("Failed to hydrate achievements from DB", {
          persistentId,
          errorCode: timedOut ? "query-timeout" : "query-failed",
        });
        this.getOrCreate(persistentId);
        return this.cacheHydration(
          persistentId,
          "degraded",
          timedOut ? "query-timeout" : "query-failed",
        );
      }
    })();
    this.hydrationFlights.set(persistentId, flight);
    try {
      return await flight;
    } finally {
      if (this.hydrationFlights.get(persistentId) === flight) {
        this.hydrationFlights.delete(persistentId);
      }
    }
  }

  private enqueueWrite<T>(
    persistentId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.writeQueues.get(persistentId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.writeQueues.set(persistentId, tail);
    void tail.finally(() => {
      if (this.writeQueues.get(persistentId) === tail) {
        this.writeQueues.delete(persistentId);
      }
    });
    return current;
  }

  private markDegraded(
    persistentId: string,
    errorCode: "query-failed" | "query-timeout",
  ): void {
    this.cacheHydration(persistentId, "degraded", errorCode);
  }

  private async unlockDefinition(
    persistentId: string,
    state: PlayerState,
    definition: AchievementDefinition,
    newlyUnlocked: AchievementDefinition[],
  ): Promise<void> {
    if (state.unlocked.has(definition.id)) return;
    const database = this.database();
    let newlyPersisted = true;
    if (database) {
      try {
        const result = await this.enqueueWrite(persistentId, () =>
          this.boundedQuery(
            database.query(
              `INSERT INTO player_achievements (persistent_id, achievement_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING
               RETURNING achievement_id`,
              [persistentId, definition.id],
            ),
          ),
        );
        newlyPersisted = (result.rowCount ?? result.rows.length) > 0;
      } catch (error) {
        const timedOut =
          error instanceof Error && error.name === "AchievementQueryTimeout";
        this.markDegraded(
          persistentId,
          timedOut ? "query-timeout" : "query-failed",
        );
        logger.error("Failed to persist achievement unlock", {
          persistentId,
          achievementId: definition.id,
          errorCode: timedOut ? "query-timeout" : "query-failed",
        });
      }
    }

    state.unlocked.set(definition.id, this.now());
    if (!newlyPersisted) return;
    newlyUnlocked.push(definition);
    logger.info("Achievement unlocked", {
      persistentId,
      achievementId: definition.id,
      achievementName: definition.name,
    });
  }

  private async tryUnlock(
    persistentId: string,
    state: PlayerState,
    achievementId: string,
    newlyUnlocked: AchievementDefinition[],
  ): Promise<void> {
    const definition = DEFINITION_MAP.get(achievementId);
    if (!definition) return;
    await this.unlockDefinition(persistentId, state, definition, newlyUnlocked);
  }
  /**
   * Evaluate an event for the given player and return any newly unlocked
   * AchievementDefinition objects. Callers should forward these to
   * DiscordNotifier and/or the client toast queue.
   */
  async checkAndUnlock(
    persistentId: string,
    event: AchievementEvent,
  ): Promise<AchievementDefinition[]> {
    await this.ensureHydrated(persistentId);
    const state = this.getOrCreate(persistentId);
    const newlyUnlocked: AchievementDefinition[] = [];

    switch (event.type) {
      case "vault_captured": {
        if (event.count >= 1) {
          await this.tryUnlock(
            persistentId,
            state,
            "first_vault",
            newlyUnlocked,
          );
        }
        break;
      }

      case "vault_count": {
        if (event.simultaneous >= 5) {
          await this.tryUnlock(
            persistentId,
            state,
            "five_vaults",
            newlyUnlocked,
          );
        }
        break;
      }

      case "convoy_delivered": {
        // Use the authoritative total from the event (server-tracked)
        state.convoyCount = event.totalCount;
        if (state.convoyCount >= 10) {
          await this.tryUnlock(
            persistentId,
            state,
            "ten_convoys",
            newlyUnlocked,
          );
        }
        if (state.convoyCount >= 100) {
          await this.tryUnlock(
            persistentId,
            state,
            "hundred_convoys",
            newlyUnlocked,
          );
        }
        break;
      }

      case "execution_chain": {
        if (event.matchCount >= 1) {
          await this.tryUnlock(
            persistentId,
            state,
            "first_chain",
            newlyUnlocked,
          );
        }
        if (event.matchCount >= 3) {
          await this.tryUnlock(
            persistentId,
            state,
            "triple_chain",
            newlyUnlocked,
          );
        }
        break;
      }

      case "surge_activated": {
        state.surgeActivatedThisSession = true;
        await this.tryUnlock(persistentId, state, "first_surge", newlyUnlocked);
        break;
      }

      case "jam_broken": {
        await this.tryUnlock(persistentId, state, "jam_broken", newlyUnlocked);
        break;
      }

      case "escort_streak": {
        if (event.consecutive >= 5) {
          await this.tryUnlock(
            persistentId,
            state,
            "escort_streak",
            newlyUnlocked,
          );
        }
        break;
      }

      case "squad_objective_completed": {
        await this.tryUnlock(
          persistentId,
          state,
          "squad_objective",
          newlyUnlocked,
        );
        break;
      }

      case "match_played": {
        state.matchCount = event.totalMatches;
        if (state.matchCount >= 50) {
          await this.tryUnlock(persistentId, state, "veteran", newlyUnlocked);
        }
        break;
      }

      case "match_ended": {
        if (event.won) {
          if (state.surgeActivatedThisSession) {
            await this.tryUnlock(
              persistentId,
              state,
              "surge_win",
              newlyUnlocked,
            );
          }
          if (event.onMutator) {
            await this.tryUnlock(
              persistentId,
              state,
              "mutator_win",
              newlyUnlocked,
            );
          }
          if (event.durationSeconds < 600) {
            await this.tryUnlock(
              persistentId,
              state,
              "speed_run",
              newlyUnlocked,
            );
          }
        }
        if (event.eloRating >= 1900) {
          await this.tryUnlock(
            persistentId,
            state,
            "grandmaster",
            newlyUnlocked,
          );
        }
        // Reset per-match surge flag after the match ends
        state.surgeActivatedThisSession = false;
        break;
      }
    }

    // Check meta-chains after any new individual unlock
    if (newlyUnlocked.length > 0) {
      const allUnlocked = new Set(state.unlocked.keys());
      for (const chain of META_CHAINS) {
        if (allUnlocked.has(chain.id)) continue; // already unlocked
        if (chain.requires.every((req) => allUnlocked.has(req))) {
          await this.unlockDefinition(
            persistentId,
            state,
            {
              id: chain.id,
              name: chain.name,
              description: chain.description + " [META]",
            },
            newlyUnlocked,
          );
        }
      }
    }

    return newlyUnlocked;
  }

  /** Returns full progress snapshot for all achievements for a player. */
  getProgress(persistentId: string): AchievementProgress[] {
    const state = this.getOrCreate(persistentId);
    return calcProgress(persistentId, state);
  }

  /** Returns the set of unlocked achievement ids for a player. */
  getUnlocked(persistentId: string): string[] {
    const state = this.playerStates.get(persistentId);
    if (!state) return [];
    return Array.from(state.unlocked.keys());
  }

  /** Returns meta-chain progress for a player. */
  getMetaChainProgress(persistentId: string): Array<{
    id: string;
    name: string;
    description: string;
    reward: { badge: string; title: string };
    requires: string[];
    completedRequires: string[];
    unlocked: boolean;
    unlockedAt: number | null;
  }> {
    const state = this.playerStates.get(persistentId);
    const unlocked = state?.unlocked ?? new Map<string, number>();
    return META_CHAINS.map((chain) => {
      const completedRequires = chain.requires.filter((r) => unlocked.has(r));
      const isUnlocked = unlocked.has(chain.id);
      return {
        id: chain.id,
        name: chain.name,
        description: chain.description,
        reward: chain.reward,
        requires: chain.requires,
        completedRequires,
        unlocked: isUnlocked,
        unlockedAt: isUnlocked ? (unlocked.get(chain.id) ?? null) : null,
      };
    });
  }

  /** Clears all state. Intended for test isolation only. */
  reset(): void {
    this.playerStates.clear();
    this.hydration.clear();
    this.hydrationFlights.clear();
    this.writeQueues.clear();
  }

  /**
   * Load persisted unlocks from Postgres into the in-memory state.
   * Call at game start for each player so prior unlocks are not re-awarded.
   * No-ops when pool is null.
   */
  async hydrateFromDb(persistentId: string): Promise<void> {
    await this.ensureHydrated(persistentId);
  }
}

export const achievementStore = new AchievementStore();
