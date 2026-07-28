import { describe, expect, it } from "vitest";
import { buildWorkerHealthHeartbeat } from "../../src/server/WorkerHealthHeartbeat";

const healthyInput = {
  gameLoop: {
    scope: "process-local-worker" as const,
    healthy: true,
    lastTickCompletedAt: 9_900,
    ageMs: 100,
    maxAgeMs: 3_500,
  },
  ipc: {
    scope: "process-local-worker" as const,
    connected: true,
    healthy: true,
    lastMasterMessageAt: 9_900,
    ageMs: 100,
    maxAgeMs: 2_000,
  },
  database: {
    configured: true,
    state: "ready" as const,
    observedAt: "2026-07-28T00:00:00.000Z",
    connectedAt: "2026-07-28T00:00:00.000Z",
    failureCode: null,
    fallbackAllowed: false,
    scope: "process-local-worker" as const,
  },
};

describe("worker health heartbeat", () => {
  it("emits healthy bounded evidence only when every source is healthy", () => {
    expect(buildWorkerHealthHeartbeat(healthyInput, 10_000)).toEqual({
      observedAt: 10_000,
      healthy: true,
      reasons: [],
    });
  });

  it("preserves bounded source reasons without double-counting stale disconnected IPC", () => {
    expect(
      buildWorkerHealthHeartbeat(
        {
          ...healthyInput,
          gameLoop: { ...healthyInput.gameLoop, healthy: false },
          ipc: { ...healthyInput.ipc, connected: false, healthy: false },
          database: {
            ...healthyInput.database,
            state: "failed",
            failureCode: "connect-failed",
          },
        },
        10_000,
      ),
    ).toEqual({
      observedAt: 10_000,
      healthy: false,
      reasons: ["game-loop-stale", "ipc-disconnected", "persistence-failed"],
    });
  });
});
