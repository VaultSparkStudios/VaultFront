import { createHash, timingSafeEqual } from "node:crypto";
import { achievementStore, type AchievementEvent } from "./AchievementStore";
import {
  certifiedDailyMasteryStore,
  type DailyMasteryCompletionReceipt,
} from "./CertifiedDailyMasteryStore";
import {
  certifiedLoopEvidenceStore,
  type CertifiedLoopEvidenceReceipt,
  type LoopIntentFunnel,
} from "./CertifiedLoopEvidenceStore";
import {
  certifiedOutcomeStore,
  type CertifiedOutcomeReceipt,
} from "./CertifiedOutcomeStore";
import {
  certifiedSeasonContractStore,
  type CertifiedSeasonContractState,
} from "./CertifiedSeasonContractStore";
import { logger } from "./Logger";
import type { PlayerStats } from "./PlayerStatsStore";
import { playerStatsStore } from "./PlayerStatsStore";
import { predictionLeagueStore } from "./PredictionLeagueStore";
import { progressionReceiptStore } from "./ProgressionReceiptStore";
import {
  seasonMilestoneStore,
  type CertifiedSeasonPassState,
} from "./SeasonMilestoneStore";

const log = logger.child({ comp: "MatchProgression" });

export interface AuthoritativePlayerOutcome {
  persistentId: string;
  displayName: string;
  won: boolean;
  vaultCaptures: number;
  convoyDeliveries: number;
  convoyIntercepts: number;
  convoysLost: number;
  executionChains: number;
  surgeActivations: number;
  firstVaultCaptureTick?: number;
  firstConvoyOutcomeTick?: number;
  firstVaultPressureTick?: number;
  firstBreachOpenTick?: number;
  decisiveDeliveryTick?: number;
  vaultBreachVictoryTick?: number;
  behindAtMinute8?: boolean;
  conquests?: number;
  passivePayouts?: number;
  betrayals?: number;
  jamBreakerUses?: number;
  convoyEscortCommands?: number;
  defenseFactoryTicks?: number;
  vaultPressureContributions?: number;
}

export interface AuthoritativeMatchOutcome {
  gameId: string;
  durationSeconds: number;
  turnIntervalMs: number;
  mapName: string;
  seasonId: string;
  onMutator: boolean;
  intentFunnel: LoopIntentFunnel;
  players: AuthoritativePlayerOutcome[];
}

export interface ProgressionReceipt {
  gameId: string;
  recordedAt: string;
  durability: "postgres" | "process-local";
  duplicate: boolean;
  playersRecorded: number;
  achievementsUnlocked: number;
  predictionOutcome: "intercept" | "delivery";
  predictionsResolved: number;
  dailyMastery: DailyMasteryCompletionReceipt[];
  seasonContracts: CertifiedSeasonContractState[];
  seasonPass: CertifiedSeasonPassState[];
  loopEvidence: CertifiedLoopEvidenceReceipt | null;
  certifiedOutcomes: CertifiedOutcomeReceipt | null;
  players: PlayerProgressionDividend[];
  /** Digest of the completed fan-out, stable across duplicate observations. */
  receiptDigest: string;
}

export interface PlayerProgressionSnapshot {
  eloRating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  vaultCaptures: number;
  convoyDeliveries: number;
  executionChains: number;
}

export interface PlayerProgressionDividend {
  persistentId: string;
  before: PlayerProgressionSnapshot | null;
  after: PlayerProgressionSnapshot | null;
  delta: PlayerProgressionSnapshot;
  achievementsUnlocked: string[];
  dailyMastery: DailyMasteryCompletionReceipt | null;
  seasonContracts: CertifiedSeasonContractState | null;
  seasonPass: CertifiedSeasonPassState | null;
  match: {
    vaultPressureContributions: number;
    vaultCaptures: number;
    convoyDeliveries: number;
    executionChains: number;
    won: boolean;
  };
}

interface ProgressionDependencies {
  recordMatch: typeof playerStatsStore.recordMatch;
  getPlayerStats: (persistentId: string) => Promise<PlayerStats | null>;
  checkAndUnlock: typeof achievementStore.checkAndUnlock;
  recordSeasonPass: typeof seasonMilestoneStore.recordCertifiedMatch;
  resolvePrediction: typeof predictionLeagueStore.resolveGame;
  recordDailyMastery: typeof certifiedDailyMasteryStore.recordCertifiedMatch;
  recordSeasonContracts: typeof certifiedSeasonContractStore.recordCertifiedMatch;
  recordLoopEvidence: typeof certifiedLoopEvidenceStore.recordCertifiedMatch;
  recordCertifiedOutcomes: typeof certifiedOutcomeStore.recordMatch;
  loadReceipt: (gameId: string) => Promise<ProgressionReceipt | null>;
  persistReceipt: (
    receipt: ProgressionReceipt,
    actorIds: string[],
  ) => Promise<void>;
  receiptDurability: () => "postgres" | "process-local";
  now: () => Date;
}

