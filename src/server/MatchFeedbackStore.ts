import type { Pool } from "pg";
import { pool } from "./db/pool";

export type MatchFeedbackDurability = "postgres" | "process-local";

export interface MatchFeedbackInput {
  persistentId: string;
  gameId: string;
  mapName: string;
  matchRating: number;
  mapRating: number;
  comment?: string;
}

export interface MatchFeedbackReceipt {
  accepted: boolean;
  duplicate: boolean;
  gameId: string;
  mapName: string;
  durability: MatchFeedbackDurability;
}

export interface MatchFeedbackSummary {
  generatedAt: number;
  windowDays: 30;
  durability: MatchFeedbackDurability;
  totalRatings: number;
  maps: Array<{
    mapName: string;
    averageMapRating: number;
    averageMatchRating: number;
    ratingCount: number;
  }>;
}

interface StoredFeedback extends MatchFeedbackInput {
  createdAt: number;
}

function roundedAverage(sum: number, count: number): number {
  return count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
}

/**
 * One actor may rate one certified match once. PostgreSQL is authoritative
 * when configured; the bounded process-local path exists only for database-free
 * development and labels that scope in every receipt and summary.
 */
export class MatchFeedbackStore {
  private readonly memory = new Map<string, StoredFeedback>();

  constructor(private readonly database: Pool | null = pool) {}

  durability(): MatchFeedbackDurability {
    return this.database ? "postgres" : "process-local";
  }

  async record(input: MatchFeedbackInput): Promise<MatchFeedbackReceipt> {
    if (this.database) {
      const result = await this.database.query(
        `INSERT INTO match_feedback
           (persistent_id, game_id, map_name, match_rating, map_rating, comment)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (persistent_id, game_id) DO NOTHING
         RETURNING game_id`,
        [
          input.persistentId,
          input.gameId,
          input.mapName,
          input.matchRating,
          input.mapRating,
          input.comment ?? null,
        ],
      );
      const accepted = Boolean(result.rowCount);
      return {
        accepted,
        duplicate: !accepted,
        gameId: input.gameId,
        mapName: input.mapName,
        durability: "postgres",
      };
    }

    const key = `${input.persistentId}\u0000${input.gameId}`;
    if (this.memory.has(key)) {
      return {
        accepted: false,
        duplicate: true,
        gameId: input.gameId,
        mapName: input.mapName,
        durability: "process-local",
      };
    }
    this.memory.set(key, { ...input, createdAt: Date.now() });
    return {
      accepted: true,
      duplicate: false,
      gameId: input.gameId,
      mapName: input.mapName,
      durability: "process-local",
    };
  }

  async summary(now = Date.now()): Promise<MatchFeedbackSummary> {
    if (this.database) {
      const result = await this.database.query<{
        map_name: string;
        rating_count: string;
        average_map_rating: string;
        average_match_rating: string;
      }>(
        `SELECT map_name,
                COUNT(*)::text AS rating_count,
                ROUND(AVG(map_rating)::numeric, 1)::text AS average_map_rating,
                ROUND(AVG(match_rating)::numeric, 1)::text AS average_match_rating
           FROM match_feedback
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY map_name
          ORDER BY COUNT(*) DESC, map_name ASC`,
      );
      const maps = result.rows.map((row) => ({
        mapName: row.map_name,
        averageMapRating: Number(row.average_map_rating),
        averageMatchRating: Number(row.average_match_rating),
        ratingCount: Number(row.rating_count),
      }));
      return {
        generatedAt: now,
        windowDays: 30,
        durability: "postgres",
        totalRatings: maps.reduce((total, item) => total + item.ratingCount, 0),
        maps,
      };
    }

    const cutoff = now - 30 * 24 * 60 * 60 * 1_000;
    const aggregates = new Map<
      string,
      { count: number; mapTotal: number; matchTotal: number }
    >();
    for (const feedback of this.memory.values()) {
      if (feedback.createdAt < cutoff) continue;
      const aggregate = aggregates.get(feedback.mapName) ?? {
        count: 0,
        mapTotal: 0,
        matchTotal: 0,
      };
      aggregate.count += 1;
      aggregate.mapTotal += feedback.mapRating;
      aggregate.matchTotal += feedback.matchRating;
      aggregates.set(feedback.mapName, aggregate);
    }
    const maps = [...aggregates.entries()]
      .map(([mapName, aggregate]) => ({
        mapName,
        averageMapRating: roundedAverage(aggregate.mapTotal, aggregate.count),
        averageMatchRating: roundedAverage(
          aggregate.matchTotal,
          aggregate.count,
        ),
        ratingCount: aggregate.count,
      }))
      .sort(
        (left, right) =>
          right.ratingCount - left.ratingCount ||
          left.mapName.localeCompare(right.mapName),
      );
    return {
      generatedAt: now,
      windowDays: 30,
      durability: "process-local",
      totalRatings: maps.reduce((total, item) => total + item.ratingCount, 0),
      maps,
    };
  }
}

export const matchFeedbackStore = new MatchFeedbackStore();
