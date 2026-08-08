import { describe, expect, test } from "vitest";
import { ClientCrashStore } from "../../src/server/ClientCrashStore";

describe("ClientCrashStore (S99 audit #183)", () => {
  test("summarizes by kind+message signature, most frequent first", () => {
    const store = new ClientCrashStore();
    for (let i = 0; i < 3; i++) {
      store.record({
        actorKey: `actor-${i}`,
        kind: "error",
        message: "TypeError: x is not a function",
        stackHash: "abc123",
        tick: null,
        gameId: null,
        at: Date.now(),
      });
    }
    store.record({
      actorKey: "actor-9",
      kind: "unhandledrejection",
      message: "Network request failed",
      stackHash: null,
      tick: null,
      gameId: null,
      at: Date.now(),
    });

    const summary = store.summary();
    expect(summary.storage).toBe("process-local");
    expect(summary.total).toBe(4);
    expect(summary.topSignatures[0]).toMatchObject({
      signature: "error:TypeError: x is not a function",
      count: 3,
    });
  });

  test("bounds retained events so memory cannot grow unbounded", () => {
    const store = new ClientCrashStore();
    for (let i = 0; i < 600; i++) {
      store.record({
        actorKey: `actor-${i}`,
        kind: "error",
        message: `error-${i}`,
        stackHash: null,
        tick: null,
        gameId: null,
        at: Date.now(),
      });
    }
    expect(store.summary().total).toBeLessThanOrEqual(500);
  });
});