const defaultDependencies: ProgressionDependencies = {
  recordMatch: playerStatsStore.recordMatch.bind(playerStatsStore),
  getPlayerStats: playerStatsStore.getPlayerStats.bind(playerStatsStore),
  checkAndUnlock: achievementStore.checkAndUnlock.bind(achievementStore),
  recordSeasonPass:
    seasonMilestoneStore.recordCertifiedMatch.bind(seasonMilestoneStore),
  resolvePrediction: predictionLeagueStore.resolveGame.bind(
    predictionLeagueStore,
  ),
  recordDailyMastery: certifiedDailyMasteryStore.recordCertifiedMatch.bind(
    certifiedDailyMasteryStore,
  ),
  recordSeasonContracts: certifiedSeasonContractStore.recordCertifiedMatch.bind(
    certifiedSeasonContractStore,
  ),
  recordLoopEvidence: certifiedLoopEvidenceStore.recordCertifiedMatch.bind(
    certifiedLoopEvidenceStore,
  ),
  recordCertifiedOutcomes: certifiedOutcomeStore.recordMatch.bind(
    certifiedOutcomeStore,
  ),
  loadReceipt: progressionReceiptStore.get.bind(progressionReceiptStore),
  persistReceipt: progressionReceiptStore.put.bind(progressionReceiptStore),
  receiptDurability: progressionReceiptStore.durability.bind(
    progressionReceiptStore,
  ),
  now: () => new Date(),
};

function progressionSnapshot(
  stats: PlayerStats | null,
): PlayerProgressionSnapshot | null {
  if (!stats) return null;
  return {
    eloRating: stats.eloRating,
    matchesPlayed: stats.matchesPlayed,
    wins: stats.wins,
    losses: stats.losses,
    vaultCaptures: stats.vaultCaptures,
    convoyDeliveries: stats.convoyDeliveries,
    executionChains: stats.executionChains,
  };
}

function progressionDelta(
  before: PlayerProgressionSnapshot | null,
  after: PlayerProgressionSnapshot | null,
): PlayerProgressionSnapshot {
  const baseline: PlayerProgressionSnapshot = {
    eloRating: 1200,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    vaultCaptures: 0,
    convoyDeliveries: 0,
    executionChains: 0,
  };
  const left = before ?? baseline;
  const right = after ?? left;
  return Object.fromEntries(
    Object.keys(baseline).map((key) => [
      key,
      right[key as keyof PlayerProgressionSnapshot] -
        left[key as keyof PlayerProgressionSnapshot],
    ]),
  ) as unknown as PlayerProgressionSnapshot;
}

export function derivePredictionOutcome(
  players: AuthoritativePlayerOutcome[],
): "intercept" | "delivery" {
  const deliveries = players.reduce(
    (total, player) => total + player.convoyDeliveries,
    0,
  );
  const intercepts = players.reduce(
    (total, player) => total + player.convoyIntercepts,
    0,
  );
  // A tie resolves toward delivery: the convoy survived at least as often as
  // it was stopped. This stable rule also makes empty telemetry deterministic.
  return deliveries >= intercepts ? "delivery" : "intercept";
}

