// VaultFront — Player stats and match history store.
// Dual-path: in-memory when DATABASE_URL is absent; Postgres when present.
// Switch: `pool` from db/pool.ts is null → in-memory, non-null → Postgres.

import { pool } from "./db/pool";
import { EloRating, PLACEMENT_MATCH_COUNT } from "./EloRating";
import { logger } from "./Logger";

const log = logger.child({ comp: "PlayerStatsStore" });

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MatchResult {
  won: boolean;
  durationSeconds: number;
  vaultCaptures: number;
  convoyDeliveries: number;
  executionChains: number;
  mapName: string;
  playerCount: number;
  /** All participants in the match (used for Elo calculation). */
  allPlayers: Array<{
    persistentId: string;
    displayName?: string;
    won: boolean;
  }>;
  /** Optional authoritative per-player metrics for one-shot match fan-out. */
  statsByPersistentId?: Record<
    string,
    {
      vaultCaptures: number;
      convoyDeliveries: number;
      executionChains: number;
    }
  >;
}

export interface MatchHistoryEntry {
  id: number;
  persistentId: string;
  gameId: string;
  won: boolean;
  durationSeconds: number;
  vaultCaptures: number;
  convoyDeliveries: number;
  executionChains: number;
  eloBefore: number;
  eloAfter: number;
  eloDelta: number;
  mapName: string;
  playerCount: number;
  createdAt: string; // ISO 8601
}

export interface PlayerStats {
  persistentId: string;
  displayName: string;
  eloRating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  vaultCaptures: number;
  convoyDeliveries: number;
  executionChains: number;
  surgeActivations: number;
  /** True once the player has completed 5 placement matches */
  placementComplete: boolean;
  /** Placement match number (1–5) if in placement; 0 if complete */
  placementMatchNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeaderboardEntry {
  persistentId: string;
  displayName: string;
  eloRating: number;
  rank: number;
  matchesPlayed: number;
  wins: number;
}

// ── In-memory data structures ──────────────────────────────────────────────────

interface InMemoryPlayerRecord {
  persistentId: string;
  displayName: string;
  eloRating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  vaultCaptures: number;
  convoyDeliveries: number;
  executionChains: number;
  surgeActivations: number;
  createdAt: number; // Unix ms
  updatedAt: number;
}

interface InMemoryMatchEntry {
  id: number;
  persistentId: string;
  gameId: string;
  won: boolean;
  durationSeconds: number;
  vaultCaptures: number;
  convoyDeliveries: number;
  executionChains: number;
  eloBefore: number;
  eloAfter: number;
  eloDelta: number;
  mapName: string;
  playerCount: number;
  createdAt: number; // Unix ms
}

// ── Store implementation ───────────────────────────────────────────────────────

export class PlayerStatsStore {
  // In-memory state (used when pool is null)
  private readonly memPlayers = new Map<string, InMemoryPlayerRecord>();
  private readonly memHistory: InMemoryMatchEntry[] = [];
  private readonly memCompletedGameIds = new Set<string>();
  private nextId = 1;

  constructor() {
    if (pool) {
      log.info("PlayerStatsStore using Postgres");
    } else {
      log.warn(
        "DATABASE_URL not set — PlayerStatsStore using in-memory store. " +
          "Data will not persist across restarts. " +
          "Run `docker compose up -d` and set DATABASE_URL to enable Postgres.",
      );
    }
  }

  // ── Private in-memory helpers ─────────────────────────────────────────────

