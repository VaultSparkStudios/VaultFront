import { render } from "lit";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  equipFortuneTitle,
  fetchFortuneCollection,
} from "../../src/client/Api";
import { FortuneCollectionPanel } from "../../src/client/FortuneCollectionPanel";

vi.mock("../../src/client/Api", () => ({
  fetchFortuneCollection: vi.fn(),
  equipFortuneTitle: vi.fn(),
}));

describe("FortuneCollectionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders owned items with an equip action for unequipped titles", async () => {
    vi.mocked(fetchFortuneCollection).mockResolvedValue({
      items: [
        {
          itemId: "title_operator",
          name: "The Operator",
          rarity: "common",
          type: "title",
          value: "The Operator",
          drawnAt: 1700000000000,
        },
        {
          itemId: "emoji_shield",
          name: "Shield Emoji",
          rarity: "common",
          type: "emoji",
          value: "🛡️",
          drawnAt: 1700000001000,
        },
      ],
      equippedTitle: null,
    });

    const panel = new FortuneCollectionPanel();
    await panel.loadForPlayer("player-123");

    const container = document.createElement("div");
    render(panel.render(), container);

    expect(container.textContent).toContain("The Operator");
    expect(container.textContent).toContain("Shield Emoji");
    expect(container.textContent).toContain("Equip");
    expect(container.textContent).not.toContain("Equipped");
  });

  test("marks the currently equipped title instead of offering to equip it again", async () => {
    vi.mocked(fetchFortuneCollection).mockResolvedValue({
      items: [
        {
          itemId: "title_operator",
          name: "The Operator",
          rarity: "common",
          type: "title",
          value: "The Operator",
          drawnAt: 1700000000000,
        },
      ],
      equippedTitle: "The Operator",
    });

    const panel = new FortuneCollectionPanel();
    await panel.loadForPlayer("player-123");

    const container = document.createElement("div");
    render(panel.render(), container);

    expect(container.textContent).toContain("Equipped");
  });

  test("equipping a title calls the API and reflects the newly equipped title", async () => {
    vi.mocked(fetchFortuneCollection).mockResolvedValue({
      items: [
        {
          itemId: "title_operator",
          name: "The Operator",
          rarity: "common",
          type: "title",
          value: "The Operator",
          drawnAt: 1700000000000,
        },
      ],
      equippedTitle: null,
    });
    vi.mocked(equipFortuneTitle).mockResolvedValue({
      ok: true,
      title: "The Operator",
    });

    const panel = new FortuneCollectionPanel() as any;
    await panel.loadForPlayer("player-123");
    await panel.equip(panel.items[0]);

    expect(equipFortuneTitle).toHaveBeenCalledWith("title_operator");
    expect(panel.equippedTitle).toBe("The Operator");
    expect(panel.equipStatus).toEqual({
      kind: "success",
      message:
        "The Operator equipped. Your title will appear in the next match.",
    });
  });

  test("surfaces a failed equip response without claiming the title changed", async () => {
    vi.mocked(fetchFortuneCollection).mockResolvedValue({
      items: [
        {
          itemId: "title_operator",
          name: "The Operator",
          rarity: "common",
          type: "title",
          value: "The Operator",
          drawnAt: 1700000000000,
        },
      ],
      equippedTitle: null,
    });
    vi.mocked(equipFortuneTitle).mockResolvedValue({
      ok: false,
      error: "Title could not be equipped.",
    });

    const panel = new FortuneCollectionPanel() as any;
    await panel.loadForPlayer("player-123");
    await panel.equip(panel.items[0]);

    expect(panel.equippedTitle).toBeNull();
    expect(panel.equipStatus).toEqual({
      kind: "error",
      message: "Title could not be equipped.",
    });
  });
});
