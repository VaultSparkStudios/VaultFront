import { describe, expect, it } from "vitest";
import { buildRuntimeIntegrityPassport } from "../../src/server/RuntimeIntegrityPassport";
import { buildStateScopeLedger } from "../../src/server/StateScopeLedger";

const sseSnapshot = {
  scope: "process-local-worker" as const,
  policy: {
    maxSubscribersPerGame: 32,
    maxSubscribersPerWorker: 256,
    maxSubscribersPerIp: 8,
    maxQueuedEventsPerClient: 16,
    maxQueuedBytesPerClient: 32 * 1024,
    drainTimeoutMs: 5_000,
  },
  live: {
    subscribers: 0,
    games: 0,
    blockedSubscribers: 0,
    queuedEvents: 0,
    queuedBytes: 0,
  },
  counters: {
    accepted: 0,
    rejectedPerGame: 0,
    rejectedPerWorker: 0,
    rejectedPerIp: 0,
    backpressureSignals: 0,
    queuedEvents: 0,
    slowConsumerEvictions: 0,
    writeFailures: 0,
  },
};

const base = {
  workerId: 2,
  observedAt: "2026-07-17T01:00:00.000Z",
  health: {
    httpResponding: true,
    ipc: { connected: true, healthy: true, ageMs: 100, maxAgeMs: 2_000 },
    gameLoop: { healthy: true, ageMs: 200, maxAgeMs: 3_500 },
  },
  experimentIntegrity: {
    accepted: 20,
    rejected: 0,
    rejectedByReason: {
      "duplicate-event": 0,
      "variant-mismatch": 0,
      "invalid-weight": 0,
    },
    trackedEventIds: 20,
  },
  remoteAi: {
    enabled: false,
    keyConfigured: false,
    maxCallsPerHour: 0,
    callsUsed: 0,
    callsRemaining: 0,
    enforcementScope: "process-local-per-worker" as const,
    windowStartedAt: 1,
    callsByFeature: {},
    providerBoundReservations: 0,
    deniedReservations: 0,
    completedCalls: 0,
    failedCalls: 0,
    timedOutCalls: 0,
    cancelledCalls: 0,
    costProfile: "cost-neutral" as const,
    reason: "disabled" as const,
  },
  websocketPolicy: {
    lobbyMaxPayloadBytes: 64 * 1024,
    spectatorMaxPayloadBytes: 64 * 1024,
    lobbyMaxBufferedBytes: 256 * 1024,
    spectatorMaxBufferedBytes: 256 * 1024,
    maxSpectatorsPerGame: 128,
    maxSpectatorsPerWorker: 1_024,
  },
  ssePolicy: { streaming: sseSnapshot, narrator: sseSnapshot },
  stateScopeLedger: buildStateScopeLedger({
    configured: true,
    state: "ready",
    observedAt: "2026-07-17T01:00:00.000Z",
    connectedAt: "2026-07-17T00:59:00.000Z",
    failureCode: null,
    fallbackAllowed: false,
    scope: "process-local-worker",
  }),
};

describe("Runtime Integrity Passport", () => {
  it("is deterministic and changes its digest on evidence tamper", () => {
    const first = buildRuntimeIntegrityPassport(base);
    const repeat = buildRuntimeIntegrityPassport(base);
    const tampered = buildRuntimeIntegrityPassport({
      ...base,
      health: { ...base.health, ipc: { ...base.health.ipc, ageMs: 101 } },
    });

    expect(first.status).toBe("warn");
    expect(first.warnings).toContain("release-critical-state-is-process-local");
    expect(first.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(repeat.evidenceDigest).toBe(first.evidenceDigest);
    expect(tampered.evidenceDigest).not.toBe(first.evidenceDigest);
  });

  it("fails a configured database outage and reports bounded SSE evidence", () => {
    const failed = buildRuntimeIntegrityPassport({
      ...base,
      stateScopeLedger: buildStateScopeLedger({
        configured: true,
        state: "failed",
        observedAt: "2026-07-17T01:00:00.000Z",
        connectedAt: null,
        failureCode: "ConnectionError",
        fallbackAllowed: false,
        scope: "process-local-worker",
      }),
    });

    expect(failed.status).toBe("fail");
    expect(failed.failures).toContain("configured-database-failed");
    expect(failed.ssePolicy.streaming.policy.maxQueuedBytesPerClient).toBe(
      32 * 1024,
    );
  });

  it("fails stale serving watermarks and warns on elevated rejection rate", () => {
    const failed = buildRuntimeIntegrityPassport({
      ...base,
      health: {
        ...base.health,
        ipc: { ...base.health.ipc, healthy: false, ageMs: 5_000 },
      },
      experimentIntegrity: {
        ...base.experimentIntegrity,
        accepted: 1,
        rejected: 1,
      },
    });

    expect(failed.status).toBe("fail");
    expect(failed.failures).toContain("ipc-watermark-stale");
    expect(failed.warnings).toContain("experiment-rejection-rate-elevated");
  });
});
