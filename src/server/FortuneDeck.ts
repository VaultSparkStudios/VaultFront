/**
 * FortuneDeck — post-win cosmetic reward draw.
 *
 * After every win, a player draws one item from the Fortune Pool.
 * Items are cosmetic only (titles, badge variants, emojis). No real money.
 * Draw is deterministic: seeded by persistentId + matchId so re-draws return
 * the same item (idempotent). Unlocks are persisted in-memory + Postgres.
 */

import { pool } from "./db/pool";
import { logger } from "./Logger";

export type FortuneRarity = "common" | "rare" | "legendary";

export interface FortuneItem {
  id: string;
  name: string;
  description: string;
  type: "title" | "badge" | "emoji";
  rarity: FortuneRarity;
  value: string; // e.g. CSS class name, emoji char, or title string
}

const FORTUNE_DECK: FortuneItem[] = [
  // Common (60% total)
  {
    id: "title_operator",
    name: "The Operator",
    description: "A title for steady tacticians",
    type: "title",
    rarity: "common",
    value: "The Operator",
  },
  {
    id: "title_runner",
    name: "The Runner",
    description: "Fast and unpredictable",
    type: "title",
    rarity: "common",
    value: "The Runner",
  },
  {
    id: "emoji_shield",
    name: "Shield Emoji",
    description: "A shield for your name",
    type: "emoji",
    rarity: "common",
    value: "🛡️",
  },
  {
    id: "emoji_convoy",
    name: "Convoy Emoji",
    description: "Show your convoy pride",
    type: "emoji",
    rarity: "common",
    value: "🚛",
  },
  {
    id: "badge_silver_border",
    name: "Silver Border",
    description: "Silver badge border variant",
    type: "badge",
    rarity: "common",
    value: "silver",
  },
  {
    id: "badge_bronze_border",
    name: "Bronze Border",
    description: "Bronze badge border variant",
    type: "badge",
    rarity: "common",
    value: "bronze",
  },
  {
    id: "title_guardian",
    name: "The Guardian",
    description: "Protector of vault routes",
    type: "title",
    rarity: "common",
    value: "The Guardian",
  },
  {
    id: "emoji_vault",
    name: "Vault Emoji",
    description: "The essence of the game",
    type: "emoji",
    rarity: "common",
    value: "🏦",
  },
  {
    id: "title_tactician",
    name: "The Tactician",
    description: "Outthinks the opponent",
    type: "title",
    rarity: "common",
    value: "The Tactician",
  },
  {
    id: "emoji_lightning",
    name: "Lightning Emoji",
    description: "Speed personified",
    type: "emoji",
    rarity: "common",
    value: "⚡",
  },
  {
    id: "badge_pulse_border",
    name: "Pulse Border",
    description: "Animated pulse border",
    type: "badge",
    rarity: "common",
    value: "pulse",
  },
  {
    id: "title_interceptor",
    name: "The Interceptor",
    description: "Always in the right place",
    type: "title",
    rarity: "common",
    value: "The Interceptor",
  },
  // Rare (30% total)
  {
    id: "title_phantom",
    name: "Vault Phantom",
    description: "Moves in silence",
    type: "title",
    rarity: "rare",
    value: "Vault Phantom",
  },
  {
    id: "badge_gold_border",
    name: "Gold Border",
    description: "Gold badge border variant",
    type: "badge",
    rarity: "rare",
    value: "gold",
  },
  {
    id: "title_chain_executor",
    name: "Chain Executor",
    description: "Master of the execution chain",
    type: "title",
    rarity: "rare",
    value: "Chain Executor",
  },
  {
    id: "emoji_crown",
    name: "Crown Emoji",
    description: "Wear the crown",
    type: "emoji",
    rarity: "rare",
    value: "👑",
  },
  {
    id: "badge_ice_border",
    name: "Ice Border",
    description: "Cold blue animated border",
    type: "badge",
    rarity: "rare",
    value: "ice",
  },
  {
    id: "title_convoy_lord",
    name: "Convoy Lord",
    description: "Commands every supply line",
    type: "title",
    rarity: "rare",
    value: "Convoy Lord",
  },
  // Legendary (10% total)
  {
    id: "title_vault_sovereign",
    name: "Vault Sovereign",
    description: "The rarest of the rare",
    type: "title",
    rarity: "legendary",
    value: "Vault Sovereign",
  },
  {
    id: "badge_rainbow_border",
    name: "Rainbow Shimmer",
    description: "Holographic badge border",
    type: "badge",
    rarity: "legendary",
    value: "rainbow",
  },
];

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h ^= h >> 17;
    h ^= h << 5;
    h = h >>> 0;
    return h / 0xffffffff;
  };
}

