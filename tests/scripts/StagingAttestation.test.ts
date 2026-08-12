import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createStagingAttestation,
  verifyStagingAttestation,
} from "../../scripts/lib/staging-attestation.mjs";

const repository = "VaultSparkStudios/VaultFront";
const sha = "a".repeat(40);
const run = {
  id: 42,
  status: "completed",
  conclusion: "success",
  head_sha: sha,
  path: ".github/workflows/deploy.yml",
  event: "workflow_dispatch",
  head_branch: "main",
  run_attempt: 1,
  repository: { full_name: repository },
};

function productSmoke(origin = "https://staging.example.com") {
  const core = {
    schemaVersion: 1,
    origin,
    expectedRevision: sha,
    observedAt: "2026-08-03T12:00:00.000Z",
    pass: true,
    checks: [{ id: "exact-revision", pass: true, evidence: {} }],
  };
  return JSON.stringify({
    ...core,
    receiptDigest: `sha256:${createHash("sha256")
      .update(JSON.stringify(core))
      .digest("hex")}`,
  });
}

describe("staging attestation", () => {
  it("admits fresh same-repository successful staging evidence", () => {
    const observedAt = "2026-08-03T12:00:00.000Z";
    const attestation = createStagingAttestation({
      repository,
      workflowRunId: 42,
      workflowRunAttempt: 1,
      gitSha: sha,
      origin: "https://staging.example.com",
      imageDigest: `sha256:${"b".repeat(64)}`,
      healthResponse: '{"status":"ok","scope":"master"}',
      revisionResponse: sha,
      productSmokeResponse: productSmoke(),
      observedAt,
    });
    expect(
      verifyStagingAttestation(attestation, run, {
        repository,
        now: Date.parse(observedAt) + 1_000,
      }),
    ).toMatchObject({ ok: true, imageDigest: attestation.imageDigest });
    expect(attestation.productSmoke).toMatchObject({
      checkCount: 1,
      receiptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it.each([
    [
      "caller-equal digest without successful run",
      { ...run, conclusion: "failure" },
    ],
    [
      "foreign repository",
      { ...run, repository: { full_name: "attacker/fork" } },
    ],
    ["different revision", { ...run, head_sha: "c".repeat(40) }],
  ])("rejects %s", (_label, candidateRun) => {
    const observedAt = "2026-08-03T12:00:00.000Z";
    const attestation = createStagingAttestation({
      repository,
      workflowRunId: 42,
      workflowRunAttempt: 1,
      gitSha: sha,
      origin: "https://staging.example.com",
      imageDigest: `sha256:${"b".repeat(64)}`,
      healthResponse: '{"status":"ok"}',
      revisionResponse: sha,
      observedAt,
    });
    expect(
      verifyStagingAttestation(attestation, candidateRun, {
        repository,
        now: Date.parse(observedAt) + 1_000,
      }).ok,
    ).toBe(false);
  });

  it("rejects a tampered artifact", () => {
    const observedAt = "2026-08-03T12:00:00.000Z";
    const attestation = createStagingAttestation({
      repository,
      workflowRunId: 42,
      workflowRunAttempt: 1,
      gitSha: sha,
      origin: "https://staging.example.com",
      imageDigest: `sha256:${"b".repeat(64)}`,
      healthResponse: '{"status":"ok"}',
      revisionResponse: sha,
      observedAt,
    });
    attestation.origin = "https://evil.example";
    expect(
      verifyStagingAttestation(attestation, run, {
        repository,
        now: Date.parse(observedAt) + 1_000,
      }).errors,
    ).toContain("attestation-digest-mismatch");
  });

  it("rejects a failed or cross-revision product smoke receipt", () => {
    expect(() =>
      createStagingAttestation({
        repository,
        workflowRunId: 42,
        workflowRunAttempt: 1,
        gitSha: sha,
        origin: "https://staging.example.com",
        imageDigest: `sha256:${"b".repeat(64)}`,
        healthResponse: '{"status":"ok"}',
        revisionResponse: sha,
        productSmokeResponse: productSmoke().replace(
          `"expectedRevision":"${sha}"`,
          `"expectedRevision":"${"c".repeat(40)}"`,
        ),
      }),
    ).toThrow(/not admissible/u);
  });

  it("rejects non-main and semantically unhealthy staging evidence", () => {
    const observedAt = "2026-08-03T12:00:00.000Z";
    expect(() =>
      createStagingAttestation({
        repository,
        workflowRunId: 42,
        workflowRunAttempt: 1,
        gitSha: sha,
        origin: "https://staging.example.com",
        imageDigest: `sha256:${"b".repeat(64)}`,
        healthResponse: '{"status":"unavailable"}',
        revisionResponse: sha,
        observedAt,
      }),
    ).toThrow(/not ready/u);
    const attestation = createStagingAttestation({
      repository,
      workflowRunId: 42,
      workflowRunAttempt: 1,
      gitSha: sha,
      origin: "https://staging.example.com",
      imageDigest: `sha256:${"b".repeat(64)}`,
      healthResponse: '{"status":"ok"}',
      revisionResponse: sha,
      observedAt,
    });
    expect(
      verifyStagingAttestation(
        attestation,
        { ...run, head_branch: "feature" },
        { repository, now: Date.parse(observedAt) + 1_000 },
      ).errors,
    ).toContain("run-source-ref-mismatch");
  });
});
