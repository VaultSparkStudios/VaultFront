import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerTelemetryHandle,
  resetTelemetryLifecycleForTests,
  shutdownTelemetry,
} from "../../src/server/TelemetryLifecycle";

describe("telemetry lifecycle", () => {
  beforeEach(() => resetTelemetryLifecycleForTests());

  it("flushes then shuts down each provider exactly once across repeated signals", async () => {
    const calls: string[] = [];
    registerTelemetryHandle("logs", {
      forceFlush: async () => void calls.push("flush"),
      shutdown: async () => void calls.push("shutdown"),
    });
    const first = shutdownTelemetry(100);
    const second = shutdownTelemetry(100);
    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({
      attempted: 1,
      completed: 1,
      timedOut: false,
    });
    expect(calls).toEqual(["flush", "shutdown"]);
  });

  it("returns at the bounded deadline without throwing on a stuck exporter", async () => {
    vi.useFakeTimers();
    registerTelemetryHandle("metrics", {
      forceFlush: () => new Promise(() => undefined),
      shutdown: async () => undefined,
    });
    const result = shutdownTelemetry(20);
    await vi.advanceTimersByTimeAsync(20);
    await expect(result).resolves.toMatchObject({
      timedOut: true,
      attempted: 1,
    });
    vi.useRealTimers();
  });

  it("still shuts down a provider when its flush fails", async () => {
    const shutdown = vi.fn(async () => undefined);
    registerTelemetryHandle("logs", {
      forceFlush: async () => {
        throw new Error("collector unavailable");
      },
      shutdown,
    });
    await expect(shutdownTelemetry(100)).resolves.toMatchObject({
      completed: 0,
      failures: ["logs.forceFlush: collector unavailable"],
      timedOut: false,
    });
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
