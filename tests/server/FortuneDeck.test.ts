import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { fortuneDeck } from "../../src/server/FortuneDeck";
vi.mock("../../src/server/Logger", () => {
  const log = {
    child: () => log,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: log };
});

describe("FortuneDeck reward-to-progression closure (S99 audit #180)", () => {
  test("certified awards are durable-shaped and idempotent", async () => {
    const first = await fortuneDeck.awardCertifiedWin(
      "player-certified-1",
      "match-certified-1",
      "certificate-1",
    );
    const replay = await fortuneDeck.awardCertifiedWin(
      "player-certified-1",
      "match-certified-1",
      "certificate-1",
    );
    expect(first.alreadyOwned).toBe(false);
    expect(replay.alreadyOwned).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    expect(first.receipt).toMatchObject({
      kind: "vaultfront-certified-fortune-award",
      certificateId: "certificate-1",
      itemId: first.item.id,
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  test("draw is deterministic and idempotent per persistentId+matchId", () => {
    const first = fortuneDeck.draw("player-collection-1", "match-a");
    const second = fortuneDeck.draw("player-collection-1", "match-a");
    expect(second.alreadyOwned).toBe(true);
    expect(second.item.id).toBe(first.item.id);
  });

  test("getCollection derives the real owned items, not just idempotency keys (process-local mode)", async () => {
    const persistentId = "player-collection-2";
    const { item: firstItem } = fortuneDeck.draw(persistentId, "match-x");
    const { item: secondItem } = fortuneDeck.draw(persistentId, "match-y");

    const collection = await fortuneDeck.getCollection(persistentId);
    const ids = collection.map((entry) => entry.itemId).sort();
    expect(ids).toEqual([firstItem.id, secondItem.id].sort());
    for (const entry of collection) {
      expect(entry.name).toEqual(expect.any(String));
      expect(["title", "badge", "emoji"]).toContain(entry.type);
    }
  });

  test("a player who never drew anything has an empty collection", async () => {
    const collection = await fortuneDeck.getCollection("player-never-drew");
    expect(collection).toEqual([]);
  });

  test("equipTitle rejects an item the player does not own", async () => {
    const result = await fortuneDeck.equipTitle(
      "player-collection-3",
      "title_vault_sovereign",
    );
    expect(result.ok).toBe(false);
  });

  test("equipTitle rejects a non-title item (badge/emoji) even if owned", async () => {
    const persistentId = "player-collection-4";
    // Draw until a non-title item is owned, or fall back to asserting the
    // deck's own type gate is exercised via a synthetic collection member.
    let ownedNonTitle: string | null = null;
    for (let i = 0; i < 50 && !ownedNonTitle; i++) {
      const { item } = fortuneDeck.draw(persistentId, `probe-${i}`);
      if (item.type !== "title") ownedNonTitle = item.id;
    }
    expect(ownedNonTitle).not.toBeNull();
    const result = await fortuneDeck.equipTitle(
      persistentId,
      ownedNonTitle as string,
    );
    expect(result.ok).toBe(false);
  });

  test("equipTitle accepts an owned title and getEquippedTitle reflects it", async () => {
    const persistentId = "player-collection-5";
    let ownedTitleId: string | null = null;
    let ownedTitleValue: string | null = null;
    for (let i = 0; i < 50 && !ownedTitleId; i++) {
      const { item } = fortuneDeck.draw(persistentId, `probe-${i}`);
      if (item.type === "title") {
        ownedTitleId = item.id;
        ownedTitleValue = item.value;
      }
    }
    expect(ownedTitleId).not.toBeNull();
    const result = await fortuneDeck.equipTitle(
      persistentId,
      ownedTitleId as string,
    );
    expect(result).toMatchObject({ ok: true, title: ownedTitleValue });
    expect(await fortuneDeck.getEquippedTitle(persistentId)).toBe(
      ownedTitleValue,
    );
  });

  test("a player with no equip choice has no equipped title", async () => {
    expect(await fortuneDeck.getEquippedTitle("player-no-equip")).toBeNull();
  });
});

describe("player_fortune schema (S99 audit #180 root-fix)", () => {
  test("the table FortuneDeck.draw() has always written to actually exists in schema.sql", () => {
    const schema = readFileSync(
      resolve(__dirname, "../../src/server/db/schema.sql"),
      "utf8",
    );
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS player_fortune");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS equipped_fortune_title");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS certificate_id");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS receipt_digest");
  });
});
