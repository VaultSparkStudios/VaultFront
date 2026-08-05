import type { Pool } from "pg";
import type { PlayStyleLabel } from "../core/PlayStyleClassifier";
import { pool } from "./db/pool";

export const MATCH_FEEDBACK_RETENTION_DAYS = 30;
const MATCH_FEEDBACK_RETENTION_MS =
  MATCH_FEEDBACK_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1_000;

export type MatchFeedbackDurability = "postgres" | "process-local";

export const MATCH_FEEDBACK_SIGNALS = [
  "decisive-convoy",
  "comeback-tension",
  "clear-objectives",
  "pacing-drag",
  "map-flow",
  "control-friction",
  "technical-friction",
] as const;
export type MatchFeedbackSignal = (typeof MATCH_FEEDBACK_SIGNALS)[number];

export interface MatchFeedbackInput {
  persistentId: string;
  gameId: string;
  mapName: string;
  matchRating: number;
  mapRating: number;
  signal?: MatchFeedbackSignal;
  won: boolean;
  behindAtMinute8: boolean;
  playStyle: PlayStyleLabel;
  styleConfidence: number;
}

export interface MatchFeedbackReceipt {
  accepted: boolean;
  duplicate: boolean;
  gameId: string;
  mapName: string;
  durability: MatchFeedbackDurability;
  evidence: "certified-match-result";
  retentionDays: 30;
  signal: MatchFeedbackSignal | null;
}

export interface CertifiedFeedbackCohort {
  dimension: "outcome" | "match-path" | "play-style" | "feedback-signal";
  value: string;
  averageMapRating: number;
  averageMatchRating: number;
  ratingCount: number;
}

export interface MatchFeedbackSummary {
  generatedAt: number;
  windowDays: 30;
  retentionDays: 30;
  durability: MatchFeedbackDurability;
  evidence: "certified-match-result";
  totalRatings: number;
  maps: Array<{
    mapName: string;
    averageMapRating: number;
    averageMatchRating: number;
    ratingCount: number;
  }>;
  cohorts: CertifiedFeedbackCohort[];
}

interface StoredFeedback extends MatchFeedbackInput {
  createdAt: number;
}

function roundedAverage(sum: number, count: number): number {
  return count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
}

function cohortValues(
  feedback: StoredFeedback,
): Array<readonly [CertifiedFeedbackCohort["dimension"], string]> {
  const values: Array<readonly [CertifiedFeedbackCohort["dimension"], string]> =
    [
      ["outcome", feedback.won ? "win" : "loss"],
      [
        "match-path",
        feedback.behindAtMinute8
          ? feedback.won
            ? "comeback-win"
            : "failed-comeback"
          : feedback.won
            ? "front-foot-win"
            : "front-foot-loss",
      ],
      ["play-style", feedback.playStyle],
    ];
  if (feedback.signal) values.push(["feedback-signal", feedback.signal]);
  return values;
}
/**
 * One actor may rate one certified match once. PostgreSQL is authoritative
 * when configured; the bounded process-local path exists only for database-free
 * development and labels that scope in every receipt and summary.
 */
export class MatchFeedbackStore {
  private readonly memory = new Map<string, StoredFeedback>();
  private nextPruneAt = 0;

  constructor(private readonly database: Pool | null = pool) {}

  durability(): MatchFeedbackDurability {
    return this.database ? "postgres" : "process-local";
  }

  private async prune(now: number): Promise<void> {
    if (now < this.nextPruneAt) return;
    const cutoff = now - MATCH_FEEDBACK_RETENTION_MS;
    if (this.database) {
      await this.database.query(
        "DELETE FROM match_feedback WHERE created_at < $1",
        [new Date(cutoff)],
      );
    } else {
      for (const [key, feedback] of this.memory) {
        if (feedback.createdAt < cutoff) this.memory.delete(key);
      }
    }
    this.nextPruneAt = now + PRUNE_INTERVAL_MS;
  }

  async record(
    input: MatchFeedbackInput,
    now = Date.now(),
  ): Promise<MatchFeedbackReceipt> {
    await this.prune(now);
    if (this.database) {
      const result = await this.database.query(
        `INSERT INTO match_feedback
           (persistent_id, game_id, map_name, match_rating, map_rating, comment,
            feedback_won, feedback_behind_at_minute_8, feedback_play_style,
            feedback_style_confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (persistent_id, game_id) DO NOTHING
         RETURNING game_id`,
        [
          input.persistentId,
          input.gameId,
          input.mapName,
          input.matchRating,
          input.mapRating,
          input.signal ?? null,
          input.won,
          input.behindAtMinute8,
          input.playStyle,
          input.styleConfidence,
        ],
      );
      const accepted = Boolean(result.rowCount);
      return this.receipt(input, accepted, "postgres");
    }

    const key = `${input.persistentId}\u0000${input.gameId}`;
    if (this.memory.has(key)) {
      return this.receipt(input, false, "process-local");
    }
    this.memory.set(key, { ...input, createdAt: now });
    return this.receipt(input, true, "process-local");
  }

  private receipt(
    input: MatchFeedbackInput,
    accepted: boolean,
    durability: MatchFeedbackDurability,
  ): MatchFeedbackReceipt {
    return {
      accepted,
      duplicate: !accepted,
      gameId: input.gameId,
      mapName: input.mapName,
      durability,
      evidence: "certified-match-result",
      retentionDays: MATCH_FEEDBACK_RETENTION_DAYS,
      signal: input.signal ?? null,
    };
  }

