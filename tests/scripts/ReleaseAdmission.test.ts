import { describe, expect, it } from "vitest";
import { createReleaseAdmission } from "../../scripts/lib/release-admission.mjs";

const now = Date.parse("2026-08-16T12:00:00.000Z");
const repository = "VaultSparkStudios/VaultFront";
const origin = "https://staging.vaultfront.io";
const sha = "a".repeat(40);
const required = [
  "staging",
  "healthObservation",
  "stagingParity",
  "contactEmail",
  "obeliskIdentity",
  "themeReadability",
  "footerManifest",
  "rollbackObservation",
  "revenueObservation",
  "founderApproval",
  "alphaHumanEvidence",
];

function fixture() {
  return {
    readiness: {
      project: "vaultfront",
      status: "ready",
      serverStatus: "ready",
      releaseStatus: "ready",
      generatedAt: new Date(now - 1_000).toISOString(),
      processRole: "master",
      playtestPulse: { alphaGate: { status: "ready" } },
      canonicalRelease: {
        status: "ready",
        blockers: [],
        catalogFingerprint: `sha256:${"b".repeat(64)}`,
        gates: required.map((gate) => ({
          gate,
          status: "pass",
          digest: `sha256:${"c".repeat(64)}`,
        })),
      },
    },
    revision: sha,
    attestation: {
      repository,
      environment: "staging",
      origin,
      gitSha: sha,
      imageDigest: `sha256:${"d".repeat(64)}`,
      attestationDigest: `sha256:${"e".repeat(64)}`,
    },
    repository,
    origin,
  };
}

describe("release admission", () => {
  it("binds a fully green canonical readiness snapshot to the exact image", () => {
    expect(createReleaseAdmission(fixture(), { now })).toMatchObject({
      ok: true,
      receipt: {
        gitSha: sha,
        imageDigest: `sha256:${"d".repeat(64)}`,
        admissionDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
    });
  });

  it("fails closed for one blocked gate, drifted revision, or stale evidence", () => {
    const blocked = fixture();
    blocked.readiness.canonicalRelease.gates[3]!.status = "block";
    expect(createReleaseAdmission(blocked, { now })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["gate-blocked:contactEmail"]),
    });

    const drifted = fixture();
    drifted.revision = "f".repeat(40);
    expect(createReleaseAdmission(drifted, { now })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["revision-attestation-mismatch"]),
    });

    const stale = fixture();
    stale.readiness.generatedAt = new Date(now - 10 * 60_000).toISOString();
    expect(createReleaseAdmission(stale, { now })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["readiness-stale"]),
    });
  });
});
