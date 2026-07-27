/**
 * ClanStore — persistent clan and squad management.
 *
 * Dual-path: in-memory when DATABASE_URL is absent, Postgres when present.
 * All writes are fire-and-forget after the optimistic in-memory update so
 * the game loop is never blocked.
 *
 * Constraints (enforced both in-memory and in DB):
 *   - Clan names: 2–32 chars, alphanumeric + spaces
 *   - Tags: 2–6 chars, uppercase alphanumeric
 *   - Max members per clan: 50
 *   - A player may belong to at most one clan
 */

import { nanoid } from "nanoid";
import { pool } from "./db/pool";

export type ClanRole = "founder" | "officer" | "member";

export interface Clan {
  id: string;
  name: string;
  tag: string;
  founderId: string;
  description: string;
  createdAt: number;
  clanElo: number;
  clanWins: number;
  clanLosses: number;
}

export interface ClanMember {
  clanId: string;
  persistentId: string;
  role: ClanRole;
  joinedAt: number;
}

export interface ClanWithMembers extends Clan {
  members: ClanMember[];
  avgElo: number;
}

export interface ClanLeaderboardEntry {
  rank: number;
  clanId: string;
  name: string;
  tag: string;
  memberCount: number;
  avgElo: number;
  clanElo: number;
  clanWins: number;
  clanLosses: number;
}

const MAX_MEMBERS = 50;

class ClanStore {
  // In-memory state
  private clans = new Map<string, Clan>();
  private members = new Map<string, ClanMember[]>(); // clanId → members
  private playerClan = new Map<string, string>(); // persistentId → clanId

  // ── Create ──────────────────────────────────────────────────────────────

  async createClan(
    name: string,
    tag: string,
    founderId: string,
    description = "",
  ): Promise<Clan | { error: string }> {
    name = name.trim();
    tag = tag.trim().toUpperCase();

    if (!/^[A-Za-z0-9 ]{2,32}$/.test(name)) {
      return { error: "Clan name must be 2–32 alphanumeric characters." };
    }
    if (!/^[A-Z0-9]{2,6}$/.test(tag)) {
      return { error: "Tag must be 2–6 uppercase alphanumeric characters." };
    }
    if (this.playerClan.has(founderId)) {
      return { error: "You are already in a clan. Leave it first." };
    }
    for (const c of this.clans.values()) {
      if (c.name.toLowerCase() === name.toLowerCase()) {
        return { error: "A clan with that name already exists." };
      }
      if (c.tag === tag)
        return { error: "A clan with that tag already exists." };
    }

    const id = nanoid(12);
    const now = Date.now();
    const clan: Clan = {
      id,
      name,
      tag,
      founderId,
      description,
      createdAt: now,
      clanElo: 1200,
      clanWins: 0,
      clanLosses: 0,
    };

    this.clans.set(id, clan);
    this.members.set(id, [
      { clanId: id, persistentId: founderId, role: "founder", joinedAt: now },
    ]);
    this.playerClan.set(founderId, id);

    void this.persistClan(clan);
    void this.persistMember(id, founderId, "founder");
    return clan;
  }

  // ── Join ─────────────────────────────────────────────────────────────────

  async joinClan(
    clanId: string,
    persistentId: string,
  ): Promise<ClanMember | { error: string }> {
    if (this.playerClan.has(persistentId)) {
      return { error: "Already in a clan. Leave it first." };
    }
    const clan = this.clans.get(clanId);
    if (!clan) return { error: "Clan not found." };

    const existing = this.members.get(clanId) ?? [];
    if (existing.length >= MAX_MEMBERS) {
      return { error: "Clan is full (max 50 members)." };
    }

    const member: ClanMember = {
      clanId,
      persistentId,
      role: "member",
      joinedAt: Date.now(),
    };
    existing.push(member);
    this.members.set(clanId, existing);
    this.playerClan.set(persistentId, clanId);

    void this.persistMember(clanId, persistentId, "member");
    return member;
  }

  // ── Leave ─────────────────────────────────────────────────────────────────

