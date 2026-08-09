import { describe, expect, test } from "vitest";
import {
  ServerCrashStore,
  truncateServerCrashMessage,
} from "../../src/server/ServerCrashStore";

describe("ServerCrashStore (S99 second-order follow-up to audit #183)", () => {
  test("summarizes by process+kind+message signature, most frequent first", () => {
    const store = new ServerCrashStore();
    for (let i = 0; i < 3; i++) {
      store.record({
        process: "worker",
        processId: 100 + i,
        kind: "uncaughtException",
        message: "TypeError: x is not a function",
        at: Date.now(),
      });
    }
    store.record({
      process: "master",
      processId: 1,
      kind: "unhandledRejection",
      message: "Network request failed",
      at: Date.now(),
    });

    const summary = store.summary();
    expect(summary.storage).toBe("process-local");
    expect(summary.total).toBe(4);
    expect(summary.topSignatures[0]).toMatchObject({
      signature: "worker:uncaughtException:TypeError: x is not a function",
      count: 3,
    });
  });

  test("bounds retained events so memory cannot grow unbounded", () => {
    const store = new ServerCrashStore();
    for (let i = 0; i < 600; i++) {
      store.record({
        process: "worker",
        processId: i,
        kind: "uncaughtException",
        message: `error-${i}`,
        at: Date.now(),
      });
    }
    expect(store.summary().total).toBeLessThanOrEqual(500);
  });
});

describe("truncateServerCrashMessage", () => {
  test("passes short messages through unchanged", () => {
    expect(truncateServerCrashMessage("short error")).toBe("short error");
  });

  test("truncates long messages to 500 characters plus an ellipsis", () => {
    const long = "x".repeat(600);
    const truncated = truncateServerCrashMessage(long);
    expect(truncated).toHaveLength(503);
    expect(truncated.endsWith("...")).toBe(true);
  });
});
