import { describe, expect, it } from "vitest";
import {
  createPromotionOutcomeReceipt,
  createPromotionValidationReceipt,
  verifyPromotionOutcomeReceipt,
  verifyPromotionValidationReceipt,
} from "../../scripts/lib/promotion-receipt.mjs";
import { createStagingAttestation } from "../../scripts/lib/staging-attestation.mjs";

const repository = "VaultSparkStudios/VaultFront";
const createdAt = "2026-08-03T12:00:00.000Z";
const target = createStagingAttestation({
  repository,
  workflowRunId: 42,
  workflowRunAttempt: 1,
  gitSha: "a".repeat(40),
  origin: "https://staging.vaultfront.example",
  imageDigest: `sha256:${"b".repeat(64)}`,
  healthResponse: '{"status":"ok","scope":"master"}',
  revisionResponse: "a".repeat(40),
  observedAt: createdAt,
});
const replaced = createStagingAttestation({
  repository,
  workflowRunId: 41,
  workflowRunAttempt: 1,
  gitSha: "c".repeat(40),
  origin: "https://staging.vaultfront.example",
  imageDigest: `sha256:${"d".repeat(64)}`,
  healthResponse: '{"status":"ok"}',
  revisionResponse: "c".repeat(40),
  observedAt: createdAt,
});
const validationRun = {
  id: 90,
  status: "completed",
  conclusion: "success",
  path: ".github/workflows/promote.yml",
  event: "workflow_dispatch",
  repository: { full_name: repository },
};
const expected = {
  repository,
  operation: "rollback",
  targetSubdomain: "play-vaultfront",
  stagingRunId: "42",
  replacedStagingRunId: "41",
  rollbackReason: "Restore the last certified revision",
};

describe("promotion and rollback receipts", () => {
  it("binds a rollback dry-run to both admitted staging attestations", () => {
    const receipt = createPromotionValidationReceipt({
      ...expected,
      workflowRunId: 90,
      workflowRunAttempt: 1,
      targetAttestation: target,
      replacedAttestation: replaced,
      createdAt,
    });
    expect(
      verifyPromotionValidationReceipt(receipt, validationRun, expected),
    ).toEqual({ ok: true, errors: [] });
    expect(receipt.target.attestationDigest).toBe(target.attestationDigest);
    expect(receipt.replaced?.attestationDigest).toBe(
      replaced.attestationDigest,
    );
  });

  it("rejects changed live intent and tampered staging evidence", () => {
    const receipt = createPromotionValidationReceipt({
      ...expected,
      workflowRunId: 90,
      workflowRunAttempt: 1,
      targetAttestation: target,
      replacedAttestation: replaced,
      createdAt,
    });
    expect(
      verifyPromotionValidationReceipt(receipt, validationRun, {
        ...expected,
        targetSubdomain: "other",
      }).errors,
    ).toContain("target-subdomain-mismatch");
    expect(() =>
      createPromotionValidationReceipt({
        ...expected,
        workflowRunId: 90,
        workflowRunAttempt: 1,
        targetAttestation: {
          ...target,
          imageDigest: `sha256:${"e".repeat(64)}`,
        },
        replacedAttestation: replaced,
        createdAt,
      }),
    ).toThrow(/target-attestation-digest-mismatch/u);
  });

  it("chains a verified production outcome to the dry-run and target revision", () => {
    const validationReceipt = createPromotionValidationReceipt({
      ...expected,
      workflowRunId: 90,
      workflowRunAttempt: 1,
      targetAttestation: target,
      replacedAttestation: replaced,
      createdAt,
    });
    const receipt = createPromotionOutcomeReceipt({
      validationReceipt,
      validationRun,
      expected,
      workflowRunId: 91,
      workflowRunAttempt: 1,
      productionOrigin: "https://play-vaultfront.example",
      healthResponse: '{"status":"ok","scope":"master"}',
      revisionResponse: target.gitSha,
      startedAt: "2026-08-03T12:05:00.000Z",
      completedAt: "2026-08-03T12:06:00.000Z",
    });
    expect(verifyPromotionOutcomeReceipt(receipt)).toEqual({
      ok: true,
      errors: [],
    });
    expect(receipt.validation.evidenceDigest).toBe(
      validationReceipt.evidenceDigest,
    );
    expect(receipt.production.revision.value).toBe(target.gitSha);
  });

  it("rejects a false health result, revision mismatch, and outcome tamper", () => {
    const validationReceipt = createPromotionValidationReceipt({
      ...expected,
      workflowRunId: 90,
      workflowRunAttempt: 1,
      targetAttestation: target,
      replacedAttestation: replaced,
      createdAt,
    });
    const base = {
      validationReceipt,
      validationRun,
      expected,
      workflowRunId: 91,
      workflowRunAttempt: 1,
      productionOrigin: "https://play-vaultfront.example",
      startedAt: "2026-08-03T12:05:00.000Z",
      completedAt: "2026-08-03T12:06:00.000Z",
    };
    expect(() =>
      createPromotionOutcomeReceipt({
        ...base,
        healthResponse: '{"status":"down"}',
        revisionResponse: target.gitSha,
      }),
    ).toThrow(/not-ready/u);
    expect(() =>
      createPromotionOutcomeReceipt({
        ...base,
        healthResponse: '{"status":"ok"}',
        revisionResponse: "f".repeat(40),
      }),
    ).toThrow(/revision-mismatch/u);
    const receipt = createPromotionOutcomeReceipt({
      ...base,
      healthResponse: '{"status":"ok"}',
      revisionResponse: target.gitSha,
    });
    receipt.production.origin = "https://evil.example";
    expect(verifyPromotionOutcomeReceipt(receipt).errors).toContain(
      "outcome-receipt-digest-mismatch",
    );
  });
});
