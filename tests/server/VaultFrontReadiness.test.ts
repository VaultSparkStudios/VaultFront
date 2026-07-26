import { describe, expect, it } from "vitest";
import { canonicalReleaseGateNames } from "../../src/server/ReleaseEvidenceContract";
import { buildStateScopeLedger } from "../../src/server/StateScopeLedger";
import { buildVaultFrontReadiness } from "../../src/server/VaultFrontReadiness";

describe("buildVaultFrontReadiness", () => {
  it("preserves scoped runtime health evidence without implying fleet health", () => {
    const payload = buildVaultFrontReadiness({
      healthy: true,
      processRole: "worker",
      workerId: 3,
      healthEvidence: {
        scope: "process-local-worker",
        httpRequest: "responding",
        ipcConnected: true,
        ipcWatermark: {
          healthy: true,
          lastMasterMessageAt: 12_100,
          ageMs: 150,
          maxAgeMs: 2_000,
        },
        gameLoop: {
          healthy: true,
          lastTickCompletedAt: 12_000,
          ageMs: 250,
          maxAgeMs: 3_500,
        },
      },
    });

    expect(payload.healthEvidence.scope).toBe("process-local-worker");
    expect(payload.healthEvidence.gameLoop?.ageMs).toBe(250);
    expect(payload.serverStatus).toBe("ready");
  });
  it("keeps healthy server status separate from blocked release evidence", () => {
    const payload = buildVaultFrontReadiness({
      healthy: true,
      processRole: "master",
      replayIntegrity: {
        status: "missing",
        canSignAndVerify: false,
        evidence: "Replay integrity key is missing.",
      },
    });

    expect(payload.project).toBe("vaultfront");
    expect(payload.status).toBe("ready");
    expect(payload.serverStatus).toBe("ready");
    expect(payload.releaseStatus).toBe("blocked");
    expect(payload.releaseBlockers).toContain(
      "Replay integrity key is missing.",
    );
    expect(payload.checks.serverHealth).toBe("pass");
    expect(payload.testSurfaces.length).toBeGreaterThanOrEqual(4);
    expect(
      payload.launchGates.some((gate) => gate.gate === "revenue-signal"),
    ).toBe(true);
    expect(payload.checks.revenueSignal).toBe("warn");
    expect(payload.checks.playtestPulse).toBe("warn");
  });

  it("marks the server health check failed when the process is degraded", () => {
    const payload = buildVaultFrontReadiness({
      healthy: false,
      processRole: "worker",
      workerId: 2,
    });

    expect(payload.status).toBe("degraded");
    expect(payload.workerId).toBe(2);
    expect(payload.checks.serverHealth).toBe("fail");
  });

  it("blocks a configured database failure instead of claiming durable state", () => {
    const persistence = buildStateScopeLedger({
      configured: true,
      state: "failed",
      observedAt: "2026-07-20T01:00:00.000Z",
      connectedAt: null,
      failureCode: "ECONNREFUSED",
      fallbackAllowed: false,
      scope: "process-local-worker",
    });
    const payload = buildVaultFrontReadiness({
      healthy: true,
      processRole: "worker",
      persistence,
    });

    expect(payload.releaseBlockers).toContain(
      "Configured database connection failed.",
    );
    expect(payload.checks.persistence).toBe("fail");
  });

  it("warns when release-critical state is explicitly process-local", () => {
    const persistence = buildStateScopeLedger({
      configured: false,
      state: "disabled",
      observedAt: "2026-07-20T01:00:00.000Z",
      connectedAt: null,
      failureCode: null,
      fallbackAllowed: true,
      scope: "process-local-worker",
    });
    const payload = buildVaultFrontReadiness({
      healthy: true,
      processRole: "worker",
      persistence,
    });

    expect(payload.releaseWarnings).toContain(
      "Release-critical stores are process-local: player-stats, certified-outcomes, achievements, clans, tournaments, playtest-pulse.",
    );
    expect(payload.checks.persistence).toBe("warn");
  });

  it("passes the playtest pulse gate when recent alpha signal is attached", () => {
    const payload = buildVaultFrontReadiness({
      healthy: true,
      processRole: "worker",
      workerId: 1,
      playtestPulse: {
        status: "ready",
        score: 64,
        freshness: {
          lastEventAt: "2026-06-03T20:00:00.000Z",
          ageMinutes: 2,
        },
        actionInsights: [
          "Pulse is broad enough for this alpha gate; continue with a focused rivalry/rematch playtest.",
        ],
        alphaGate: {
          status: "ready",
          passLabel: "Alpha gate passed.",
          nextCheck: "Alpha gate evidence is complete.",
        },
      },
    });

    expect(payload.checks.playtestPulse).toBe("pass");
    expect(payload.playtestPulse?.score).toBe(64);
    expect(
      payload.launchGates.find((gate) => gate.gate === "playtest-pulse")
        ?.evidence,
    ).toContain("alpha gate ready");
    expect(
      payload.launchGates.find((gate) => gate.gate === "playtest-pulse")
        ?.evidence,
    ).toContain("Alpha gate passed.");
  });

  it("warns when pulse score is ready but alpha gate evidence is incomplete", () => {
    const payload = buildVaultFrontReadiness({
      healthy: true,
      processRole: "worker",
      workerId: 1,
      playtestPulse: {
        status: "ready",
        score: 64,
        freshness: {
          lastEventAt: "2026-06-13T20:00:00.000Z",
          ageMinutes: 2,
        },
        alphaGate: {
          status: "warming",
          passLabel: "4/5 alpha gate checks passing.",
          nextCheck: "Drive Rival Challenge action rate to 25%+.",
        },
      },
    });

    expect(payload.checks.playtestPulse).toBe("warn");
    expect(
      payload.launchGates.find((gate) => gate.gate === "playtest-pulse")
        ?.evidence,
    ).toContain("Drive Rival Challenge action rate");
    expect(
      payload.launchGates.find((gate) => gate.gate === "playtest-pulse")
        ?.evidence,
    ).toContain("4/5 alpha gate checks passing.");
  });

  it("passes the revenue signal gate when live supporter evidence is supplied", () => {
    const payload = buildVaultFrontReadiness({
      healthy: true,
      processRole: "master",

      revenueSignal: {
        status: "observed",
        observedAt: "2026-06-05T14:00:00.000Z",
      },
    });

    expect(payload.checks.revenueSignal).toBe("pass");
    expect(
      payload.launchGates.find((gate) => gate.gate === "revenue-signal")
        ?.evidence,
    ).toContain("2026-06-05T14:00:00.000Z");
  });
  it("reports release ready only when live verification evidence is attached", () => {
    const payload = buildVaultFrontReadiness({
      healthy: true,
      processRole: "worker",
      workerId: 0,
      replayIntegrity: {
        status: "configured",
        canSignAndVerify: true,
        evidence: "Replay HMAC key is configured for this process.",
      },
      rightsEvidence: { status: "verified", path: "LICENSE and LICENSING.md" },
      verification: {
        tests: { status: "verified", observedAt: "2026-07-16T12:00:00.000Z" },
        productionBuild: {
          status: "verified",
          observedAt: "2026-07-16T12:05:00.000Z",
        },
      },
      revenueSignal: { status: "observed" },
      playtestPulse: {
        status: "ready",
        score: 80,
        freshness: { lastEventAt: "2026-07-16T12:10:00.000Z", ageMinutes: 1 },
        alphaGate: {
          status: "ready",
          passLabel: "Alpha gate passed.",
          nextCheck: "Preserve freshness.",
        },
      },
      releaseEvidence: {
        now: Date.parse("2026-07-16T12:15:00.000Z"),
        observations: Object.fromEntries(
          canonicalReleaseGateNames.map((gate) => [
            gate,
            {
              status: "verified" as const,
              observedAt: "2026-07-16T12:10:00.000Z",
              source: `test:${gate}`,
              digest: `sha256:${gate}`,
            },
          ]),
        ),
      },
    });

    expect(payload.serverStatus).toBe("ready");
    expect(payload.releaseStatus).toBe("ready");
    expect(payload.releaseBlockers).toEqual([]);
    expect(payload.releaseWarnings).toEqual([]);
    expect(payload.checks.testSurfacesRegistered).toBe("verified");
    expect(payload.evidence.verified).toContain(
      "Fresh production build run attached.",
    );
  });
  it("blocks missing rights and exposes the metered AI hard cap", () => {
    const payload = buildVaultFrontReadiness({
      healthy: true,
      processRole: "worker",
      rightsEvidence: { status: "missing", path: "LICENSE and LICENSING.md" },
      remoteAi: {
        enabled: true,
        keyConfigured: true,
        maxCallsPerHour: 10,
        callsUsed: 2,
        callsRemaining: 8,
        enforcementScope: "process-local-per-worker",
        windowStartedAt: 1_000,
        callsByFeature: { coach: 2 },
        providerBoundReservations: 2,
        deniedReservations: 0,
        costProfile: "metered-hard-cap",
        reason: "ready",
      },
    });

    expect(payload.releaseBlockers).toContain(
      "Rights provenance evidence is missing.",
    );
    expect(payload.remoteAi.costProfile).toBe("metered-hard-cap");
    expect(
      payload.launchGates.find((gate) => gate.gate === "free-tier-cost")
        ?.evidence,
    ).toContain("hard cap of 10 calls/hour");
  });
});
