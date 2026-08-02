import { describe, expect, test, vi } from "vitest";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  },
}));
vi.mock("../../src/server/db/pool", () => ({ pool: null }));
vi.mock("../../src/server/DiscordNotifier", () => ({
  DiscordNotifier: {
    weeklyMutatorAnnounced: vi.fn(),
    weeklyVoteOpened: vi.fn(),
    voteResultPosted: vi.fn(),
  },
}));
vi.mock("../../src/server/PlayerStatsStore", () => ({
  playerStatsStore: {
    seasonalSoftReset: vi.fn(async () => undefined),
    getTopRatedPlayer: vi.fn(async () => null),
    awardDynasty: vi.fn(async () => undefined),
  },
}));

import {
  VaultSeasonScheduler,
  verifyMutatorElectionOutcome,
  type VaultSeasonSchedulerDependencies,
} from "../../src/server/VaultSeasonScheduler";

function dependencies(clock: { now: Date }, database: any = null) {
  return {
    now: () => new Date(clock.now),
    database: () => database,
    notifier: {
      weeklyMutatorAnnounced: vi.fn(),
      weeklyVoteOpened: vi.fn(),
      voteResultPosted: vi.fn(),
    },
    stats: {
      seasonalSoftReset: vi.fn(async () => undefined),
      getTopRatedPlayer: vi.fn(async () => null),
      awardDynasty: vi.fn(async () => undefined),
    },
    setInterval: vi.fn(() => 1 as any),
    clearInterval: vi.fn(),
  } as unknown as VaultSeasonSchedulerDependencies;
}

class ElectionDatabase {
  readonly votes = new Map<string, string>();
  readonly outcomes = new Map<number, any>();

  async query<T>(text: string, values: any[] = []): Promise<any> {
    if (text.includes("INSERT INTO season_votes")) {
      const key = `${values[0]}:${values[1]}`;
      if (this.votes.has(key)) return { rows: [], rowCount: 0 };
      this.votes.set(key, values[2]);
      return { rows: [{ candidate_key: values[2] }], rowCount: 1 };
    }
    if (text.includes("FROM season_votes")) {
      const prefix = `${values[0]}:`;
      const rows = [...this.votes.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, candidate_key]) => ({
          candidate_key,
          voter_id: key.slice(prefix.length),
        }));
      return { rows, rowCount: rows.length };
    }
    if (text.includes("INSERT INTO season_mutator_outcomes")) {
      const week = Number(values[0]);
      if (this.outcomes.has(week)) return { rows: [], rowCount: 0 };
      const row = {
        effective_week: week,
        selected_key: values[1],
        source: values[2],
        durability: values[3],
        winning_votes: values[4],
        total_votes: values[5],
        decided_at: values[6],
        receipt_digest: values[7],
      };
      this.outcomes.set(week, row);
      return { rows: [row] as T[], rowCount: 1 };
    }
    if (text.includes("FROM season_mutator_outcomes WHERE effective_week =")) {
      const row = this.outcomes.get(Number(values[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes("FROM season_mutator_outcomes")) {
      const rows = [...this.outcomes.values()].filter(
        (row) => row.effective_week >= Number(values[0]),
      );
      return { rows, rowCount: rows.length };
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

describe("VaultSeasonScheduler causal election", () => {
  test("deduplicates concurrent actor ballots and causally selects the winner", async () => {
    const clock = { now: new Date("2026-08-02T13:00:00.000Z") };
    const scheduler = new VaultSeasonScheduler(dependencies(clock));
    await scheduler.tick();
    const candidate = scheduler.getStatus().vote!.candidates[0].key;
    const [first, duplicate] = await Promise.all([
      scheduler.recordVote(candidate, "actor-1"),
      scheduler.recordVote(candidate, "actor-1"),
    ]);
    expect([first.reason, duplicate.reason].sort()).toEqual([
      "accepted",
      "duplicate-actor",
    ]);
    await scheduler.recordVote(candidate, "actor-2");

    clock.now = new Date("2026-08-03T00:00:00.001Z");
    await scheduler.tick();
    const status = scheduler.getStatus();
    expect(status.currentMutator.key).toBe(candidate);
    expect(status.selection).toMatchObject({
      source: "community-vote",
      winningVotes: 2,
      totalVotes: 2,
      durability: "process-local",
    });
    expect(verifyMutatorElectionOutcome(status.selection)).toBe(true);
    expect(
      verifyMutatorElectionOutcome({
        ...status.selection,
        selectedKey: "tampered",
      }),
    ).toBe(false);
  });

  test("uses explicit deterministic no-vote and tie fallbacks", async () => {
    const noVoteClock = { now: new Date("2026-08-02T13:00:00.000Z") };
    const noVote = new VaultSeasonScheduler(dependencies(noVoteClock));
    await noVote.tick();
    noVoteClock.now = new Date("2026-08-03T00:00:00.001Z");
    await noVote.tick();
    expect(noVote.getStatus().selection.source).toBe("deterministic-no-vote");

    const tieClock = { now: new Date("2026-08-02T13:00:00.000Z") };
    const tie = new VaultSeasonScheduler(dependencies(tieClock));
    await tie.tick();
    const [a, b] = tie.getStatus().vote!.candidates;
    await tie.recordVote(a.key, "actor-a");
    await tie.recordVote(b.key, "actor-b");
    tieClock.now = new Date("2026-08-03T00:00:00.001Z");
    await tie.tick();
    expect(tie.getStatus().selection).toMatchObject({
      source: "deterministic-tie",
      winningVotes: 1,
      totalVotes: 2,
    });
  });

  test("survives restart through digest-verified database outcomes", async () => {
    const database = new ElectionDatabase();
    const clock = { now: new Date("2026-08-02T13:00:00.000Z") };
    const first = new VaultSeasonScheduler(dependencies(clock, database));
    await first.tick();
    const candidate = first.getStatus().vote!.candidates[1].key;
    await first.recordVote(candidate, "actor-1");
    clock.now = new Date("2026-08-03T00:00:00.001Z");
    await first.tick();

    const restarted = new VaultSeasonScheduler(dependencies(clock, database));
    await restarted.start();
    expect(restarted.getStatus().selection).toMatchObject({
      selectedKey: candidate,
      source: "community-vote",
      durability: "postgres",
    });
    restarted.stop();
  });

  test("fails a configured persistence error without incrementing memory", async () => {
    const database = {
      query: vi.fn(async () => {
        throw new Error("offline");
      }),
    };
    const clock = { now: new Date("2026-08-02T13:00:00.000Z") };
    const scheduler = new VaultSeasonScheduler(dependencies(clock, database));
    await scheduler.tick();
    const candidate = scheduler.getStatus().vote!.candidates[0].key;
    const receipt = await scheduler.recordVote(candidate, "actor-1");
    expect(receipt).toMatchObject({
      accepted: false,
      reason: "persistence-unavailable",
      durability: "none",
    });
    expect(scheduler.getStatus().voteStandings[0].votes).toBe(0);
  });
});
