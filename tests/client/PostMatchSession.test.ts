import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PostMatchSessionOrchestrator } from "../../src/client/PostMatchSession";

describe("PostMatchSessionOrchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("cancels every prior timer and rejects stale commits on reopen", async () => {
    const sessions = new PostMatchSessionOrchestrator();
    const first = sessions.begin();
    const timerCommit = vi.fn();
    first.timeout(timerCommit, 100);
    const delayed = first.delay(100);
    let resolveHydration!: (value: string) => void;
    const hydration = first.settle(
      new Promise<string>((resolve) => {
        resolveHydration = resolve;
      }),
      2_000,
    );

    const second = sessions.begin();
    resolveHydration("stale");
    await vi.runAllTimersAsync();

    expect(await delayed).toBe(false);
    expect(await hydration).toBeUndefined();
    expect(first.commit(vi.fn())).toBe(false);
    expect(timerCommit).not.toHaveBeenCalled();
    expect(second.snapshot()).toMatchObject({
      generation: 2,
      active: true,
      timers: 0,
    });
  });

  test("issues one source-derived lifecycle receipt from task outcomes", async () => {
    vi.setSystemTime(10_000);
    const receipts: any[] = [];
    const sessions = new PostMatchSessionOrchestrator((receipt) =>
      receipts.push(receipt),
    );
    const scope = sessions.begin();
    expect(await scope.settle(Promise.resolve("ready"), 100, "contracts")).toBe(
      "ready",
    );
    expect(
      await scope.settle(Promise.reject(new Error("offline")), 100, "recap"),
    ).toBeUndefined();
    const delayed = scope.settle(
      new Promise<string>(() => undefined),
      250,
      "fortune",
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(await delayed).toBeUndefined();
    scope.timeout(vi.fn(), 1_000);

    sessions.cancel("hidden");
    sessions.cancel("hidden");

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      schemaVersion: "1.0",
      generation: 1,
      closure: "hidden",
      lifetimeMs: 250,
      degraded: true,
      tasks: {
        started: 3,
        completed: ["contracts"],
        failed: ["recap"],
        timedOut: ["fortune"],
        cancelled: [],
      },
      resourcesCleared: { timers: 1, animationFrames: 0 },
    });
    expect(Object.isFrozen(receipts[0])).toBe(true);
    expect(sessions.receipt()).toBe(receipts[0]);
  });

  test("cancels animation frames and resolves deadline failures honestly", async () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 42),
    );
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const sessions = new PostMatchSessionOrchestrator();
    const scope = sessions.begin();
    scope.animationFrame(vi.fn());
    const never = scope.settle(new Promise<string>(() => undefined), 250);

    await vi.advanceTimersByTimeAsync(250);
    expect(await never).toBeUndefined();
    sessions.cancel();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(sessions.snapshot()).toMatchObject({
      active: false,
      timers: 0,
      animationFrames: 0,
    });
  });
});
