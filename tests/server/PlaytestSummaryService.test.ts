import { describe, expect, it, vi } from "vitest";
import { PlaytestSummaryService } from "../../src/server/PlaytestSummaryService";
import { buildVaultFrontPlaytestPulseSummaryFromEvents } from "../../src/server/VaultFrontPlaytestPulse";

describe("PlaytestSummaryService", () => {
  it("single-flights concurrent reads, caches briefly, and invalidates after writes", async () => {
    let now = 10_000;
    const loadPulse = vi.fn(async () =>
      buildVaultFrontPlaytestPulseSummaryFromEvents([], now),
    );
    const loadCertified = vi.fn(async () => null);
    const service = new PlaytestSummaryService({
      now: () => now,
      ttlMs: 100,
      loadPulse,
      loadCertified,
    });

    const [first, second] = await Promise.all([
      service.summary(),
      service.summary(),
    ]);
    expect(first).toBe(second);
    expect(loadPulse).toHaveBeenCalledTimes(1);
    await service.summary();
    expect(loadPulse).toHaveBeenCalledTimes(1);

    service.invalidate();
    await service.summary();
    expect(loadPulse).toHaveBeenCalledTimes(2);
    now += 101;
    await service.summary();
    expect(loadPulse).toHaveBeenCalledTimes(3);
  });
});
