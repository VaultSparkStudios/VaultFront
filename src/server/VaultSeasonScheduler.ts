/** Authoritative, actor-bound weekly mutator election and runtime selection. */
import { createHash } from "node:crypto";
import { pool } from "./db/pool";
import { DiscordNotifier } from "./DiscordNotifier";
import { logger } from "./Logger";
import { playerStatsStore } from "./PlayerStatsStore";

const log = logger.child({ comp: "VaultSeasonScheduler" });
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

interface MutatorDef {
  key: string;
  name: string;
  description: string;
}

const MUTATOR_DEFS: Record<string, MutatorDef> = {
  none: {
    key: "none",
    name: "Standard Rules",
    description: "No modifier active — baseline VaultFront gameplay.",
  },
  lane_fog: {
    key: "lane_fog",
    name: "Lane Fog",
    description: "Convoy routes are obscured until scouts clear the path.",
  },
  accelerated_cooldowns: {
    key: "accelerated_cooldowns",
    name: "Accelerated Cooldowns",
    description: "Vault capture and beacon cooldowns run 30% faster this week.",
  },
  double_passive: {
    key: "double_passive",
    name: "Double Passive",
    description: "Vault passive gold income is doubled — economy accelerates.",
  },
  gold_rush: {
    key: "gold_rush",
    name: "Gold Rush",
    description:
      "Convoy gold rewards are boosted +50% — high-stakes extraction.",
  },
  blitz: {
    key: "blitz",
    name: "Blitz",
    description: "Vault capture time reduced 40% — control windows close fast.",
  },
  no_mercy: {
    key: "no_mercy",
    name: "No Mercy",
    description: "Escort shields are disabled — every convoy is exposed.",
  },
  contested: {
    key: "contested",
    name: "Contested",
    description: "Vault capture progress decays when holder leaves proximity.",
  },
  shield_escort: {
    key: "shield_escort",
    name: "Shielded Run",
    description: "All launched convoys start with 2 escort shields.",
  },
  rally_point: {
    key: "rally_point",
    name: "Rally Point",
    description:
      "Passive vault income doubled; vault captures grant extra troops.",
  },
  execution_rush: {
    key: "execution_rush",
    name: "Execution Rush",
    description:
      "Chain window doubled; clean execution convoy multiplier ×1.5.",
  },
};

const ROTATION_KEYS = [
  "lane_fog",
  "accelerated_cooldowns",
  "double_passive",
  "gold_rush",
  "blitz",
  "no_mercy",
  "contested",
  "shield_escort",
  "rally_point",
  "execution_rush",
] as const;

export type ElectionSource =
  | "community-vote"
  | "deterministic-no-vote"
  | "deterministic-tie"
  | "deterministic-schedule"
  | "deterministic-persistence-failure";

export interface MutatorElectionOutcome {
  effectiveWeek: number;
  selectedKey: string;
  source: ElectionSource;
  durability: "postgres" | "process-local" | "runtime-only";
  winningVotes: number;
  totalVotes: number;
  decidedAt: string;
  receiptDigest: string;
}

export interface SeasonStatus {
  currentMutator: { key: string; name: string; description: string };
  selection: MutatorElectionOutcome;
  weekNumber: number;
  effectiveWeek: number;
  mutatorEndsAt: number;
  vote: {
    open: boolean;
    candidates: Array<{ key: string; name: string }>;
    closesAt: number | null;
    effectiveWeek: number;
  } | null;
  voteStandings: Array<{ key: string; name: string; votes: number }>;
}

export interface MutatorVoteReceipt {
  accepted: boolean;
  reason:
    | "accepted"
    | "vote-closed"
    | "invalid-candidate"
    | "duplicate-actor"
    | "persistence-unavailable";
  candidateKey: string;
  effectiveWeek: number | null;
  durability: "postgres" | "process-local" | "none";
  receiptDigest: string;
}

interface VoteState {
  ballotWeek: number;
  effectiveWeek: number;
  candidates: string[];
  votes: Map<string, number>;
  voters: Set<string>;
  openUntil: number;
  announced: boolean;
}

interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