  async summary(now = Date.now()): Promise<MatchFeedbackSummary> {
    await this.prune(now);
    if (this.database) {
      const cutoff = new Date(now - MATCH_FEEDBACK_RETENTION_MS);
      const mapsResult = await this.database.query<{
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
          WHERE created_at >= $1
          GROUP BY map_name
          ORDER BY COUNT(*) DESC, map_name ASC`,
        [cutoff],
      );
      const cohortResult = await this.database.query<{
        dimension: CertifiedFeedbackCohort["dimension"];
        cohort_value: string;
        rating_count: string;
        average_map_rating: string;
        average_match_rating: string;
      }>(
        `SELECT dimension,
                cohort_value,
                COUNT(*)::text AS rating_count,
                ROUND(AVG(map_rating)::numeric, 1)::text AS average_map_rating,
                ROUND(AVG(match_rating)::numeric, 1)::text AS average_match_rating
           FROM match_feedback
           CROSS JOIN LATERAL (
             VALUES
               ('outcome'::text, CASE
                  WHEN feedback_won IS NULL THEN NULL
                  WHEN feedback_won THEN 'win'
                  ELSE 'loss'
                END),
               ('match-path'::text, CASE
                  WHEN feedback_won IS NULL OR feedback_behind_at_minute_8 IS NULL THEN NULL
                  WHEN feedback_behind_at_minute_8 AND feedback_won THEN 'comeback-win'
                  WHEN feedback_behind_at_minute_8 THEN 'failed-comeback'
                  WHEN feedback_won THEN 'front-foot-win'
                  ELSE 'front-foot-loss'
                END),
               ('play-style'::text, feedback_play_style),
               ('feedback-signal'::text, CASE
                  WHEN comment IN (
                    'decisive-convoy', 'comeback-tension', 'clear-objectives',
                    'pacing-drag', 'map-flow', 'control-friction',
                    'technical-friction'
                  ) THEN comment
                  ELSE NULL
                END)
           ) AS certified_cohort(dimension, cohort_value)
          WHERE created_at >= $1 AND cohort_value IS NOT NULL
          GROUP BY dimension, cohort_value
          ORDER BY dimension ASC, COUNT(*) DESC, cohort_value ASC`,
        [cutoff],
      );
      const maps = mapsResult.rows.map((row) => ({
        mapName: row.map_name,
        averageMapRating: Number(row.average_map_rating),
        averageMatchRating: Number(row.average_match_rating),
        ratingCount: Number(row.rating_count),
      }));
      return this.buildSummary(
        now,
        "postgres",
        maps,
        cohortResult.rows.map((row) => ({
          dimension: row.dimension,
          value: row.cohort_value,
          averageMapRating: Number(row.average_map_rating),
          averageMatchRating: Number(row.average_match_rating),
          ratingCount: Number(row.rating_count),
        })),
      );
    }

    const mapAggregates = new Map<
      string,
      { count: number; mapTotal: number; matchTotal: number }
    >();
    const cohortAggregates = new Map<
      string,
      {
        dimension: CertifiedFeedbackCohort["dimension"];
        value: string;
        count: number;
        mapTotal: number;
        matchTotal: number;
      }
    >();
    for (const feedback of this.memory.values()) {
      const aggregate = mapAggregates.get(feedback.mapName) ?? {
        count: 0,
        mapTotal: 0,
        matchTotal: 0,
      };
      aggregate.count += 1;
      aggregate.mapTotal += feedback.mapRating;
      aggregate.matchTotal += feedback.matchRating;
      mapAggregates.set(feedback.mapName, aggregate);
      for (const [dimension, value] of cohortValues(feedback)) {
        const key = `${dimension}\u0000${value}`;
        const cohort = cohortAggregates.get(key) ?? {
          dimension,
          value,
          count: 0,
          mapTotal: 0,
          matchTotal: 0,
        };
        cohort.count += 1;
        cohort.mapTotal += feedback.mapRating;
        cohort.matchTotal += feedback.matchRating;
        cohortAggregates.set(key, cohort);
      }
    }
    const maps = [...mapAggregates.entries()]
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
    const cohorts = [...cohortAggregates.values()]
      .map((cohort) => ({
        dimension: cohort.dimension,
        value: cohort.value,
        averageMapRating: roundedAverage(cohort.mapTotal, cohort.count),
        averageMatchRating: roundedAverage(cohort.matchTotal, cohort.count),
        ratingCount: cohort.count,
      }))
      .sort(
        (left, right) =>
          left.dimension.localeCompare(right.dimension) ||
          right.ratingCount - left.ratingCount ||
          left.value.localeCompare(right.value),
      );
    return this.buildSummary(now, "process-local", maps, cohorts);
  }

  private buildSummary(
    generatedAt: number,
    durability: MatchFeedbackDurability,
    maps: MatchFeedbackSummary["maps"],
    cohorts: CertifiedFeedbackCohort[],
  ): MatchFeedbackSummary {
    return {
      generatedAt,
      windowDays: MATCH_FEEDBACK_RETENTION_DAYS,
      retentionDays: MATCH_FEEDBACK_RETENTION_DAYS,
      durability,
      evidence: "certified-match-result",
      totalRatings: maps.reduce((total, item) => total + item.ratingCount, 0),
      maps,
      cohorts,
    };
  }
}

export const matchFeedbackStore = new MatchFeedbackStore();
