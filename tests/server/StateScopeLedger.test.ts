import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import {
  STATE_STORE_SOURCE_INVENTORY,
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
    expect(ready.summary.volatileReleaseCriticalStores).toContain("replays");
    expect(ready.summary.releasePersistenceStatus).toBe("warn");
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
      kind: "store",
      sourceFile: "src/server/BadStore.ts",
      runtimeExport: "badStore",
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

  test("accounts for every exported runtime Store singleton exactly once", () => {
    const root = join(process.cwd(), "src", "server");
    const sourceFiles = readdirSync(root, { recursive: true })
      .filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.endsWith(".ts"),
      )
      .map((entry) => join(root, entry));
    const discovered = new Map<
      string,
      { owner: string | null; sourceFile: string }
    >();
    const singletonPattern =
      /export const (\w*[sS]tore)\s*=\s*(?:new\s+(\w+Store)\s*\(|\{)/g;
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(singletonPattern)) {
        discovered.set(match[1], {
          owner: match[2] ?? null,
          sourceFile: relative(process.cwd(), file).replace(/\\/g, "/"),
        });
      }
    }

    const registered = new Map(
      STATE_STORE_SOURCE_INVENTORY.map((entry) => [entry.runtimeExport, entry]),
    );
    expect(
      [...discovered.keys()].filter(
        (runtimeExport) => !registered.has(runtimeExport),
      ),
    ).toEqual([]);
    for (const [runtimeExport, actual] of discovered) {
      const expected = registered.get(runtimeExport)!;
      expect(expected.sourceFile).toBe(actual.sourceFile);
      if (actual.owner) expect(expected.owner).toBe(actual.owner);
    }
    for (const entry of STATE_STORE_SOURCE_INVENTORY) {
      const source = readFileSync(
        join(process.cwd(), entry.sourceFile),
        "utf8",
      );
      expect(source).toMatch(
        new RegExp(`export const ${entry.runtimeExport}\\s*=`),
      );
    }
  });
});