interface SeasonDatabase {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface VaultSeasonSchedulerDependencies {
  now: () => Date;
  database: () => SeasonDatabase | null;
  notifier: Pick<
    typeof DiscordNotifier,
    "weeklyMutatorAnnounced" | "weeklyVoteOpened" | "voteResultPosted"
  >;
  stats: Pick<
    typeof playerStatsStore,
    "seasonalSoftReset" | "getTopRatedPlayer" | "awardDynasty"
  >;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

const defaultDependencies: VaultSeasonSchedulerDependencies = {
  now: () => new Date(),
  database: () => pool as SeasonDatabase | null,
  notifier: DiscordNotifier,
  stats: playerStatsStore,
  setInterval,
  clearInterval,
};

export function utcWeekNumber(now: Date): number {
  return Math.floor(
    (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / WEEK_MS,
  );
}

export function seasonWeekId(now: Date): number {
  return now.getUTCFullYear() * 100 + utcWeekNumber(now);
}

function mutatorKeyForWeek(weekNum: number): string {
  return ROTATION_KEYS[weekNum % ROTATION_KEYS.length];
}

function candidatesForWeek(weekNum: number): string[] {
  const offset = weekNum % ROTATION_KEYS.length;
  return [
    ROTATION_KEYS[offset],
    ROTATION_KEYS[(offset + 1) % ROTATION_KEYS.length],
    ROTATION_KEYS[(offset + 2) % ROTATION_KEYS.length],
  ];
}

function nextMondayUtcMs(now: Date): number {
  const daysUntilMonday = now.getUTCDay() === 0 ? 1 : 8 - now.getUTCDay();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilMonday,
  );
}

function thisSundayNoonUtcMs(now: Date): number {
  const daysUntilSunday = now.getUTCDay() === 0 ? 0 : 7 - now.getUTCDay();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilSunday,
    12,
  );
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function finalizeOutcome(
  outcome: Omit<MutatorElectionOutcome, "receiptDigest">,
): MutatorElectionOutcome {
  return { ...outcome, receiptDigest: sha256(outcome) };
}

export function verifyMutatorElectionOutcome(
  outcome: MutatorElectionOutcome,
): boolean {
  const { receiptDigest, ...payload } = outcome;
  return receiptDigest === sha256(payload);
}

export class VaultSeasonScheduler {
  private lastAnnouncedWeek: number | null = null;
  private currentVote: VoteState | null = null;
  private readonly outcomes = new Map<number, MutatorElectionOutcome>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  public constructor(
    private readonly dependencies: VaultSeasonSchedulerDependencies = defaultDependencies,
  ) {}

  public async start(): Promise<void> {
    log.info("VaultSeasonScheduler starting");
    const now = this.dependencies.now();
    await this.loadOutcomesFromDb(now);
    await this.recoverCurrentOutcome(now);
    await this.tick(now);
    this.intervalHandle = this.dependencies.setInterval(
      () => {
        void this.tick().catch((error) =>
          log.error("season scheduler tick failed", { err: String(error) }),
        );
      },
      60 * 60 * 1000,
    );
  }

