import { describe, expect, test } from "vitest";
import {
  buildStateScopeLedger,
  inspectStateScopeLedgerIntegrity,
  stateScopeCatalogDigest,
  type StateScopeLedgerEntry,
} from "../../src/server/StateScopeLedger";

const posture = (
  state: "disabled" | "ready" | "failed",
  configured = state !== "disabled",
) => ({
  configured,
  state,
  observedAt: "2026-07-24T00:00:00.000Z",
  connectedAt: state === "ready" ? "2026-07-24T00:00:00.000Z" : null,
  failureCode: state === "failed" ? "connection-error" : null,
  fallbackAllowed: !configured,
  scope: "process-local-worker" as const,
});

describe("StateScopeLedger", () => {
  test("declares PlaytestEvidenceStore PostgreSQL-capable and changes only effective scope", () => {
    const local = buildStateScopeLedger(posture("disabled"));
    const ready = buildStateScopeLedger(posture("ready"));
    const localPulse = local.entries.find(
      (entry) => entry.store === "playtest-pulse",
    );
    const readyPulse = ready.entries.find(
      (entry) => entry.store === "playtest-pulse",
    );

    expect(local.integrity).toEqual({ ok: true, errors: [] });
    expect(local.catalogDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(ready.catalogDigest).toBe(local.catalogDigest);
    expect(localPulse).toMatchObject({
      owner: "PlaytestEvidenceStore",
      capability: "postgres-optional",
      effectiveScope: "process",
    });
    expect(readyPulse?.effectiveScope).toBe("postgres");
    expect(ready.summary.volatileReleaseCriticalStores).not.toContain(
      "playtest-pulse",
    );
    expect(ready.summary.releasePersistenceStatus).toBe("pass");
  });

  test("declares the privacy-bounded feedback store in every effective scope", () => {
    const local = buildStateScopeLedger(posture("disabled"));
    const ready = buildStateScopeLedger(posture("ready"));
    expect(
      local.entries.find((entry) => entry.store === "match-feedback"),
    ).toMatchObject({
      owner: "MatchFeedbackStore",
      effectiveScope: "process",
      retention: "30 days in PostgreSQL and process-local fallback",
      releaseCritical: false,
    });
    expect(
      ready.entries.find((entry) => entry.store === "match-feedback")
        ?.effectiveScope,
    ).toBe("postgres");
  });

  test("blocks configured database failure without pretending fallback is durable", () => {
    const failed = buildStateScopeLedger(posture("failed"));
    expect(failed.summary.configuredDatabaseFailure).toBe(true);
    expect(failed.summary.releasePersistenceStatus).toBe("block");
    expect(
      failed.entries.find((entry) => entry.store === "playtest-pulse")
        ?.effectiveScope,
    ).toBe("process");
  });

  test("rejects contradictory capability metadata", () => {
    const invalid: StateScopeLedgerEntry = {
      store: "bad-store",
      owner: "BadStore",
      capability: "postgres-optional",
      declaredScope: "process",
      durability: "volatile",
      replication: "none",
      retention: "none",
      recovery: "none",
      probeOwner: "test",
      releaseCritical: true,
    };
    expect(inspectStateScopeLedgerIntegrity([invalid])).toEqual({
      ok: false,
      errors: ["bad-store: postgres capability contradicts scope"],
    });
    expect(stateScopeCatalogDigest([invalid])).not.toBe(
      buildStateScopeLedger(posture("disabled")).catalogDigest,
    );
  });
});
