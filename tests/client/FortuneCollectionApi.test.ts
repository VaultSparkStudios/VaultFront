import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
  getPlayToken: vi.fn(async () => "test-token"),
  logOut: vi.fn(),
  userAuth: vi.fn(async () => false),
}));

import {
  equipFortuneTitle,
  fetchFortuneCollection,
  getApiBase,
} from "../../src/client/Api";

describe("Fortune Deck client integration (S99 audit #187)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchFortuneCollection reads the owned collection and equipped title", async () => {
    const items = [
      {
        itemId: "title_operator",
        name: "The Operator",
        rarity: "common",
        type: "title",
        value: "The Operator",
        drawnAt: 1700000000000,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items, equippedTitle: "The Operator" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFortuneCollection("player-123");

    expect(fetchMock).toHaveBeenCalledWith(
      `${getApiBase()}/api/vaultfront/fortune-collection/player-123`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result).toEqual({ items, equippedTitle: "The Operator" });
  });

  it("fetchFortuneCollection returns null when the request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchFortuneCollection("player-123")).toBeNull();
  });

  it("equipFortuneTitle posts the itemId and returns the equipped title on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, title: "The Operator" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await equipFortuneTitle("title_operator");

    expect(fetchMock).toHaveBeenCalledWith(
      `${getApiBase()}/api/vaultfront/fortune-collection/equip`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ itemId: "title_operator" }),
      }),
    );
    expect(result).toEqual({ ok: true, title: "The Operator" });
  });

  it("equipFortuneTitle surfaces the server's rejection reason for an unowned item", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Title not owned" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await equipFortuneTitle("title_not_owned");

    expect(result).toEqual({ ok: false, error: "Title not owned" });
  });

  it("equipFortuneTitle degrades gracefully when the network call throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const result = await equipFortuneTitle("title_operator");

    expect(result).toEqual({
      ok: false,
      error: "Equip is temporarily unavailable.",
    });
  });
});