  async leaveClan(persistentId: string): Promise<void | { error: string }> {
    const clanId = this.playerClan.get(persistentId);
    if (!clanId) return { error: "Not in a clan." };

    const clan = this.clans.get(clanId);
    if (!clan) return;

    // Founders must transfer or disband before leaving
    if (clan.founderId === persistentId) {
      const others = (this.members.get(clanId) ?? []).filter(
        (m) => m.persistentId !== persistentId,
      );
      if (others.length > 0) {
        return {
          error:
            "As founder, transfer ownership or disband the clan before leaving.",
        };
      }
      // No other members — disband
      this.disbandClan(clanId);
      return;
    }

    const remaining = (this.members.get(clanId) ?? []).filter(
      (m) => m.persistentId !== persistentId,
    );
    this.members.set(clanId, remaining);
    this.playerClan.delete(persistentId);

    void this.removeMemberFromDb(clanId, persistentId);
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  getClan(clanId: string): ClanWithMembers | null {
    const clan = this.clans.get(clanId);
    if (!clan) return null;
    const members = this.members.get(clanId) ?? [];
    return { ...clan, members, avgElo: 1200 }; // avgElo computed from leaderboard
  }

  getClanByPlayer(persistentId: string): ClanWithMembers | null {
    const clanId = this.playerClan.get(persistentId);
    if (!clanId) return null;
    return this.getClan(clanId);
  }

  getClanLeaderboard(limit = 50): ClanLeaderboardEntry[] {
    const entries: ClanLeaderboardEntry[] = [];
    for (const [clanId, clan] of this.clans) {
      const members = this.members.get(clanId) ?? [];
      entries.push({
        rank: 0,
        clanId,
        name: clan.name,
        tag: clan.tag,
        memberCount: members.length,
        avgElo: 1200,
        clanElo: clan.clanElo,
        clanWins: clan.clanWins,
        clanLosses: clan.clanLosses,
      });
    }
    entries.sort(
      (a, b) => b.clanElo - a.clanElo || b.memberCount - a.memberCount,
    );
    entries.forEach((e, i) => (e.rank = i + 1));
    return entries.slice(0, limit);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private disbandClan(clanId: string): void {
    const members = this.members.get(clanId) ?? [];
    for (const m of members) this.playerClan.delete(m.persistentId);
    this.members.delete(clanId);
    this.clans.delete(clanId);
    void this.deleteClanFromDb(clanId);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async persistClan(clan: Clan): Promise<void> {
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO clans (id, name, tag, founder_id, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name, tag = EXCLUDED.tag,
               description = EXCLUDED.description, updated_at = NOW()`,
        [clan.id, clan.name, clan.tag, clan.founderId, clan.description],
      );
    } catch {
      // non-fatal
    }
  }

  private async persistMember(
    clanId: string,
    persistentId: string,
    role: ClanRole,
  ): Promise<void> {
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO clan_members (clan_id, persistent_id, role, joined_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (clan_id, persistent_id) DO UPDATE SET role = EXCLUDED.role`,
        [clanId, persistentId, role],
      );
    } catch {
      // non-fatal
    }
  }

  private async removeMemberFromDb(
    clanId: string,
    persistentId: string,
  ): Promise<void> {
    if (!pool) return;
    try {
      await pool.query(
        `DELETE FROM clan_members WHERE clan_id = $1 AND persistent_id = $2`,
        [clanId, persistentId],
      );
    } catch {
      // non-fatal
    }
  }

  private async deleteClanFromDb(clanId: string): Promise<void> {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM clans WHERE id = $1`, [clanId]);
    } catch {
      // non-fatal
    }
  }

  /**
   * After a match, find which clan had the most members on the winning side
   * vs the losing side and update clan_elo accordingly.
   */
  async updateClanMatchResult(
    winnerPersistentIds: string[],
    loserPersistentIds: string[],
  ): Promise<void> {
    const clanCount = (ids: string[]): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const pid of ids) {
        const clanId = this.playerClan.get(pid);
        if (clanId) counts.set(clanId, (counts.get(clanId) ?? 0) + 1);
      }
      return counts;
    };
    const winCounts = clanCount(winnerPersistentIds);
    const loseCounts = clanCount(loserPersistentIds);

    const topClan = (map: Map<string, number>) => {
      let best: string | null = null;
      let bestN = 0;
      for (const [id, n] of map) {
        if (n > bestN) {
          bestN = n;
          best = id;
        }
      }
      return best;
    };

    const winClan = topClan(winCounts);
    const loseClan = topClan(loseCounts);
    if (!winClan || !loseClan || winClan === loseClan) return;

    const winC = this.clans.get(winClan);
    const loseC = this.clans.get(loseClan);
    if (!winC || !loseC) return;

    // Simple K=32 ELO exchange between clans
    const K = 32;
    const expectedWin =
      1 / (1 + Math.pow(10, (loseC.clanElo - winC.clanElo) / 400));
    const delta = Math.round(K * (1 - expectedWin));

    winC.clanElo += delta;
    winC.clanWins += 1;
    loseC.clanElo = Math.max(800, loseC.clanElo - delta);
    loseC.clanLosses += 1;

    if (pool) {
      await Promise.all([
        pool
          .query(
            `UPDATE clans SET clan_elo = $2, clan_wins = clan_wins + 1 WHERE id = $1`,
            [winClan, winC.clanElo],
          )
          .catch(() => null),
        pool
          .query(
            `UPDATE clans SET clan_elo = $2, clan_losses = clan_losses + 1 WHERE id = $1`,
            [loseClan, loseC.clanElo],
          )
          .catch(() => null),
      ]);
    }
  }

  private readonly dynastyStories = new Map<string, string>();
  private readonly dynastyCertificateIds = new Set<string>();

  /** Fetch the current dynasty story for a clan. */
  async getDynastyStory(clanId: string): Promise<string | null> {
    if (!pool) return this.dynastyStories.get(clanId) ?? null;
    const result = await pool
      .query<{
        dynasty_story: string | null;
      }>(`SELECT dynasty_story FROM clans WHERE id = $1`, [clanId])
      .catch(() => null);
    return result?.rows[0]?.dynasty_story ?? null;
  }

  /** Append a certificate-bound chapter exactly once. */
  async appendDynastyStoryOnce(
    clanId: string,
    certificateId: string,
    chapter: string,
  ): Promise<boolean> {
    const receiptKey = `${clanId}:${certificateId}`;
    if (this.dynastyCertificateIds.has(receiptKey)) return false;
    if (pool) {
      const claimed = await pool.query(
        `INSERT INTO clan_dynasty_chapters (clan_id, certificate_id, chapter)
         VALUES ($1, $2, $3) ON CONFLICT (clan_id, certificate_id) DO NOTHING
         RETURNING certificate_id`,
        [clanId, certificateId, chapter.slice(0, 512)],
      );
      if (claimed.rowCount === 0) return false;
    }
    this.dynastyCertificateIds.add(receiptKey);
    await this.appendDynastyStory(clanId, chapter);
    return true;
  }

  /** Append a new chapter to the clan's dynasty story. */
  async appendDynastyStory(clanId: string, chapter: string): Promise<void> {
    const trimmed = chapter.slice(0, 512);
    const current = (await this.getDynastyStory(clanId)) ?? "";
    const separator = current ? "\n\n" : "";
    const updated = (current + separator + trimmed).slice(-4096);
    this.dynastyStories.set(clanId, updated);
    if (pool) {
      await pool
        .query(`UPDATE clans SET dynasty_story = $2 WHERE id = $1`, [
          clanId,
          updated,
        ])
        .catch(() => null);
    }
  }

  /** Get the clanId for a player. */
  getClanForPlayer(persistentId: string): string | undefined {
    return this.playerClan.get(persistentId);
  }

  async hydrateFromDb(): Promise<void> {
    if (!pool) return;
    try {
      const [clanRows, memberRows] = await Promise.all([
        pool.query<{
          id: string;
          name: string;
          tag: string;
          founder_id: string;
          description: string;
          created_at: Date;
        }>(
          `SELECT id, name, tag, founder_id, description, created_at, clan_elo, clan_wins, clan_losses FROM clans`,
        ),
        pool.query<{
          clan_id: string;
          persistent_id: string;
          role: ClanRole;
          joined_at: Date;
        }>(`SELECT clan_id, persistent_id, role, joined_at FROM clan_members`),
      ]);

      for (const row of clanRows.rows) {
        this.clans.set(row.id, {
          id: row.id,
          name: row.name,
          tag: row.tag,
          founderId: row.founder_id,
          description: row.description,
          createdAt: row.created_at.getTime(),
          clanElo: Number((row as any).clan_elo ?? 1200),
          clanWins: Number((row as any).clan_wins ?? 0),
          clanLosses: Number((row as any).clan_losses ?? 0),
        });
        this.members.set(row.id, []);
      }

      for (const row of memberRows.rows) {
        const list = this.members.get(row.clan_id);
        if (list) {
          list.push({
            clanId: row.clan_id,
            persistentId: row.persistent_id,
            role: row.role,
            joinedAt: row.joined_at.getTime(),
          });
        }
        this.playerClan.set(row.persistent_id, row.clan_id);
      }
    } catch {
      // non-fatal — fall back to empty in-memory store
    }
  }
}

export const clanStore = new ClanStore();

// Hydrate from DB on startup (non-blocking)
void clanStore.hydrateFromDb();
