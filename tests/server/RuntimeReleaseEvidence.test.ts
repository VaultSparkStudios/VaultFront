import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCanonicalReleaseObservation } from "../../src/shared/ReleaseGateCatalog";
import {
  signRuntimeReleaseClaim,
  verifyRuntimeReleaseEvidenceBundle,
} from "../../src/shared/runtime-release-evidence.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const now = Date.parse("2026-08-14T05:00:00.000Z");
const runtime = {
  environment: "staging",
  origin: "https://staging.vaultfront.io",
  gitSha: "a".repeat(40),
  imageDigest: `sha256:${"b".repeat(64)}`,
};
const policy = {
  authorities: {
    "staging-v1": {
      environment: "staging",
      origin: runtime.origin,
      publicKey: publicKeyPem,
      gates: ["staging", "healthObservation"],
    },
  },
};

function claim(gate = "staging") {
  const base = {
    status: "verified",
    observedAt: "2026-08-14T04:58:00.000Z",
    source: "github-actions:deploy:123",
  };
  const observation = buildCanonicalReleaseObservation(
    gate,
    gate === "healthObservation"
      ? { ...base, httpStatus: 200, healthy: true }
      : base,
  );
  return signRuntimeReleaseClaim(
    {
      keyId: "staging-v1",
      gate,
      project: "vaultfront",
      repository: "VaultSparkStudios/vaultfront",
      ...runtime,
      source: {
        workflow: ".github/workflows/deploy.yml",
        runId: 123,
        runAttempt: 1,
        artifactDigest: `sha256:${"c".repeat(64)}`,
      },
      observedAt: "2026-08-14T04:58:00.000Z",
      expiresAt: "2026-08-14T05:15:00.000Z",
      observation,
    },
    privateKeyPem,
  );
}

describe("runtime release evidence", () => {
  it("admits an authorized exact-runtime claim", () => {
    const result = verifyRuntimeReleaseEvidenceBundle(
      { schemaVersion: 1, claims: [claim()] },
      { policy, runtime, now },
    );
    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(result.observations.staging.status).toBe("verified");
  });

  it.each([
    ["signature tamper", (value: any) => (value.observation.source = "forged")],
    [
      "wrong image",
      (value: any) => (value.imageDigest = `sha256:${"d".repeat(64)}`),
    ],
    ["gate escalation", (value: any) => (value.gate = "revenueObservation")],
    [
      "expired claim",
      (value: any) => (value.expiresAt = "2026-08-14T04:59:00.000Z"),
    ],
  ])("fails closed on %s", (_label, mutate) => {
    const value = claim();
    mutate(value);
    const result = verifyRuntimeReleaseEvidenceBundle(
      { schemaVersion: 1, claims: [value] },
      { policy, runtime, now },
    );
    expect(result.ok).toBe(false);
    expect(result.observations).toEqual({});
  });

  it("rejects a re-digested semantic mutation with a stale signature", () => {
    const value = claim();
    const semantic: Record<string, unknown> = { ...value.observation };
    delete semantic.digest;
    value.observation = buildCanonicalReleaseObservation("staging", {
      ...semantic,
      source: "github-actions:deploy:forged",
    });
    const result = verifyRuntimeReleaseEvidenceBundle(
      { schemaVersion: 1, claims: [value] },
      { policy, runtime, now },
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("staging:signature-mismatch");
    expect(result.observations).toEqual({});
  });

  it("omits conflicting duplicate claims instead of choosing a winner", () => {
    const result = verifyRuntimeReleaseEvidenceBundle(
      { schemaVersion: 1, claims: [claim(), claim()] },
      { policy, runtime, now },
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("staging:conflicting-claims");
    expect(result.observations).toEqual({});
  });
});