  public stop(): void {
    if (this.intervalHandle !== null) {
      this.dependencies.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  public async tick(now = this.dependencies.now()): Promise<void> {
    await this.maybeCloseVote(now);
    const weekNum = utcWeekNumber(now);
    const selection = this.selectionFor(now);
    if (this.lastAnnouncedWeek !== seasonWeekId(now)) {
      const mutator = MUTATOR_DEFS[selection.selectedKey];
      log.info(
        `New week ${seasonWeekId(now)}: mutator=${selection.selectedKey}`,
        {
          source: selection.source,
          receiptDigest: selection.receiptDigest,
        },
      );
      if (mutator) {
        this.dependencies.notifier.weeklyMutatorAnnounced(
          mutator.name,
          mutator.description,
          weekNum,
        );
      }
      this.lastAnnouncedWeek = seasonWeekId(now);
    }
    await this.maybeOpenVote(now);
  }

  private async maybeOpenVote(now: Date): Promise<void> {
    if (now.getUTCDay() !== 0) return;
    const openAt = thisSundayNoonUtcMs(now);
    const closeAt = nextMondayUtcMs(now);
    if (now.getTime() < openAt || now.getTime() >= closeAt) return;
    if (this.currentVote?.openUntil === closeAt) return;
    const effectiveDate = new Date(closeAt + 1);
    const effectiveWeek = seasonWeekId(effectiveDate);
    const candidates = candidatesForWeek(utcWeekNumber(effectiveDate));
    this.currentVote = {
      ballotWeek: seasonWeekId(now),
      effectiveWeek,
      candidates,
      votes: new Map(candidates.map((candidate) => [candidate, 0])),
      voters: new Set(),
      openUntil: closeAt,
      announced: false,
    };
    await this.loadVotesFromDb();
    this.openWeeklyVote();
  }

  private chooseOutcome(
    vote: VoteState,
    decidedAt: Date,
  ): Omit<MutatorElectionOutcome, "receiptDigest"> {
    const scheduled = mutatorKeyForWeek(utcWeekNumber(decidedAt));
    const totalVotes = [...vote.votes.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    const highest = Math.max(...vote.votes.values());
    const leaders = [...vote.votes.entries()]
      .filter(([, count]) => count === highest)
      .map(([key]) => key)
      .sort();
    const noVote = totalVotes === 0;
    const tie = !noVote && leaders.length > 1;
    const selectedKey = noVote
      ? scheduled
      : tie
        ? leaders.includes(scheduled)
          ? scheduled
          : leaders[0]
        : leaders[0];
    return {
      effectiveWeek: vote.effectiveWeek,
      selectedKey,
      source: noVote
        ? "deterministic-no-vote"
        : tie
          ? "deterministic-tie"
          : "community-vote",
      durability: this.dependencies.database() ? "postgres" : "process-local",
      winningVotes: noVote ? 0 : highest,
      totalVotes,
      decidedAt: decidedAt.toISOString(),
    };
  }

  private async persistOutcome(
    candidate: Omit<MutatorElectionOutcome, "receiptDigest">,
  ): Promise<{ outcome: MutatorElectionOutcome; committed: boolean }> {
    const database = this.dependencies.database();
    if (!database) {
      const outcome = finalizeOutcome(candidate);
      this.outcomes.set(outcome.effectiveWeek, outcome);
      return { outcome, committed: true };
    }
    const outcome = finalizeOutcome({ ...candidate, durability: "postgres" });
    try {
      const inserted = await database.query<{
        effective_week: number;
        selected_key: string;
        source: ElectionSource;
        durability: "postgres";
        winning_votes: number;
        total_votes: number;
        decided_at: Date | string;
        receipt_digest: string;
      }>(
        `INSERT INTO season_mutator_outcomes
          (effective_week, selected_key, source, durability, winning_votes, total_votes, decided_at, receipt_digest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (effective_week) DO NOTHING
         RETURNING *`,
        [
          outcome.effectiveWeek,
          outcome.selectedKey,
          outcome.source,
          outcome.durability,
          outcome.winningVotes,
          outcome.totalVotes,
          outcome.decidedAt,
          outcome.receiptDigest,
        ],
      );
      if ((inserted.rowCount ?? inserted.rows.length) > 0) {
        this.outcomes.set(outcome.effectiveWeek, outcome);
        return { outcome, committed: true };
      }
      const existing = await database.query<{
        effective_week: number;
        selected_key: string;
        source: ElectionSource;
        durability: "postgres";
        winning_votes: number;
        total_votes: number;
        decided_at: Date | string;
        receipt_digest: string;
      }>("SELECT * FROM season_mutator_outcomes WHERE effective_week = $1", [
        outcome.effectiveWeek,
      ]);
      const restored = this.rowToOutcome(existing.rows[0]);
      if (!restored || !verifyMutatorElectionOutcome(restored))
        throw new Error(
          "persisted election outcome failed digest verification",
        );
      this.outcomes.set(restored.effectiveWeek, restored);
      return { outcome: restored, committed: false };
    } catch (error) {
      log.error("Failed to persist mutator election outcome", {
        err: String(error),
      });
      const fallback = finalizeOutcome({
        ...candidate,
        selectedKey: mutatorKeyForWeek(
          utcWeekNumber(new Date(candidate.decidedAt)),
        ),
        source: "deterministic-persistence-failure",
        durability: "runtime-only",
        winningVotes: 0,
      });
      this.outcomes.set(fallback.effectiveWeek, fallback);
      return { outcome: fallback, committed: false };
    }
  }

  private async maybeCloseVote(now: Date): Promise<void> {
    const vote = this.currentVote;
    if (!vote || now.getTime() < vote.openUntil) return;
    const { outcome, committed } = await this.persistOutcome(
      this.chooseOutcome(vote, now),
    );
    this.currentVote = null;
    if (!committed) return;
    const winner = MUTATOR_DEFS[outcome.selectedKey];
    if (winner)
      this.dependencies.notifier.voteResultPosted(
        winner.name,
        outcome.winningVotes,
        outcome.totalVotes,
      );
    void this.dependencies.stats
      .seasonalSoftReset()
      .catch((error) =>
        log.error("seasonalSoftReset failed", { err: String(error) }),
      );
    void this.dependencies.stats.getTopRatedPlayer().then(async (top) => {
      if (!top) return;
      const emblems = ["👑", "🔱", "⚡", "🌑", "🔥", "💠"];
      const emblem = emblems[utcWeekNumber(now) % emblems.length];
      await this.dependencies.stats.awardDynasty(top.persistentId, emblem);
    });
  }

  private openWeeklyVote(): void {
    if (!this.currentVote || this.currentVote.announced) return;
    const candidates = this.currentVote.candidates.map((key) => ({
      key,
      name: MUTATOR_DEFS[key]?.name ?? key,
    }));
    this.dependencies.notifier.weeklyVoteOpened(
      candidates,
      new Date(this.currentVote.openUntil),
    );
    this.currentVote.announced = true;
  }

  public async recordVote(
    candidateKey: string,
    actorId: string,
  ): Promise<MutatorVoteReceipt> {
    const vote = this.currentVote;
    const now = this.dependencies.now();
    const makeReceipt = (
      accepted: boolean,
      reason: MutatorVoteReceipt["reason"],
      durability: MutatorVoteReceipt["durability"],
    ): MutatorVoteReceipt => {
      const payload = {
        accepted,
        reason,
        candidateKey,
        effectiveWeek: vote?.effectiveWeek ?? null,
        durability,
        actorDigest: sha256(`actor:${actorId}`),
      };
      return { ...payload, receiptDigest: sha256(payload) };
    };
    if (!vote || now.getTime() >= vote.openUntil)
      return makeReceipt(false, "vote-closed", "none");
    if (!vote.candidates.includes(candidateKey))
      return makeReceipt(false, "invalid-candidate", "none");
    if (vote.voters.has(actorId))
      return makeReceipt(
        false,
        "duplicate-actor",
        this.dependencies.database() ? "postgres" : "process-local",
      );

    const database = this.dependencies.database();
    if (database) {
      try {
        const inserted = await database.query<{ candidate_key: string }>(
          `INSERT INTO season_votes (week_number, voter_id, candidate_key)
           VALUES ($1, $2, $3)
           ON CONFLICT (week_number, voter_id) DO NOTHING
           RETURNING candidate_key`,
          [vote.ballotWeek, actorId, candidateKey],
        );
        if ((inserted.rowCount ?? inserted.rows.length) === 0) {
          vote.voters.add(actorId);
          return makeReceipt(false, "duplicate-actor", "postgres");
        }
      } catch (error) {
        log.error("Failed to persist season vote", {
          candidateKey,
          err: String(error),
        });
        return makeReceipt(false, "persistence-unavailable", "none");
      }
    }
    vote.voters.add(actorId);
    vote.votes.set(candidateKey, (vote.votes.get(candidateKey) ?? 0) + 1);
    return makeReceipt(
      true,
      "accepted",
      database ? "postgres" : "process-local",
    );
  }

  private async loadVotesFromDb(): Promise<void> {
    const database = this.dependencies.database();
    const vote = this.currentVote;
    if (!database || !vote) return;
    try {
      const result = await database.query<{
        candidate_key: string;
        voter_id: string;
      }>(
        "SELECT candidate_key, voter_id FROM season_votes WHERE week_number = $1",
        [vote.ballotWeek],
      );
      vote.votes = new Map(vote.candidates.map((candidate) => [candidate, 0]));
      vote.voters.clear();
      for (const row of result.rows) {
        if (!vote.candidates.includes(row.candidate_key)) continue;
        vote.voters.add(row.voter_id);
        vote.votes.set(
          row.candidate_key,
          (vote.votes.get(row.candidate_key) ?? 0) + 1,
        );
      }
    } catch (error) {
      log.error("Failed to load season votes from DB", { err: String(error) });
    }
  }

  private rowToOutcome(row: any): MutatorElectionOutcome | null {
    if (!row) return null;
    return {
      effectiveWeek: Number(row.effective_week),
      selectedKey: String(row.selected_key),
      source: row.source,
      durability: row.durability,
      winningVotes: Number(row.winning_votes),
      totalVotes: Number(row.total_votes),
      decidedAt: new Date(row.decided_at).toISOString(),
      receiptDigest: String(row.receipt_digest),
    };
  }

  private async loadOutcomesFromDb(now: Date): Promise<void> {
    const database = this.dependencies.database();
    if (!database) return;
    try {
      const result = await database.query(
        "SELECT * FROM season_mutator_outcomes WHERE effective_week >= $1 ORDER BY effective_week",
        [seasonWeekId(new Date(now.getTime() - WEEK_MS))],
      );
      for (const row of result.rows) {
        const outcome = this.rowToOutcome(row);
        if (outcome && verifyMutatorElectionOutcome(outcome))
          this.outcomes.set(outcome.effectiveWeek, outcome);
        else log.error("Rejected tampered mutator election outcome");
      }
    } catch (error) {
      log.error("Failed to load mutator election outcomes", {
        err: String(error),
      });
    }
  }

  private async recoverCurrentOutcome(now: Date): Promise<void> {
    const effectiveWeek = seasonWeekId(now);
    const database = this.dependencies.database();
    if (!database || this.outcomes.has(effectiveWeek)) return;
    const priorDate = new Date(now.getTime() - WEEK_MS);
    try {
      const result = await database.query<{
        candidate_key: string;
        voter_id: string;
      }>(
        "SELECT candidate_key, voter_id FROM season_votes WHERE week_number = $1",
        [seasonWeekId(priorDate)],
      );
      const candidates = candidatesForWeek(utcWeekNumber(now));
      const vote: VoteState = {
        ballotWeek: seasonWeekId(priorDate),
        effectiveWeek,
        candidates,
        votes: new Map(candidates.map((candidate) => [candidate, 0])),
        voters: new Set(),
        openUntil: now.getTime(),
        announced: true,
      };
      for (const row of result.rows) {
        if (
          !candidates.includes(row.candidate_key) ||
          vote.voters.has(row.voter_id)
        )
          continue;
        vote.voters.add(row.voter_id);
        vote.votes.set(
          row.candidate_key,
          (vote.votes.get(row.candidate_key) ?? 0) + 1,
        );
      }
      await this.persistOutcome(this.chooseOutcome(vote, now));
    } catch (error) {
      log.error("Failed to recover current mutator outcome", {
        err: String(error),
      });
    }
  }

  private selectionFor(now: Date): MutatorElectionOutcome {
    const effectiveWeek = seasonWeekId(now);
    const persisted = this.outcomes.get(effectiveWeek);
    if (persisted) return persisted;
    return finalizeOutcome({
      effectiveWeek,
      selectedKey: mutatorKeyForWeek(utcWeekNumber(now)),
      source: "deterministic-schedule",
      durability: "runtime-only",
      winningVotes: 0,
      totalVotes: 0,
      decidedAt: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      ).toISOString(),
    });
  }

  public getStatus(now = this.dependencies.now()): SeasonStatus {
    const selection = this.selectionFor(now);
    const mutator = MUTATOR_DEFS[selection.selectedKey] ?? MUTATOR_DEFS.none;
    const voteOpen =
      this.currentVote && now.getTime() < this.currentVote.openUntil;
    return {
      currentMutator: {
        key: mutator.key,
        name: mutator.name,
        description: mutator.description,
      },
      selection,
      weekNumber: utcWeekNumber(now),
      effectiveWeek: seasonWeekId(now),
      mutatorEndsAt: nextMondayUtcMs(now),
      vote:
        voteOpen && this.currentVote
          ? {
              open: true,
              candidates: this.currentVote.candidates.map((key) => ({
                key,
                name: MUTATOR_DEFS[key]?.name ?? key,
              })),
              closesAt: this.currentVote.openUntil,
              effectiveWeek: this.currentVote.effectiveWeek,
            }
          : null,
      voteStandings:
        voteOpen && this.currentVote
          ? [...this.currentVote.votes.entries()]
              .map(([key, votes]) => ({
                key,
                name: MUTATOR_DEFS[key]?.name ?? key,
                votes,
              }))
              .sort((a, b) => b.votes - a.votes || a.key.localeCompare(b.key))
          : [],
    };
  }
}

export const vaultSeasonScheduler = new VaultSeasonScheduler();
