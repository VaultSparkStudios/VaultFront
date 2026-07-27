import { describe, expect, test, vi } from "vitest";
import { RivalryRevengeTracker } from "../../../src/core/execution/RivalryRevengeTracker";

const player = (id: number) => ({ smallID: () => id }) as never;

describe("RivalryRevengeTracker", () => {
  test("certifies revenge only against the same prior interceptor", () => {
    const tracker = new RivalryRevengeTracker();
    const stats = { vaultRivalryRevenge: vi.fn() } as never;
    const alpha = player(1);
    const bravo = player(2);
    const charlie = player(3);

    tracker.record(alpha, bravo, stats);
    tracker.record(bravo, charlie, stats);
    expect(
      (stats as { vaultRivalryRevenge: ReturnType<typeof vi.fn> })
        .vaultRivalryRevenge,
    ).not.toHaveBeenCalled();

    tracker.record(bravo, alpha, stats);
    expect(
      (stats as { vaultRivalryRevenge: ReturnType<typeof vi.fn> })
        .vaultRivalryRevenge,
    ).toHaveBeenCalledTimes(1);

    tracker.record(bravo, alpha, stats);
    expect(
      (stats as { vaultRivalryRevenge: ReturnType<typeof vi.fn> })
        .vaultRivalryRevenge,
    ).toHaveBeenCalledTimes(1);
  });
});
