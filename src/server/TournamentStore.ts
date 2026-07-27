/**
 * TournamentStore — manages tournament registration, bracket seeding, and
 * match result reporting.
 *
 * Bracket format: single-elimination.
 *   - Players are seeded by Elo (highest vs lowest pairing).
 *   - Byes are assigned to top seeds when player count is not a power of 2.
 *   - Winners advance; the bracket is updated after each result.
 *
 * Dual-path: in-memory + Postgres when DATABASE_URL is set.
 */

import { nanoid } from "nanoid";
import { pool } from "./db/pool";

export type TournamentStatus = "registration" | "active" | "complete";
export type MatchStatus = "pending" | "active" | "complete";

export interface Tournament {
  id: string;
  name: string;
  mapName: string;
  maxPlayers: number;
  status: TournamentStatus;
  createdBy: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TournamentSlot {
  tournamentId: string;
  persistentId: string;
  seed: number;
  eloAtEntry: number;
}

export interface TournamentMatch {
  id: number;
  tournamentId: string;
  round: number;
  matchIndex: number;
  playerA: string | null;
  playerB: string | null;
  winnerId: string | null;
  gameId: string | null;
  certificateId: string | null;
  status: MatchStatus;
}

export interface BracketView {
  tournament: Tournament;
  rounds: TournamentMatch[][];
  slots: TournamentSlot[];
  operations: TournamentOperationsBrief;
}

export interface TournamentOperationsBrief {
  status: TournamentStatus;
  registeredPlayers: number;
  missingSlots: number;
  nextAction: string;
  nextMatchId: number | null;
  overlayUrl: string;
}

class TournamentStore {
  private tournaments = new Map<string, Tournament>();
  private slots = new Map<string, TournamentSlot[]>(); // tournamentId → slots
  private matches = new Map<string, TournamentMatch[]>(); // tournamentId → matches
  private nextMatchId = 1;

  // ── Create ──────────────────────────────────────────────────────────────

  async create(opts: {
    name: string;
    mapName?: string;
    maxPlayers?: number;
    createdBy: string;
  }): Promise<Tournament> {
    const id = nanoid(12);
    const t: Tournament = {
      id,
      name: opts.name,
      mapName: opts.mapName ?? "",
      maxPlayers: opts.maxPlayers ?? 8,
      status: "registration",
      createdBy: opts.createdBy,
      createdAt: Date.now(),
    };
    this.tournaments.set(id, t);
    this.slots.set(id, []);
    this.matches.set(id, []);
    void this.persistTournament(t);
    return t;
  }

  // ── Register ─────────────────────────────────────────────────────────────

  async register(
    tournamentId: string,
    persistentId: string,
    eloAtEntry = 1200,
  ): Promise<TournamentSlot | { error: string }> {
    const t = this.tournaments.get(tournamentId);
    if (!t) return { error: "Tournament not found." };
    if (t.status !== "registration")
      return { error: "Registration is closed." };

    const existing = this.slots.get(tournamentId) ?? [];
    if (existing.length >= t.maxPlayers)
      return { error: "Tournament is full." };
    if (existing.some((s) => s.persistentId === persistentId))
      return { error: "Already registered." };

    const slot: TournamentSlot = {
      tournamentId,
      persistentId,
      seed: 0, // assigned on seedBracket
      eloAtEntry,
    };
    existing.push(slot);
    this.slots.set(tournamentId, existing);
    void this.persistSlot(slot);
    return slot;
  }

  // ── Seed Bracket ─────────────────────────────────────────────────────────

  async seedBracket(
    tournamentId: string,
  ): Promise<BracketView | { error: string }> {
    const t = this.tournaments.get(tournamentId);
    if (!t) return { error: "Tournament not found." };
    if (t.status !== "registration")
      return { error: "Bracket already seeded." };

    const players = [...(this.slots.get(tournamentId) ?? [])].sort(
      (a, b) => b.eloAtEntry - a.eloAtEntry,
    );
    if (players.length < 2) return { error: "Need at least 2 players." };

    // Assign seeds
    players.forEach((p, i) => (p.seed = i + 1));

    // Build first round: best vs worst pairing
    const bracketSize = nextPowerOf2(players.length);
    const padded: (string | null)[] = [
      ...players.map((p) => p.persistentId),
      ...Array(bracketSize - players.length).fill(null),
    ];

    const round1: TournamentMatch[] = [];
    for (let i = 0; i < bracketSize / 2; i++) {
      const playerA = padded[i] ?? null;
      const playerB = padded[bracketSize - 1 - i] ?? null;
      const isBye = playerB === null;
      const match: TournamentMatch = {
        id: this.nextMatchId++,
        tournamentId,
        round: 1,
        matchIndex: i,
        playerA,
        playerB,
        winnerId: isBye ? playerA : null, // auto-advance byes
        gameId: null,
        certificateId: null,
        status: isBye ? "complete" : "pending",
      };
      round1.push(match);
    }

    this.matches.set(tournamentId, round1);
    t.status = "active";
    t.startedAt = Date.now();
    this.tournaments.set(tournamentId, t);

    for (const m of round1) void this.persistMatch(m);
    void this.persistTournament(t);

    return this.buildBracketView(tournamentId)!;
  }

