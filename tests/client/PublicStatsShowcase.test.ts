import { describe, expect, it } from "vitest";
import {
  isPublicStatsFeedStale,
  normalizePublicStatsFeed,
} from "../../src/client/components/PublicStatsShowcase";

const feed = {
  generatedAt: "2026-08-12T20:25:00.000Z",
  refreshSeconds: 86_400,
  showcase: ["players", "loops", "minutes"],
  metrics: [
    {
      id: "players",
      label: "Players",
      value: null,
      computedAt: "2026-08-12T20:25:00.000Z",
      available: false,
    },
    {
      id: "loops",
      label: "Loops",
      value: null,
      computedAt: "2026-08-12T20:25:00.000Z",
      available: false,
    },
    {
      id: "minutes",
      label: "Minutes",
      value: null,
      computedAt: "2026-08-12T20:25:00.000Z",
      available: false,
    },
  ],
};

describe("PublicStatsShowcase", () => {
  it("admits one bounded homepage showcase from the Analytica feed", () => {
    expect(normalizePublicStatsFeed(feed)).toMatchObject({
      refreshSeconds: 86_400,
      showcase: ["players", "loops", "minutes"],
    });
  });

  it("marks the feed stale only after twice its declared refresh window", () => {
    const normalized = normalizePublicStatsFeed(feed)!;
    const observed = Date.parse(feed.generatedAt);
    expect(isPublicStatsFeedStale(normalized, observed + 86_400_000)).toBe(
      false,
    );
    expect(isPublicStatsFeedStale(normalized, observed + 172_800_001)).toBe(
      true,
    );
  });

  it("rejects a tile with fewer than three curated metrics", () => {
    expect(
      normalizePublicStatsFeed({ ...feed, showcase: ["players"] }),
    ).toBeNull();
  });
});
