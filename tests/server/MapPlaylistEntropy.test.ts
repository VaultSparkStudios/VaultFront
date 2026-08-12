import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));

import { PseudoRandom } from "../../src/core/PseudoRandom";
import type { GameMapType } from "../../src/core/game/Game";
import { MapPlaylist } from "../../src/server/MapPlaylist";

const capacity = async (map: GameMapType) => ({
  map,
  landTiles: 1_000_000,
  source: "manifest" as const,
  observedAt: 1,
  error: null,
});

function seeded(seed: number): MapPlaylist {
  const entropy = new PseudoRandom(seed);
  return new MapPlaylist(capacity, () => entropy.next());
}

describe("MapPlaylist entropy", () => {
  it("reproduces the complete public selection stream for the same seed", async () => {
    const left = seeded(101);
    const right = seeded(101);
    const leftConfigs = await Promise.all([
      left.gameConfig("ffa"),
      left.gameConfig("team"),
      left.gameConfig("special"),
    ]);
    const rightConfigs = await Promise.all([
      right.gameConfig("ffa"),
      right.gameConfig("team"),
      right.gameConfig("special"),
    ]);
    expect(leftConfigs).toEqual(rightConfigs);
    expect(left.lastSelectionReceipt()).toEqual(right.lastSelectionReceipt());
    expect(left.lastSelectionReceipt()).toMatchObject({
      sequence: 3,
      playlist: "special",
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it("varies selection streams across seeds", async () => {
    const left = await seeded(101).gameConfig("special");
    const right = await seeded(202).gameConfig("special");
    expect(right).not.toEqual(left);
  });

  it("rejects an invalid entropy source instead of silently biasing selection", () => {
    const playlist = new MapPlaylist(capacity, () => 1);
    expect(() => playlist.get1v1Config()).toThrow("playlist entropy");
  });

  it("returns a defensive copy of the bounded selection receipt", async () => {
    const playlist = seeded(101);
    await playlist.gameConfig("ffa");
    const receipt = playlist.lastSelectionReceipt();
    expect(receipt).not.toBeNull();
    receipt!.sequence = 999;
    expect(playlist.lastSelectionReceipt()?.sequence).toBe(1);
  });
});