  private memEnsurePlayer(
    persistentId: string,
    displayName: string,
  ): InMemoryPlayerRecord {
    const existing = this.memPlayers.get(persistentId);
    if (existing) {
      if (displayName && displayName !== existing.displayName) {
        existing.displayName = displayName;
      }
      return existing;
    }
    const now = Date.now();
    const record: InMemoryPlayerRecord = {
      persistentId,
      displayName,
      eloRating: EloRating.DEFAULT_RATING,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      vaultCaptures: 0,
      convoyDeliveries: 0,
      executionChains: 0,
      surgeActivations: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.memPlayers.set(persistentId, record);
    return record;
  }

  // ── Postgres helpers ──────────────────────────────────────────────────────

  /**
   * UPSERT a player row. Returns the current elo_rating for that player.
   * Must be called within an existing transaction client.
   */
  private async pgEnsurePlayer(
    client: import("pg").PoolClient,
    persistentId: string,
    displayName: string,
  ): Promise<{ eloRating: number; matchesPlayed: number }> {
    const res = await client.query<{
      elo_rating: number;
      matches_played: number;
    }>(
      `INSERT INTO player_stats (persistent_id, display_name)
       VALUES ($1, $2)
       ON CONFLICT (persistent_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             updated_at   = NOW()
       RETURNING elo_rating, matches_played`,
      [persistentId, displayName || ""],
    );
    return {
      eloRating: res.rows[0].elo_rating,
      matchesPlayed: res.rows[0].matches_played,
    };
  }

  /** Refresh leaderboard_cache inside an open transaction. */
  private async pgRefreshLeaderboard(
    client: import("pg").PoolClient,
  ): Promise<void> {
    await client.query("TRUNCATE leaderboard_cache");
    await client.query(
      `INSERT INTO leaderboard_cache
         (persistent_id, display_name, elo_rating, rank, matches_played, wins, updated_at)
       SELECT persistent_id, display_name, elo_rating,
              ROW_NUMBER() OVER (ORDER BY elo_rating DESC) AS rank,
              matches_played, wins, NOW()
       FROM player_stats
       ORDER BY elo_rating DESC
       LIMIT 1000`,
    );
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Record a completed match for all participants and update Elo.
   *
   * Elo approximation for multi-player games:
   *   - Winners are matched against the average Elo of all losers (and vice-versa).
   */
  async recordMatch(
    persistentId: string,
    displayName: string,
    gameId: string,
    result: MatchResult,
  ): Promise<boolean> {
    if (pool) {
      return this.pgRecordMatch(persistentId, displayName, gameId, result);
    }
    return this.memRecordMatch(persistentId, displayName, gameId, result);
  }

  private async pgRecordMatch(
    persistentId: string,
    displayName: string,
    gameId: string,
    result: MatchResult,
  ): Promise<boolean> {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");

      // Serialize all fan-out attempts for one certified game. The subsequent
      // history probe is inside the same transaction, so a worker restart or
      // concurrent replay cannot increment Elo twice.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [gameId],
      );
      const existing = await client.query(
        "SELECT 1 FROM match_history WHERE game_id = $1 LIMIT 1",
        [gameId],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        await client.query("COMMIT");
        log.info("certified match replay ignored (pg)", { gameId });
        return false;
      }

      // Ensure all participants exist and collect their current Elo + match count
      const eloMap = new Map<string, number>();
      const matchCountMap = new Map<string, number>();
      for (const p of result.allPlayers) {
        const name =
          p.displayName ?? (p.persistentId === persistentId ? displayName : "");
        const { eloRating, matchesPlayed } = await this.pgEnsurePlayer(
          client,
          p.persistentId,
          name,
        );
        eloMap.set(p.persistentId, eloRating);
        matchCountMap.set(p.persistentId, matchesPlayed);
      }

      const winners = result.allPlayers.filter((p) => p.won);
      const losers = result.allPlayers.filter((p) => !p.won);

      const avgElo = (ids: Array<{ persistentId: string }>): number => {
        if (ids.length === 0) return EloRating.DEFAULT_RATING;
        const total = ids.reduce(
          (sum, p) =>
            sum + (eloMap.get(p.persistentId) ?? EloRating.DEFAULT_RATING),
          0,
        );
        return Math.round(total / ids.length);
      };

      const winnerAvg = avgElo(winners);
      const loserAvg = avgElo(losers);

      for (const p of result.allPlayers) {
        const isWinner = p.won;
        const currentElo =
          eloMap.get(p.persistentId) ?? EloRating.DEFAULT_RATING;
        const currentMatches = matchCountMap.get(p.persistentId) ?? 0;
        const opponentAvg = isWinner ? loserAvg : winnerAvg;
        const eloResult = EloRating.calculate(
          currentElo,
          opponentAvg,
          isWinner,
          currentMatches,
        );
        const newElo = Math.max(100, eloResult.newRatingA);
        const eloDelta = newElo - currentElo;
        const isSubject = p.persistentId === persistentId;
        const playerMetrics = result.statsByPersistentId?.[p.persistentId] ?? {
          vaultCaptures: isSubject ? result.vaultCaptures : 0,
          convoyDeliveries: isSubject ? result.convoyDeliveries : 0,
          executionChains: isSubject ? result.executionChains : 0,
        };

        await client.query(
          `UPDATE player_stats SET
             elo_rating        = $2,
             matches_played    = matches_played + 1,
             wins              = wins + $3,
             losses            = losses + $4,
             vault_captures    = vault_captures + $5,
             convoy_deliveries = convoy_deliveries + $6,
             execution_chains  = execution_chains + $7,
             updated_at        = NOW()
           WHERE persistent_id = $1`,
          [
            p.persistentId,
            newElo,
            isWinner ? 1 : 0,
            isWinner ? 0 : 1,
            playerMetrics.vaultCaptures,
            playerMetrics.convoyDeliveries,
            playerMetrics.executionChains,
          ],
        );

        await client.query(
          `INSERT INTO match_history
             (persistent_id, game_id, won, duration_seconds,
              vault_captures, convoy_deliveries, execution_chains,
              elo_before, elo_after, elo_delta, map_name, player_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            p.persistentId,
            gameId,
            isWinner,
            result.durationSeconds,
            playerMetrics.vaultCaptures,
            playerMetrics.convoyDeliveries,
            playerMetrics.executionChains,
            currentElo,
            newElo,
            eloDelta,
            result.mapName,
            result.playerCount,
          ],
        );

        log.info("match recorded (pg)", {
          persistentId: p.persistentId,
          gameId,
          won: isWinner,
          eloBefore: currentElo,
          eloAfter: newElo,
        });
      }

      await this.pgRefreshLeaderboard(client);
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      log.error("pgRecordMatch failed, rolled back", { err: String(err) });
      throw err;
    } finally {
      client.release();
    }
  }

  private async memRecordMatch(
    persistentId: string,
    displayName: string,
    gameId: string,
    result: MatchResult,
  ): Promise<boolean> {
    if (this.memCompletedGameIds.has(gameId)) {
      log.info("certified match replay ignored (mem)", { gameId });
      return false;
    }
    for (const p of result.allPlayers) {
      const name =
        p.displayName ?? (p.persistentId === persistentId ? displayName : "");
      this.memEnsurePlayer(p.persistentId, name);
    }

    const winners = result.allPlayers.filter((p) => p.won);
    const losers = result.allPlayers.filter((p) => !p.won);

    const avgElo = (ids: Array<{ persistentId: string }>): number => {
      if (ids.length === 0) return EloRating.DEFAULT_RATING;
      const total = ids.reduce((sum, p) => {
        const rec = this.memPlayers.get(p.persistentId);
        return sum + (rec?.eloRating ?? EloRating.DEFAULT_RATING);
      }, 0);
      return Math.round(total / ids.length);
    };

    const winnerAvg = avgElo(winners);
    const loserAvg = avgElo(losers);
    const now = Date.now();

    for (const p of result.allPlayers) {
      const rec = this.memPlayers.get(p.persistentId);
      if (!rec) continue;
      const opponentAvg = p.won ? loserAvg : winnerAvg;
      const eloResult = EloRating.calculate(rec.eloRating, opponentAvg, p.won);
      const eloBefore = rec.eloRating;
      rec.eloRating = Math.max(100, eloResult.newRatingA);
      rec.matchesPlayed += 1;
      if (p.won) rec.wins += 1;
      else rec.losses += 1;
      rec.updatedAt = now;
      const isSubject = p.persistentId === persistentId;
      const playerMetrics = result.statsByPersistentId?.[p.persistentId] ?? {
        vaultCaptures: isSubject ? result.vaultCaptures : 0,
        convoyDeliveries: isSubject ? result.convoyDeliveries : 0,
        executionChains: isSubject ? result.executionChains : 0,
      };
      rec.vaultCaptures += playerMetrics.vaultCaptures;
      rec.convoyDeliveries += playerMetrics.convoyDeliveries;
      rec.executionChains += playerMetrics.executionChains;
      this.memHistory.push({
        id: this.nextId++,
        persistentId: p.persistentId,
        gameId,
        won: p.won,
        durationSeconds: result.durationSeconds,
        vaultCaptures: playerMetrics.vaultCaptures,
        convoyDeliveries: playerMetrics.convoyDeliveries,
        executionChains: playerMetrics.executionChains,
        eloBefore,
        eloAfter: rec.eloRating,
        eloDelta: rec.eloRating - eloBefore,
        mapName: result.mapName,
        playerCount: result.playerCount,
        createdAt: now,
      });
      log.info("match recorded (mem)", {
        persistentId: p.persistentId,
        gameId,
        won: p.won,
        eloBefore,
        eloAfter: rec.eloRating,
      });
    }
    this.memCompletedGameIds.add(gameId);
    return true;
  }

  /** Retrieve match history for a player, most recent first. */
  async getHistory(
    persistentId: string,
    limit = 20,
  ): Promise<MatchHistoryEntry[]> {
    if (pool) {
      const res = await pool.query<{
        id: number;
        persistent_id: string;
        game_id: string;
        won: boolean;
        duration_seconds: number;
        vault_captures: number;
        convoy_deliveries: number;
        execution_chains: number;
        elo_before: number;
        elo_after: number;
        elo_delta: number;
        map_name: string;
        player_count: number;
        created_at: Date;
      }>(
        `SELECT * FROM match_history
         WHERE persistent_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [persistentId, limit],
      );
      return res.rows.map((r) => ({
        id: r.id,
        persistentId: r.persistent_id,
        gameId: r.game_id,
        won: r.won,
        durationSeconds: r.duration_seconds,
        vaultCaptures: r.vault_captures,
        convoyDeliveries: r.convoy_deliveries,
        executionChains: r.execution_chains,
        eloBefore: r.elo_before,
        eloAfter: r.elo_after,
        eloDelta: r.elo_delta,
        mapName: r.map_name,
        playerCount: r.player_count,
        createdAt: r.created_at.toISOString(),
      }));
    }

    return this.memHistory
      .filter((e) => e.persistentId === persistentId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((e) => ({
        id: e.id,
        persistentId: e.persistentId,
        gameId: e.gameId,
        won: e.won,
        durationSeconds: e.durationSeconds,
        vaultCaptures: e.vaultCaptures,
        convoyDeliveries: e.convoyDeliveries,
        executionChains: e.executionChains,
        eloBefore: e.eloBefore,
        eloAfter: e.eloAfter,
        eloDelta: e.eloDelta,
        mapName: e.mapName,
        playerCount: e.playerCount,
        createdAt: new Date(e.createdAt).toISOString(),
      }));
  }

  /** Get the global leaderboard sorted by Elo descending. */
  async getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
    if (pool) {
      const res = await pool.query<{
        persistent_id: string;
        display_name: string;
        elo_rating: number;
        rank: number;
        matches_played: number;
        wins: number;
      }>(
        `SELECT persistent_id, display_name, elo_rating, rank, matches_played, wins
         FROM leaderboard_cache
         ORDER BY rank ASC
         LIMIT $1`,
        [limit],
      );
      return res.rows.map((r) => ({
        persistentId: r.persistent_id,
        displayName: r.display_name,
        eloRating: r.elo_rating,
        rank: r.rank,
        matchesPlayed: r.matches_played,
        wins: r.wins,
      }));
    }

    return Array.from(this.memPlayers.values())
      .filter((p) => p.matchesPlayed > 0)
      .sort((a, b) => b.eloRating - a.eloRating)
      .slice(0, limit)
      .map((p, idx) => ({
        persistentId: p.persistentId,
        displayName: p.displayName,
        eloRating: p.eloRating,
        rank: idx + 1,
        matchesPlayed: p.matchesPlayed,
        wins: p.wins,
      }));
  }

  /** Get aggregate stats for a single player. */
  async getPlayerStats(persistentId: string): Promise<PlayerStats | null> {
    if (pool) {
      const res = await pool.query<{
        persistent_id: string;
        display_name: string;
        elo_rating: number;
        matches_played: number;
        wins: number;
        losses: number;
        vault_captures: number;
        convoy_deliveries: number;
        execution_chains: number;
        surge_activations: number;
        created_at: Date;
        updated_at: Date;
      }>(`SELECT * FROM player_stats WHERE persistent_id = $1`, [persistentId]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        persistentId: r.persistent_id,
        displayName: r.display_name,
        eloRating: r.elo_rating,
        matchesPlayed: r.matches_played,
        wins: r.wins,
        losses: r.losses,
        vaultCaptures: r.vault_captures,
        convoyDeliveries: r.convoy_deliveries,
        executionChains: r.execution_chains,
        surgeActivations: r.surge_activations,
        placementComplete: r.matches_played >= PLACEMENT_MATCH_COUNT,
        placementMatchNumber:
          r.matches_played >= PLACEMENT_MATCH_COUNT ? 0 : r.matches_played + 1,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      };
    }

    const rec = this.memPlayers.get(persistentId);
    if (!rec) return null;
    return {
      persistentId: rec.persistentId,
      displayName: rec.displayName,
      eloRating: rec.eloRating,
      matchesPlayed: rec.matchesPlayed,
      wins: rec.wins,
      losses: rec.losses,
      vaultCaptures: rec.vaultCaptures,
      convoyDeliveries: rec.convoyDeliveries,
      executionChains: rec.executionChains,
      surgeActivations: rec.surgeActivations,
      placementComplete: rec.matchesPlayed >= PLACEMENT_MATCH_COUNT,
      placementMatchNumber:
        rec.matchesPlayed >= PLACEMENT_MATCH_COUNT ? 0 : rec.matchesPlayed + 1,
      createdAt: new Date(rec.createdAt).toISOString(),
      updatedAt: new Date(rec.updatedAt).toISOString(),
    };
  }

  /** Returns the last N elo_after values from match history for sparkline rendering. */
  async getEloHistory(persistentId: string, limit = 10): Promise<number[]> {
    if (pool) {
      const res = await pool.query<{ elo_after: number }>(
        `SELECT elo_after FROM match_history
         WHERE persistent_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [persistentId, limit],
      );
      return res.rows.map((r) => r.elo_after).reverse();
    }
    // In-memory fallback: derive from match history
    return this.memHistory
      .filter((h) => h.persistentId === persistentId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((h) => h.eloAfter)
      .reverse();
  }

  /**
   * Seasonal soft-reset: reduce every player's Elo by up to
   * `EloRating.SEASONAL_SOFT_RESET_CAP` points, pulling toward DEFAULT_RATING.
   * Called by VaultSeasonScheduler on season rollover.
   */
  /** Award dynasty to the season's top-rated player and break any prior dynasty. */
  async awardDynasty(
    winnerPersistentId: string,
    emblem: string,
  ): Promise<void> {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Break the existing dynasty holder (mark broken_by the new winner)
      await client.query(
        `UPDATE player_stats
            SET dynasty_tier = 'broken', dynasty_broken_by = $1
          WHERE dynasty_tier NOT IN ('none','broken')`,
        [winnerPersistentId],
      );
      // Award new dynasty
      await client.query(
        `UPDATE player_stats
            SET dynasty_tier        = 'active',
                dynasty_seasons_won = dynasty_seasons_won + 1,
                dynasty_emblem      = $2
          WHERE persistent_id = $1`,
        [winnerPersistentId, emblem],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      log.error("awardDynasty failed", { err: String(err) });
    } finally {
      client.release();
    }
  }

  /** Return the player with the highest Elo (for dynasty award). */
  async getTopRatedPlayer(): Promise<
    { persistentId: string; displayName: string; eloRating: number } | undefined
  > {
    if (!pool) {
      // In-memory path
      let top: InMemoryPlayerRecord | undefined;
      for (const rec of this.memPlayers.values()) {
        if (!top || rec.eloRating > top.eloRating) top = rec;
      }
      return top
        ? {
            persistentId: top.persistentId,
            displayName: top.displayName,
            eloRating: top.eloRating,
          }
        : undefined;
    }
    const result = await pool
      .query(
        `SELECT persistent_id, display_name, elo_rating
           FROM player_stats
           ORDER BY elo_rating DESC
           LIMIT 1`,
      )
      .catch(() => null);
    const row = result?.rows[0];
    if (!row) return undefined;
    return {
      persistentId: row.persistent_id,
      displayName: row.display_name,
      eloRating: Number(row.elo_rating),
    };
  }

  /** Write anti-cheat timing signals for a match row; flag if suspiciously low stddev. */
  async recordAntiCheatSignals(
    gameId: string,
    persistentId: string,
    signals: {
      cmdMeanIntervalMs: number;
      cmdStddevMs: number;
      cmdActionsPerTick: number;
    },
  ): Promise<void> {
    const flagged =
      signals.cmdActionsPerTick > 2.5 ||
      (signals.cmdMeanIntervalMs < 50 && signals.cmdStddevMs < 5);
    if (pool) {
      await pool
        .query(
          `UPDATE match_history
             SET cmd_mean_interval_ms = $3,
                 cmd_stddev_ms        = $4,
                 cmd_actions_per_tick = $5,
                 anti_cheat_flagged   = $6
           WHERE game_id = $1 AND persistent_id = $2`,
          [
            gameId,
            persistentId,
            signals.cmdMeanIntervalMs,
            signals.cmdStddevMs,
            signals.cmdActionsPerTick,
            flagged,
          ],
        )
        .catch((err) =>
          log.error("recordAntiCheatSignals failed", { err: String(err) }),
        );
    }
  }

  /** Return the N most recent anti-cheat flagged match rows. */
  async getFlaggedMatches(limit = 50): Promise<
    Array<{
      persistentId: string;
      gameId: string;
      cmdMeanIntervalMs: number;
      cmdStddevMs: number;
      cmdActionsPerTick: number;
      createdAt: string;
    }>
  > {
    if (!pool) return [];
    const result = await pool
      .query(
        `SELECT persistent_id, game_id, cmd_mean_interval_ms,
                cmd_stddev_ms, cmd_actions_per_tick, created_at
           FROM match_history
          WHERE anti_cheat_flagged = TRUE
          ORDER BY created_at DESC
          LIMIT $1`,
        [limit],
      )
      .catch(() => null);
    if (!result) return [];
    return result.rows.map((r) => ({
      persistentId: r.persistent_id,
      gameId: r.game_id,
      cmdMeanIntervalMs: Number(r.cmd_mean_interval_ms ?? 0),
      cmdStddevMs: Number(r.cmd_stddev_ms ?? 0),
      cmdActionsPerTick: Number(r.cmd_actions_per_tick ?? 0),
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async seasonalSoftReset(): Promise<void> {
    const cap = EloRating.SEASONAL_SOFT_RESET_CAP;
    const def = EloRating.DEFAULT_RATING;
    if (pool) {
      await pool
        .query(
          `UPDATE player_stats
           SET elo_rating = CASE
             WHEN elo_rating > $1 THEN GREATEST($1, elo_rating - $2)
             WHEN elo_rating < $1 THEN LEAST($1, elo_rating + $2)
             ELSE $1
           END,
           updated_at = NOW()`,
          [def, cap],
        )
        .catch((err) =>
          log.error("seasonalSoftReset failed", { err: String(err) }),
        );
      return;
    }
    for (const rec of this.memPlayers.values()) {
      if (rec.eloRating > def) {
        rec.eloRating = Math.max(def, rec.eloRating - cap);
      } else if (rec.eloRating < def) {
        rec.eloRating = Math.min(def, rec.eloRating + cap);
      }
    }
  }
}

export const playerStatsStore = new PlayerStatsStore();
