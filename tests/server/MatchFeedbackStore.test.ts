import { describe, expect, test, vi } from "vitest";
import {
  MATCH_FEEDBACK_RETENTION_DAYS,
  MatchFeedbackStore,
} from "../../src/server/MatchFeedbackStore";

vi.mock("../../src/server/db/pool", () => ({ pool: null }));

const feedback = {
  persistentId: "player-1",
  gameId: "game-1",
  mapName: "plains",
  matchRating: 5,
  mapRating: 4,
  signal: "decisive-convoy" as const,
  won: true,
  behindAtMinute8: true,
  playStyle: "Convoy Lord" as const,
  styleConfidence: 67,
};

const DAY_MS = 24 * 60 * 60 * 1_000;

describe("MatchFeedbackStore", () => {
  test("deduplicates actor/game feedback and exposes privacy-safe certified outcome cohorts", async () => {
    const store = new MatchFeedbackStore(null);
    const first = await store.record(feedback, 1_000);
    const duplicate = await store.record({ ...feedback, mapRating: 1 }, 2_000);
    expect(first).toMatchObject({
      accepted: true,
      duplicate: false,
      durability: "process-local",
      evidence: "certified-match-result",
      retentionDays: 30,
    });
    expect(duplicate).toMatchObject({
      accepted: false,
      duplicate: true,
      durability: "process-local",
    });
    const summary = await store.summary(2_000);
    expect(summary).toMatchObject({
      durability: "process-local",
      evidence: "certified-match-result",
      retentionDays: 30,
      totalRatings: 1,
      maps: [
        {
          mapName: "plains",
          averageMapRating: 4,
          averageMatchRating: 5,
          ratingCount: 1,
        },
      ],
      cohorts: [
        {
          dimension: "feedback-signal",
          value: "decisive-convoy",
          ratingCount: 1,
        },
        { dimension: "match-path", value: "comeback-win", ratingCount: 1 },
        { dimension: "outcome", value: "win", ratingCount: 1 },
        {
          dimension: "play-style",
          value: "Convoy Lord",
          ratingCount: 1,
        },
      ],
    });
    expect(JSON.stringify(summary)).not.toMatch(/player-1|game-1/);
  });

  test("prunes actor-bound feedback at the declared 30-day boundary", async () => {
    const store = new MatchFeedbackStore(null);
    await store.record(feedback, 1_000);
    const expiredAt = 1_000 + MATCH_FEEDBACK_RETENTION_DAYS * DAY_MS + 1;

    expect(await store.summary(expiredAt)).toMatchObject({
      totalRatings: 0,
      maps: [],
      cohorts: [],
    });
    expect(await store.record(feedback, expiredAt)).toMatchObject({
      accepted: true,
      duplicate: false,
    });
  });

  test("uses a unique PostgreSQL insert and certified outcome cohorts", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ game_id: "game-1" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            map_name: "plains",
            rating_count: "2",
            average_map_rating: "4.5",
            average_match_rating: "4.0",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            dimension: "feedback-signal",
            cohort_value: "decisive-convoy",
            rating_count: "1",
            average_map_rating: "4.0",
            average_match_rating: "5.0",
          },
          {
            dimension: "play-style",
            cohort_value: "Convoy Lord",
            rating_count: "2",
            average_map_rating: "4.5",
            average_match_rating: "4.0",
          },
        ],
      });
    const store = new MatchFeedbackStore({ query } as any);
    expect(await store.record(feedback, 123)).toMatchObject({
      accepted: true,
      durability: "postgres",
    });
    expect(query.mock.calls[0][0]).toContain("DELETE FROM match_feedback");
    const insert = query.mock.calls[1];
    expect(insert[0]).toContain(
      "ON CONFLICT (persistent_id, game_id) DO NOTHING",
    );
    expect(insert[1]).toEqual([
      "player-1",
      "game-1",
      "plains",
      5,
      4,
      "decisive-convoy",
      true,
      true,
      "Convoy Lord",
      67,
    ]);
    expect(await store.summary(123)).toEqual({
      generatedAt: 123,
      windowDays: 30,
      retentionDays: 30,
      durability: "postgres",
      evidence: "certified-match-result",
      totalRatings: 2,
      maps: [
        {
          mapName: "plains",
          averageMapRating: 4.5,
          averageMatchRating: 4,
          ratingCount: 2,
        },
      ],
      cohorts: [
        {
          dimension: "feedback-signal",
          value: "decisive-convoy",
          averageMapRating: 4,
          averageMatchRating: 5,
          ratingCount: 1,
        },
        {
          dimension: "play-style",
          value: "Convoy Lord",
          averageMapRating: 4.5,
          averageMatchRating: 4,
          ratingCount: 2,
        },
      ],
    });
  });
});