  // ── Report Result ─────────────────────────────────────────────────────────

  async reportCertifiedResult(
    matchId: number,
    winnerId: string,
    gameId: string,
    certificateId: string,
  ): Promise<BracketView | { error: string }> {
    let targetMatch: TournamentMatch | null = null;
    let tournamentId = "";
    for (const [tid, matches] of this.matches) {
      const match = matches.find((candidate) => candidate.id === matchId);
      if (match) {
        targetMatch = match;
        tournamentId = tid;
        break;
      }
    }
    if (!targetMatch) return { error: "Match not found." };
    if (targetMatch.status === "complete") {
      if (
        targetMatch.gameId === gameId &&
        targetMatch.certificateId === certificateId
      )
        return this.buildBracketView(tournamentId)!;
      return { error: "Match already complete." };
    }
    for (const matches of this.matches.values()) {
      if (
        matches.some((match) => match.gameId === gameId && match.id !== matchId)
      )
        return { error: "Certified game already used by another match." };
    }
    if (targetMatch.playerA !== winnerId && targetMatch.playerB !== winnerId)
      return { error: "Winner must be one of the match participants." };
    targetMatch.winnerId = winnerId;
    targetMatch.gameId = gameId;
    targetMatch.certificateId = certificateId;
    targetMatch.status = "complete";
    await this.persistMatch(targetMatch);
    this.advanceBracket(tournamentId);
    return this.buildBracketView(tournamentId)!;
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async get(tournamentId: string): Promise<Tournament | null> {
    return this.tournaments.get(tournamentId) ?? null;
  }

  getMatch(matchId: number): TournamentMatch | null {
    for (const matches of this.matches.values()) {
      const match = matches.find((candidate) => candidate.id === matchId);
      if (match) return match;
    }
    return null;
  }

  async getTournamentForMatch(matchId: number): Promise<Tournament | null> {
    for (const [tournamentId, matches] of this.matches) {
      if (matches.some((match) => match.id === matchId)) {
        return this.tournaments.get(tournamentId) ?? null;
      }
    }
    return null;
  }

  async list(): Promise<Tournament[]> {
    return [...this.tournaments.values()].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  async getBracket(tournamentId: string): Promise<BracketView | null> {
    return this.buildBracketView(tournamentId);
  }

  // ── Bracket Advancement ───────────────────────────────────────────────────

  private advanceBracket(tournamentId: string): void {
    const t = this.tournaments.get(tournamentId);
    if (!t || t.status !== "active") return;

    const all = this.matches.get(tournamentId) ?? [];
    const rounds = groupByRound(all);
    const lastRound = Math.max(...Object.keys(rounds).map(Number));
    const currentRoundMatches = rounds[lastRound] ?? [];

    // Check if all current-round matches are complete
    const allComplete = currentRoundMatches.every(
      (m) => m.status === "complete",
    );
    if (!allComplete) return;

    const winners = currentRoundMatches
      .map((m) => m.winnerId)
      .filter(Boolean) as string[];

    if (winners.length === 1) {
      // Tournament complete
      t.status = "complete";
      t.completedAt = Date.now();
      this.tournaments.set(tournamentId, t);
      void this.persistTournament(t);
      return;
    }

    // Build next round
    const nextRound: TournamentMatch[] = [];
    for (let i = 0; i < winners.length; i += 2) {
      const playerA = winners[i] ?? null;
      const playerB = winners[i + 1] ?? null;
      const isBye = playerB === null;
      const match: TournamentMatch = {
        id: this.nextMatchId++,
        tournamentId,
        round: lastRound + 1,
        matchIndex: i / 2,
        playerA,
        playerB,
        winnerId: isBye ? playerA : null,
        gameId: null,
        certificateId: null,
        status: isBye ? "complete" : "pending",
      };
      nextRound.push(match);
    }

    const updated = [...all, ...nextRound];
    this.matches.set(tournamentId, updated);
    for (const m of nextRound) void this.persistMatch(m);

    // Recurse in case next round also has byes
    this.advanceBracket(tournamentId);
  }

  private buildBracketView(tournamentId: string): BracketView | null {
    const t = this.tournaments.get(tournamentId);
    if (!t) return null;
    const all = this.matches.get(tournamentId) ?? [];
    const grouped = groupByRound(all);
    const rounds = Object.keys(grouped)
      .map(Number)
      .sort((a, b) => a - b)
      .map((r) => grouped[r]);
    return {
      tournament: t,
      rounds,
      slots: this.slots.get(tournamentId) ?? [],
      operations: buildOperationsBrief(
        t,
        rounds,
        this.slots.get(tournamentId) ?? [],
      ),
    };
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async persistTournament(t: Tournament): Promise<void> {
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO tournaments (id, name, map_name, max_players, status, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE
           SET status = EXCLUDED.status,
               started_at = CASE WHEN EXCLUDED.status = 'active' THEN NOW() ELSE tournaments.started_at END,
               completed_at = CASE WHEN EXCLUDED.status = 'complete' THEN NOW() ELSE tournaments.completed_at END`,
        [t.id, t.name, t.mapName, t.maxPlayers, t.status, t.createdBy],
      );
    } catch {
      // non-fatal
    }
  }

  private async persistSlot(s: TournamentSlot): Promise<void> {
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO tournament_slots (tournament_id, persistent_id, seed, elo_at_entry)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tournament_id, persistent_id) DO UPDATE SET seed = EXCLUDED.seed`,
        [s.tournamentId, s.persistentId, s.seed, s.eloAtEntry],
      );
    } catch {
      // non-fatal
    }
  }

  private async persistMatch(m: TournamentMatch): Promise<void> {
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO tournament_matches
           (id, tournament_id, round, match_index, player_a, player_b, winner_id, game_id, result_certificate_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE
           SET winner_id = EXCLUDED.winner_id,
               game_id = EXCLUDED.game_id,
               result_certificate_id = EXCLUDED.result_certificate_id,
               status = EXCLUDED.status,
               completed_at = CASE WHEN EXCLUDED.status = 'complete' THEN NOW() ELSE NULL END`,
        [
          m.id,
          m.tournamentId,
          m.round,
          m.matchIndex,
          m.playerA,
          m.playerB,
          m.winnerId,
          m.gameId,
          m.certificateId,
          m.status,
        ],
      );
    } catch {
      // non-fatal
    }
  }
}

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function groupByRound(
  matches: TournamentMatch[],
): Record<number, TournamentMatch[]> {
  const result: Record<number, TournamentMatch[]> = {};
  for (const m of matches) {
    (result[m.round] ??= []).push(m);
  }
  return result;
}

function buildOperationsBrief(
  tournament: Tournament,
  rounds: TournamentMatch[][],
  slots: TournamentSlot[],
): TournamentOperationsBrief {
  const nextMatch =
    rounds.flat().find((match) => match.status !== "complete") ?? null;
  const missingSlots = Math.max(0, tournament.maxPlayers - slots.length);
  let nextAction = "Tournament complete. Clip the final and share the bracket.";
  if (tournament.status === "registration") {
    nextAction =
      missingSlots > 0
        ? `Recruit ${missingSlots} more player(s), then seed the bracket.`
        : "Seed the bracket.";
  } else if (nextMatch) {
    nextAction =
      nextMatch.status === "pending"
        ? `Run match #${nextMatch.id}: ${nextMatch.playerA ?? "BYE"} vs ${nextMatch.playerB ?? "BYE"}.`
        : `Report the winner for match #${nextMatch.id}.`;
  }

  return {
    status: tournament.status,
    registeredPlayers: slots.length,
    missingSlots,
    nextAction,
    nextMatchId: nextMatch?.id ?? null,
    overlayUrl: `/stream-overlay?tournamentId=${encodeURIComponent(tournament.id)}`,
  };
}

export const tournamentStore = new TournamentStore();