function drawItem(persistentId: string, matchId: string): FortuneItem {
  const rng = seededRandom(`${persistentId}:${matchId}`);
  const roll = rng() * 100;
  const rarity: FortuneRarity =
    roll < 10 ? "legendary" : roll < 40 ? "rare" : "common";
  const pool_items = FORTUNE_DECK.filter((i) => i.rarity === rarity);
  const idx = Math.floor(rng() * pool_items.length);
  return pool_items[idx] ?? FORTUNE_DECK[0]!;
}

// In-memory unlock log: persistentId → Set<matchId>. Process-local fallback
// only; Postgres (player_fortune) is authoritative when configured.
const drawnKeys = new Map<string, Set<string>>();
const equippedTitles = new Map<string, string>();

export interface FortuneCollectionEntry {
  itemId: string;
  name: string;
  rarity: FortuneRarity;
  type: FortuneItem["type"] | null;
  value: string | null;
  drawnAt: number | null;
}

export const fortuneDeck = {
  draw(
    persistentId: string,
    matchId: string,
  ): { item: FortuneItem; alreadyOwned: boolean } {
    const owned = drawnKeys.get(persistentId) ?? new Set<string>();
    if (owned.has(matchId)) {
      // Idempotent: re-derive the same item
      return { item: drawItem(persistentId, matchId), alreadyOwned: true };
    }
    const item = drawItem(persistentId, matchId);
    owned.add(matchId);
    drawnKeys.set(persistentId, owned);

    // Persist to Postgres (fire-and-forget)
    if (pool) {
      pool
        .query(
          `INSERT INTO player_fortune (persistent_id, match_id, item_id, rarity, item_name)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [persistentId, matchId, item.id, item.rarity, item.name],
        )
        .catch((err) =>
          logger.error("fortune persist failed", { err: String(err) }),
        );
    }

    return { item, alreadyOwned: false };
  },

  /**
   * Reward → progression closure (S99 audit #180): the drawn-match log alone
   * cannot answer "what has this player won" -- it only proves idempotency
   * keys. This derives the actual owned item collection, from Postgres when
   * configured and by re-deriving from the process-local draw log otherwise
   * (the draw itself is deterministic per persistentId+matchId).
   */
  async getCollection(persistentId: string): Promise<FortuneCollectionEntry[]> {
    if (pool) {
      const result = await pool.query<{
        item_id: string;
        item_name: string;
        rarity: FortuneRarity;
        drawn_at: Date;
      }>(
        `SELECT item_id, item_name, rarity, drawn_at FROM player_fortune
         WHERE persistent_id = $1 ORDER BY drawn_at DESC`,
        [persistentId],
      );
      return result.rows.map((row) => {
        const deckItem = FORTUNE_DECK.find((i) => i.id === row.item_id);
        return {
          itemId: row.item_id,
          name: row.item_name,
          rarity: row.rarity,
          type: deckItem?.type ?? null,
          value: deckItem?.value ?? null,
          drawnAt: row.drawn_at.getTime(),
        };
      });
    }
    const matchIds = drawnKeys.get(persistentId) ?? new Set<string>();
    return [...matchIds].map((matchId) => {
      const item = drawItem(persistentId, matchId);
      return {
        itemId: item.id,
        name: item.name,
        rarity: item.rarity,
        type: item.type,
        value: item.value,
        drawnAt: null,
      };
    });
  },

  /** Equip an owned title next to the player's name. Coaching/identity only. */
  async equipTitle(
    persistentId: string,
    itemId: string,
  ): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
    const collection = await this.getCollection(persistentId);
    const owned = collection.find((entry) => entry.itemId === itemId);
    if (!owned || owned.type !== "title" || !owned.value) {
      return { ok: false, error: "Title not owned" };
    }
    equippedTitles.set(persistentId, owned.value);
    if (pool) {
      await pool
        .query(
          `UPDATE player_stats SET equipped_fortune_title = $2 WHERE persistent_id = $1`,
          [persistentId, owned.value],
        )
        .catch((err) =>
          logger.error("equip title persist failed", { err: String(err) }),
        );
    }
    return { ok: true, title: owned.value };
  },

  async getEquippedTitle(persistentId: string): Promise<string | null> {
    if (pool) {
      const result = await pool.query<{
        equipped_fortune_title: string | null;
      }>(
        `SELECT equipped_fortune_title FROM player_stats WHERE persistent_id = $1`,
        [persistentId],
      );
      return result.rows[0]?.equipped_fortune_title ?? null;
    }
    return equippedTitles.get(persistentId) ?? null;
  },

  getDeck(): FortuneItem[] {
    return FORTUNE_DECK;
  },
};
