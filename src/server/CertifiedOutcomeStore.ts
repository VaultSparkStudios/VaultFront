import type { Pool } from "pg";
import {
  classifyPlayStyle,
  type ActivityCounts,
  type PlayStyleLabel,
} from "../core/PlayStyleClassifier";
import { pool } from "./db/pool";
import type { AuthoritativeMatchOutcome } from "./MatchProgression";

export type CertifiedOutcomeDurability = "postgres" | "process-local";

export interface CertifiedOutcomeEntry {
  persistentId: string;
  gameId: string;
  won: boolean;
  behindAtMinute8: boolean;
  durationSeconds: number;
  mapName: string;
  style: PlayStyleLabel;
  styleConfidence: number;
  styleMetrics: ActivityCounts;
  timestamp: number;
}

export interface CertifiedOutcomeReceipt {
  gameId: string;
  recordedPlayers: number;
  duplicatePlayers: number;
  durability: CertifiedOutcomeDurability;
}

export interface CertifiedStyleProfile {
  generatedAt: number;
  persistentId: string;
  durability: CertifiedOutcomeDurability;
  history: Array<{
    matchId: string;
    style: PlayStyleLabel;
    confidence: number;
    timestamp: number;
  }>;
  trend: { style: PlayStyleLabel; count: number } | null;
}

function styleCounts(player: AuthoritativeMatchOutcome["players"][number]) {
  return {
    vaultCaptures: player.vaultCaptures,
    conquests: player.conquests ?? 0,
    convoysDelivered: player.convoyDeliveries,
    passivePayouts: player.passivePayouts ?? 0,
    cleanExecutionStreaks: player.executionChains,
    betrayals: player.betrayals ?? 0,
    jamBreakerUses: player.jamBreakerUses ?? 0,
    convoyEscortCommands: player.convoyEscortCommands ?? 0,
    defenseFactoryTicks: player.defenseFactoryTicks ?? 0,
  };
}

function trend(
  history: CertifiedStyleProfile["history"],
): CertifiedStyleProfile["trend"] {
  if (history.length < 3) return null;
  const counts = new Map<PlayStyleLabel, number>();
  for (const entry of history.slice(0, 3)) {
    counts.set(entry.style, (counts.get(entry.style) ?? 0) + 1);
  }
  const winner = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];
  return winner && winner[1] >= 2
    ? { style: winner[0], count: winner[1] }
    : null;
}

/**
 * Certified match outcomes are the only source for win, duration, and career
 * style. PostgreSQL owns durable deployments; database-free development stays
 * explicit through labeled process-local receipts.
 */
export class CertifiedOutcomeStore {
  private readonly memory = new Map<string, CertifiedOutcomeEntry>();
  private lastMemoryTimestamp = 0;

  constructor(private readonly database: Pool | null = pool) {}

  durability(): CertifiedOutcomeDurability {
    return this.database ? "postgres" : "process-local";
  }

  async recordMatch(
    outcome: AuthoritativeMatchOutcome,
  ): Promise<CertifiedOutcomeReceipt> {
    let recordedPlayers = 0;
    for (const player of outcome.players) {
      const metrics = styleCounts(player);
      const style = classifyPlayStyle(metrics);
      if (this.database) {
        const result = await this.database.query(
          `INSERT INTO certified_outcomes
             (persistent_id, game_id, won, behind_at_minute_8,
              duration_seconds, map_name, play_style, style_confidence,
              style_metrics)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           ON CONFLICT (persistent_id, game_id) DO NOTHING
           RETURNING game_id`,
          [
            player.persistentId,
            outcome.gameId,
            player.won,
            player.behindAtMinute8 ?? false,
            outcome.durationSeconds,
            outcome.mapName,
            style.label,
            style.dominant,
            JSON.stringify(metrics),
          ],
        );
        recordedPlayers += Number(result.rowCount ?? 0);
      } else {
        const key = `${player.persistentId}\u0000${outcome.gameId}`;
        if (this.memory.has(key)) continue;
        this.memory.set(key, {
          persistentId: player.persistentId,
          gameId: outcome.gameId,
          won: player.won,
          behindAtMinute8: player.behindAtMinute8 ?? false,
          durationSeconds: outcome.durationSeconds,
          mapName: outcome.mapName,
          style: style.label,
          styleConfidence: style.dominant,
          styleMetrics: metrics,
          timestamp: (this.lastMemoryTimestamp = Math.max(
            Date.now(),
            this.lastMemoryTimestamp + 1,
          )),
        });
        recordedPlayers += 1;
      }
    }
    return {
      gameId: outcome.gameId,
      recordedPlayers,
      duplicatePlayers: outcome.players.length - recordedPlayers,
      durability: this.durability(),
    };
  }

  async profile(
    persistentId: string,
    limit = 20,
    now = Date.now(),
  ): Promise<CertifiedStyleProfile> {
    let history: CertifiedStyleProfile["history"];
    if (this.database) {
      const result = await this.database.query<{
        game_id: string;
        play_style: PlayStyleLabel;
        style_confidence: number;
        created_at: Date | string;
      }>(
        `SELECT game_id, play_style, style_confidence, created_at
           FROM certified_outcomes
          WHERE persistent_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [persistentId, limit],
      );
      history = result.rows.map((row) => ({
        matchId: row.game_id,
        style: row.play_style,
        confidence: Number(row.style_confidence),
        timestamp: new Date(row.created_at).getTime(),
      }));
    } else {
      history = [...this.memory.values()]
        .filter((entry) => entry.persistentId === persistentId)
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, limit)
        .map((entry) => ({
          matchId: entry.gameId,
          style: entry.style,
          confidence: entry.styleConfidence,
          timestamp: entry.timestamp,
        }));
    }
    return {
      generatedAt: now,
      persistentId,
      durability: this.durability(),
      history,
      trend: trend(history),
    };
  }

  async summary(now = Date.now()) {
    if (this.database) {
      const result = await this.database.query<{
        matches: string;
        wins: string;
        behind_at_minute_8: string;
        avg_duration_seconds: string | null;
      }>(
        `SELECT COUNT(*)::text AS matches,
                COUNT(*) FILTER (WHERE won)::text AS wins,
                COUNT(*) FILTER (WHERE behind_at_minute_8)::text
                  AS behind_at_minute_8,
                ROUND(AVG(duration_seconds))::text AS avg_duration_seconds
           FROM certified_outcomes`,
      );
      const row = result.rows[0];
      return {
        generatedAt: now,
        durability: "postgres" as const,
        evidence: "certified-match-result" as const,
        players: Number(row?.matches ?? 0),
        wins: Number(row?.wins ?? 0),
        behindAtMinute8: Number(row?.behind_at_minute_8 ?? 0),
        averageDurationSeconds: Number(row?.avg_duration_seconds ?? 0),
      };
    }
    const entries = [...this.memory.values()];
    return {
      generatedAt: now,
      durability: "process-local" as const,
      evidence: "certified-match-result" as const,
      players: entries.length,
      wins: entries.filter((entry) => entry.won).length,
      behindAtMinute8: entries.filter((entry) => entry.behindAtMinute8).length,
      averageDurationSeconds:
        entries.length > 0
          ? Math.round(
              entries.reduce(
                (total, entry) => total + entry.durationSeconds,
                0,
              ) / entries.length,
            )
          : 0,
    };
  }
}

export const certifiedOutcomeStore = new CertifiedOutcomeStore();