function digestProgressionReceipt(
  receipt: Omit<ProgressionReceipt, "receiptDigest">,
): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        gameId: receipt.gameId,
        recordedAt: receipt.recordedAt,
        durability: receipt.durability,
        playersRecorded: receipt.playersRecorded,
        achievementsUnlocked: receipt.achievementsUnlocked,
        predictionOutcome: receipt.predictionOutcome,
        predictionsResolved: receipt.predictionsResolved,
        dailyMastery: receipt.dailyMastery,
        seasonContracts: receipt.seasonContracts,
        seasonPass: receipt.seasonPass,
        loopEvidence: receipt.loopEvidence,
        certifiedOutcomes: receipt.certifiedOutcomes,
        players: receipt.players,
      }),
    )
    .digest("hex")}`;
}

/** Verify a completed receipt without trusting the producer that supplied it. */
export function verifyProgressionReceipt(receipt: ProgressionReceipt): boolean {
  if (
    receipt.duplicate ||
    !/^sha256:[a-f0-9]{64}$/.test(receipt.receiptDigest)
  ) {
    return false;
  }
  const { receiptDigest, ...payload } = receipt;
  const expected = digestProgressionReceipt(payload);
  return timingSafeEqual(Buffer.from(receiptDigest), Buffer.from(expected));
}

function finalizeProgressionReceipt(
  receipt: Omit<ProgressionReceipt, "receiptDigest">,
): ProgressionReceipt {
  return { ...receipt, receiptDigest: digestProgressionReceipt(receipt) };
}

/**
 * One authoritative match envelope fans into Elo/history, achievements, and
 * season milestones. The idempotency set intentionally claims only
 * process-lifetime safety: this does not pretend to be a durable event ledger.
 */
export class ServerAuthoritativeProgressionSpine {
  private readonly completed = new Map<string, ProgressionReceipt>();
  private readonly inFlight = new Map<string, Promise<ProgressionReceipt>>();
  private readonly dependencies: ProgressionDependencies;

  constructor(dependencies: Partial<ProgressionDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async record(
    outcome: AuthoritativeMatchOutcome,
  ): Promise<ProgressionReceipt> {
    const completed = this.completed.get(outcome.gameId);
    if (completed) return this.duplicateReceipt(completed);

    const concurrent = this.inFlight.get(outcome.gameId);
    if (concurrent) {
      return this.duplicateReceipt(await concurrent);
    }

    const stored = await this.dependencies.loadReceipt(outcome.gameId);
    if (stored && verifyProgressionReceipt(stored)) {
      this.completed.set(outcome.gameId, stored);
      return this.duplicateReceipt(stored);
    }
    const raced = this.inFlight.get(outcome.gameId);
    if (raced) return this.duplicateReceipt(await raced);

    const attempt = this.recordOnce(outcome);
    this.inFlight.set(outcome.gameId, attempt);
    try {
      const receipt = await attempt;
      this.completed.set(outcome.gameId, receipt);
      return receipt;
    } finally {
      // A failed attempt deliberately releases the claim. Every downstream
      // store owns idempotency, so the same certified envelope can safely
      // resume instead of becoming permanently suppressed.
      this.inFlight.delete(outcome.gameId);
    }
  }

  private duplicateReceipt(completed: ProgressionReceipt): ProgressionReceipt {
    return {
      ...completed,
      duplicate: true,
      playersRecorded: 0,
      achievementsUnlocked: 0,
      predictionsResolved: 0,
      dailyMastery: [],
      seasonContracts: [],
      seasonPass: [],
      loopEvidence: null,
      certifiedOutcomes: null,
      players: [],
    };
  }

  private async recordOnce(
    outcome: AuthoritativeMatchOutcome,
  ): Promise<ProgressionReceipt> {
    const beforeByPersistentId = new Map(
      await Promise.all(
        outcome.players.map(
          async (player) =>
            [
              player.persistentId,
              progressionSnapshot(
                await this.dependencies.getPlayerStats(player.persistentId),
              ),
            ] as const,
        ),
      ),
    );
    const predictionOutcome = derivePredictionOutcome(outcome.players);
    const predictionReceipt = await this.dependencies.resolvePrediction(
      outcome.gameId,
      predictionOutcome,
    );
    if (outcome.players.length === 0) {
      const certifiedOutcomes =
        await this.dependencies.recordCertifiedOutcomes(outcome);
      const loopEvidence = await this.dependencies.recordLoopEvidence(outcome);
      const receipt = finalizeProgressionReceipt({
        gameId: outcome.gameId,
        recordedAt: this.dependencies.now().toISOString(),
        durability: this.dependencies.receiptDurability(),
        duplicate: false,
        playersRecorded: 0,
        achievementsUnlocked: 0,
        predictionOutcome,
        predictionsResolved: predictionReceipt.resolvedPredictions,
        dailyMastery: [],
        seasonContracts: [],
        seasonPass: [],
        loopEvidence,
        certifiedOutcomes,
        players: [],
      });
      await this.dependencies.persistReceipt(receipt, []);
      return receipt;
    }

    const allPlayers = outcome.players.map((player) => ({
      persistentId: player.persistentId,
      displayName: player.displayName,
      won: player.won,
    }));
    const statsByPersistentId = Object.fromEntries(
      outcome.players.map((player) => [
        player.persistentId,
        {
          vaultCaptures: player.vaultCaptures,
          convoyDeliveries: player.convoyDeliveries,
          executionChains: player.executionChains,
        },
      ]),
    );
    const subject = outcome.players[0];

    await this.dependencies.recordMatch(
      subject.persistentId,
      subject.displayName,
      outcome.gameId,
      {
        won: subject.won,
        durationSeconds: outcome.durationSeconds,
        vaultCaptures: subject.vaultCaptures,
        convoyDeliveries: subject.convoyDeliveries,
        executionChains: subject.executionChains,
        mapName: outcome.mapName,
        playerCount: outcome.players.length,
        allPlayers,
        statsByPersistentId,
      },
    );
    const certifiedOutcomes =
      await this.dependencies.recordCertifiedOutcomes(outcome);

    let achievementsUnlocked = 0;
    const dailyMastery: DailyMasteryCompletionReceipt[] = [];
    const seasonContracts: CertifiedSeasonContractState[] = [];
    const seasonPass: CertifiedSeasonPassState[] = [];
    const playerDividends: PlayerProgressionDividend[] = [];
    for (const player of outcome.players) {
      const aggregate = await this.dependencies.getPlayerStats(
        player.persistentId,
      );
      const events: AchievementEvent[] = [];
      if (player.vaultCaptures > 0) {
        events.push({ type: "vault_captured", count: player.vaultCaptures });
      }
      if (player.convoyDeliveries > 0) {
        events.push({
          type: "convoy_delivered",
          totalCount: aggregate?.convoyDeliveries ?? player.convoyDeliveries,
        });
      }
      if (player.executionChains > 0) {
        events.push({
          type: "execution_chain",
          matchCount: player.executionChains,
        });
      }
      if (player.surgeActivations > 0) {
        events.push({ type: "surge_activated" });
      }
      events.push({
        type: "match_played",
        totalMatches: aggregate?.matchesPlayed ?? 1,
      });
      events.push({
        type: "match_ended",
        won: player.won,
        durationSeconds: outcome.durationSeconds,
        onMutator: outcome.onMutator,
        eloRating: aggregate?.eloRating ?? 1200,
      });

      let playerUnlocks = 0;
      const playerUnlockKeys: string[] = [];
      for (const event of events) {
        const unlocked = await this.dependencies.checkAndUnlock(
          player.persistentId,
          event,
        );
        playerUnlocks += unlocked.length;
        playerUnlockKeys.push(
          ...unlocked.map((achievement: any) =>
            String(
              achievement.id ??
                achievement.key ??
                achievement.title ??
                "achievement",
            ),
          ),
        );
      }
      achievementsUnlocked += playerUnlocks;

      const passReceipt = await this.dependencies.recordSeasonPass(
        outcome.gameId,
        outcome.seasonId,
        {
          persistentId: player.persistentId,
          vaultCaptures: player.vaultCaptures,
          convoyDeliveries: player.convoyDeliveries,
          executionChains: player.executionChains,
          achievementsUnlocked: playerUnlocks,
        },
      );
      if (passReceipt) seasonPass.push(passReceipt);
      const masteryReceipt = await this.dependencies.recordDailyMastery(
        outcome.gameId,
        player,
      );
      if (masteryReceipt) {
        dailyMastery.push(masteryReceipt);
      }
      const seasonReceipt = await this.dependencies.recordSeasonContracts(
        outcome.gameId,
        outcome.seasonId,
        player,
      );
      if (seasonReceipt) {
        seasonContracts.push(seasonReceipt);
      }
      const before = beforeByPersistentId.get(player.persistentId) ?? null;
      const after = progressionSnapshot(aggregate);
      playerDividends.push({
        persistentId: player.persistentId,
        before,
        after,
        delta: progressionDelta(before, after),
        achievementsUnlocked: [...new Set(playerUnlockKeys)].sort(),
        dailyMastery: masteryReceipt ?? null,
        seasonContracts: seasonReceipt ?? null,
        seasonPass: passReceipt ?? null,
        match: {
          vaultPressureContributions: player.vaultPressureContributions ?? 0,
          vaultCaptures: player.vaultCaptures,
          convoyDeliveries: player.convoyDeliveries,
          executionChains: player.executionChains,
          won: player.won,
        },
      });
    }

    const loopEvidence = await this.dependencies.recordLoopEvidence(outcome);

    const receipt = finalizeProgressionReceipt({
      gameId: outcome.gameId,
      recordedAt: this.dependencies.now().toISOString(),
      durability: this.dependencies.receiptDurability(),
      duplicate: false,
      playersRecorded: outcome.players.length,
      achievementsUnlocked,
      predictionOutcome,
      predictionsResolved: predictionReceipt.resolvedPredictions,
      dailyMastery,
      seasonContracts,
      seasonPass,
      loopEvidence,
      certifiedOutcomes,
      players: playerDividends,
    });
    await this.dependencies.persistReceipt(
      receipt,
      outcome.players.map((player) => player.persistentId),
    );
    log.info("authoritative progression recorded", {
      gameId: receipt.gameId,
      playersRecorded: receipt.playersRecorded,
      durability: receipt.durability,
      receiptDigest: receipt.receiptDigest,
    });
    return receipt;
  }
}

export const matchProgressionSpine = new ServerAuthoritativeProgressionSpine();
