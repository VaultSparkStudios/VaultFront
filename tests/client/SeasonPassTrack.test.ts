import { describe, expect, it } from "vitest";
import { seasonProgressArc } from "../../src/client/SeasonPassTrack";

describe("seasonProgressArc", () => {
  it("renders bounded milestone progress instead of an empty SVG", () => {
    expect(seasonProgressArc(5, 10)).toMatchObject({ percent: 50, radius: 18 });
    expect(seasonProgressArc(15, 10).percent).toBe(100);
    expect(seasonProgressArc(-2, 10).percent).toBe(0);
    expect(seasonProgressArc(2, 0).percent).toBe(0);
  });
});
