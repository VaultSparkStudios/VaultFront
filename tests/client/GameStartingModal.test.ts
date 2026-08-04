import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchMatchOracle: vi.fn(),
  fetchMatchProphecy: vi.fn(),
  fetchPrematchBrief: vi.fn(),
}));

vi.mock("../../src/client/Api", () => api);
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { GameStartingModal } from "../../src/client/GameStartingModal";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("GameStartingModal session ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.fetchMatchOracle.mockReset();
    api.fetchMatchProphecy.mockReset();
    api.fetchPrematchBrief.mockReset();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("prevents a previous match from overwriting the current intelligence", async () => {
    const firstOracle = deferred<any>();
    const secondOracle = deferred<any>();
    const firstProphecy = deferred<string | null>();
    const secondProphecy = deferred<string | null>();
    const firstBrief = deferred<string | null>();
    const secondBrief = deferred<string | null>();
    api.fetchMatchOracle
      .mockReturnValueOnce(firstOracle.promise)
      .mockReturnValueOnce(secondOracle.promise);
    api.fetchMatchProphecy
      .mockReturnValueOnce(firstProphecy.promise)
      .mockReturnValueOnce(secondProphecy.promise);
    api.fetchPrematchBrief
      .mockReturnValueOnce(firstBrief.promise)
      .mockReturnValueOnce(secondBrief.promise);

    const modal = new GameStartingModal();
    document.body.append(modal);
    const first = modal.showWithPlayers(["a", "b"], "a", "old-map");
    const second = modal.showWithPlayers(["c", "d"], "c", "new-map");

    secondOracle.resolve({
      predictions: [{ playerId: "c", deltaIfWin: 9, deltaIfLoss: -4 }],
    });
    secondProphecy.resolve("The new horizon holds.");
    secondBrief.resolve("New-map briefing.");
    await second;
    await modal.updateComplete;

    firstOracle.resolve({
      predictions: [{ playerId: "a", deltaIfWin: 99, deltaIfLoss: -99 }],
    });
    firstProphecy.resolve("Stale prophecy.");
    firstBrief.resolve("Stale briefing.");
    await first;
    await modal.updateComplete;

    expect(modal.textContent).toContain("New-map briefing.");
    expect(modal.textContent).not.toContain("Stale briefing.");
    expect(modal.textContent).not.toContain("Stale prophecy.");
  });

  it("aborts owned requests on hide and exposes a responsive dialog", async () => {
    let capturedSignal: AbortSignal | undefined;
    const waitForAbort = (_: unknown, signal?: AbortSignal) =>
      new Promise<null>((resolve) => {
        capturedSignal = signal;
        signal?.addEventListener("abort", () => resolve(null), { once: true });
      });
    api.fetchMatchOracle.mockImplementation(waitForAbort);
    api.fetchMatchProphecy.mockImplementation(
      (_map: string, _count: number, _mutator: string, signal?: AbortSignal) =>
        waitForAbort(null, signal),
    );
    api.fetchPrematchBrief.mockImplementation(
      (_id: string, _map: string, _style: unknown, signal?: AbortSignal) =>
        waitForAbort(null, signal),
    );

    const modal = new GameStartingModal();
    document.body.append(modal);
    const request = modal.showWithPlayers(["a", "b"], "a");
    modal.hide();
    await request;
    await modal.updateComplete;

    expect(capturedSignal?.aborted).toBe(true);
    const dialog = modal.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("class")).toContain("max-h-[85dvh]");
    expect(dialog?.getAttribute("class")).toContain("w-[min(92vw,32rem)]");
    expect(dialog?.getAttribute("aria-hidden")).toBe("true");
  });
});
