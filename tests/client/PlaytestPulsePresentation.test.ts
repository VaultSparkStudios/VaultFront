import { describe, expect, it } from "vitest";
import { presentPlaytestPulse } from "../../src/client/PlaytestPulsePresentation";

describe("playtest pulse presentation", () => {
  it("never turns a suppressed cohort into apparent zero behavior", () => {
    const display = presentPlaytestPulse({
      privacy: { suppressed: true },
    } as never);
    expect(Object.values(display)).toEqual([
      "withheld",
      "withheld",
      "withheld",
      "withheld",
      "withheld",
    ]);
  });
});
