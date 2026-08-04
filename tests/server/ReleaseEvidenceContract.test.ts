import { describe, expect, it } from "vitest";
import {
  canonicalReleaseGateDefinitions as buildGateDefinitions,
  evaluateCanonicalReleaseGates as evaluateBuildReleaseGates,
} from "../../scripts/generate-release-evidence.mjs";
import {
  canonicalReleaseGateNames,
  evaluateCanonicalReleaseEvidence,
} from "../../src/server/ReleaseEvidenceContract";
import {
  buildCanonicalReleaseObservation,
  canonicalReleaseGateCatalog,
  canonicalReleaseGateFingerprint,
  validateReleaseGateCatalog,
} from "../../src/shared/ReleaseGateCatalog";

function verifiedObservations(observedAt: string) {
  return Object.fromEntries(
    canonicalReleaseGateCatalog.map((definition) => {
      const base = {
        status: "verified" as const,
        observedAt,
        source: `probe:${definition.id}`,
      };
      const semantic =
        definition.semantic === "health"
          ? { ...base, httpStatus: 200, healthy: true }
          : definition.semantic === "rollback"
            ? {
                ...base,
                drillCompleted: true,
                restoredHealth: true,
                imageDigest: `sha256:${"b".repeat(64)}`,
              }
            : definition.semantic === "revenue"
              ? {
                  ...base,
                  live: true,
                  eventType: "checkout" as const,
                  amountCents: 500,
                }
              : base;
      const observation = ["rollback", "revenue"].includes(definition.semantic)
        ? buildCanonicalReleaseObservation(definition.id, semantic)
        : { ...semantic, digest: `sha256:${"a".repeat(64)}` };
      return [definition.id, observation];
    }),
  );
}

describe("canonical release evidence", () => {
  const now = Date.parse("2026-07-16T12:00:00.000Z");

  it("fails closed when external or alpha evidence is absent", () => {
    const evidence = evaluateCanonicalReleaseEvidence({ now });
    expect(evidence.status).toBe("blocked");
    expect(evidence.gates).toHaveLength(canonicalReleaseGateNames.length);
    expect(evidence.blockers).toHaveLength(canonicalReleaseGateNames.length);
  });

  it("rejects stale and provenance-free verified labels", () => {
    const evidence = evaluateCanonicalReleaseEvidence({
      now,
      alphaGateStatus: "ready",
      observations: {
        staging: {
          status: "verified",
          observedAt: "2026-07-10T12:00:00.000Z",
          source: "staging-smoke",
          digest: "sha256:old",
        },
        footerManifest: {
          status: "verified",
          observedAt: "2026-07-16T11:00:00.000Z",
        },
      },
    });
    expect(
      evidence.gates.find((gate) => gate.gate === "staging")?.detail,
    ).toContain("fresh timestamp");
    expect(
      evidence.gates.find((gate) => gate.gate === "footerManifest")?.detail,
    ).toContain("source or digest");
  });

  it("becomes ready only when every named gate has fresh sourced evidence", () => {
    const observations = verifiedObservations("2026-07-16T11:30:00.000Z");
    expect(
      evaluateCanonicalReleaseEvidence({
        now,
        alphaGateStatus: "ready",
        observations,
      }),
    ).toMatchObject({ status: "ready", blockers: [] });
  });

  it("never lets a generic alpha observation override authenticated live readiness", () => {
    const observations = verifiedObservations("2026-07-16T11:30:00.000Z");
    const blocked = evaluateCanonicalReleaseEvidence({
      now,
      alphaGateStatus: "blocked",
      observations,
    });
    const alpha = blocked.gates.find(
      (gate) => gate.gate === "alphaHumanEvidence",
    );

    expect(alpha).toMatchObject({
      status: "block",
      evidenceStatus: "missing",
      source: "playtestPulse.alphaGate",
      digest: null,
    });
    expect(alpha?.detail).toContain(
      "generic release observations cannot satisfy this gate",
    );
    expect(blocked.status).toBe("blocked");
  });

  it("keeps build and runtime projections on one catalog and semantic evaluator", () => {
    expect(canonicalReleaseGateNames).toEqual(
      canonicalReleaseGateCatalog.map(({ id }) => id),
    );
    expect(buildGateDefinitions).toEqual(
      canonicalReleaseGateCatalog.map(({ id, label }) => [id, label]),
    );
    const observations = verifiedObservations("2026-07-16T11:30:00.000Z");
    const runtime = evaluateCanonicalReleaseEvidence({
      now,
      alphaGateStatus: "ready",
      observations,
    });
    const build = evaluateBuildReleaseGates(observations, {
      now,
      alphaGateStatus: "ready",
    });

    expect(runtime).toEqual(build);
    expect(runtime.catalogFingerprint).toBe(canonicalReleaseGateFingerprint);
    expect(runtime.status).toBe("ready");
  });

  it("detects duplicate and semantic catalog tampering", () => {
    type MutableGateDefinition = {
      id: string;
      label: string;
      semantic: string;
    };
    const mutableCatalog = () =>
      structuredClone(canonicalReleaseGateCatalog) as MutableGateDefinition[];
    const duplicate = mutableCatalog();
    duplicate.push({ ...duplicate[0] });
    const semanticTamper = mutableCatalog();
    const health = semanticTamper.find(
      (definition) => definition.semantic === "health",
    )!;
    health.semantic = "provenance";
    const labelTamper = mutableCatalog();
    labelTamper[0].label = "Tampered staging label";

    expect(validateReleaseGateCatalog(duplicate)).toMatchObject({ ok: false });
    expect(validateReleaseGateCatalog(semanticTamper)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("semantic health must be owned by exactly one"),
      ]),
    });
    expect(validateReleaseGateCatalog(labelTamper)).toMatchObject({ ok: true });
    expect(validateReleaseGateCatalog(labelTamper).fingerprint).not.toBe(
      canonicalReleaseGateFingerprint,
    );
  });
});
