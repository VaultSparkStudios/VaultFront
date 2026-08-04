import { createHash, timingSafeEqual } from "node:crypto";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const SUBDOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?|main)$/u;

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestMatches(actual, expected) {
  if (!DIGEST.test(actual ?? "") || !DIGEST.test(expected ?? "")) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function withoutDigest(value) {
  const { evidenceDigest: _ignored, ...payload } = value;
  return payload;
}

function validateAttestation(attestation, label) {
  const errors = [];
  if (!attestation || attestation.schemaVersion !== 1) {
    errors.push(`${label}-unsupported-schema`);
    return errors;
  }
  if (!DIGEST.test(attestation.attestationDigest ?? ""))
    errors.push(`${label}-invalid-attestation-digest`);
  const { attestationDigest: _ignored, ...payload } = attestation;
  if (
    !digestMatches(
      attestation.attestationDigest,
      digest(JSON.stringify(payload)),
    )
  )
    errors.push(`${label}-attestation-digest-mismatch`);
  if (!DIGEST.test(attestation.imageDigest ?? ""))
    errors.push(`${label}-invalid-image-digest`);
  if (!SHA.test(attestation.gitSha ?? ""))
    errors.push(`${label}-invalid-git-sha`);
  if (!Number.isSafeInteger(Number(attestation.workflowRunId)))
    errors.push(`${label}-invalid-run-id`);
  return errors;
}

function targetFrom(attestation) {
  return {
    stagingRunId: Number(attestation.workflowRunId),
    attestationDigest: attestation.attestationDigest,
    imageDigest: attestation.imageDigest,
    gitSha: attestation.gitSha,
    stagingOrigin: attestation.origin,
  };
}

function validateIntent(input) {
  const errors = [];
  if (!["promotion", "rollback"].includes(input.operation))
    errors.push("invalid-operation");
  if (!SUBDOMAIN.test(input.targetSubdomain ?? ""))
    errors.push("invalid-target-subdomain");
  if (input.operation === "rollback") {
    if (!input.replacedAttestation)
      errors.push("rollback-missing-replaced-attestation");
    if (!String(input.rollbackReason ?? "").trim())
      errors.push("rollback-missing-reason");
  } else if (
    input.replacedAttestation ||
    String(input.rollbackReason ?? "").trim()
  ) {
    errors.push("promotion-carries-rollback-fields");
  }
  return errors;
}

export function createPromotionValidationReceipt(input) {
  const errors = [
    ...validateIntent(input),
    ...validateAttestation(input.targetAttestation, "target"),
    ...(input.replacedAttestation
      ? validateAttestation(input.replacedAttestation, "replaced")
      : []),
  ];
  if (!Number.isSafeInteger(Number(input.workflowRunId)))
    errors.push("invalid-workflow-run-id");
  if (errors.length) throw new Error(errors.join(","));

  const payload = {
    schemaVersion: 1,
    kind: "vaultfront-promotion-validation",
    repository: input.repository,
    workflowPath: ".github/workflows/promote.yml",
    workflowRunId: Number(input.workflowRunId),
    workflowRunAttempt: Number(input.workflowRunAttempt),
    dryRun: true,
    operation: input.operation,
    targetSubdomain: input.targetSubdomain,
    target: targetFrom(input.targetAttestation),
    replaced:
      input.operation === "rollback"
        ? targetFrom(input.replacedAttestation)
        : null,
    rollbackReason:
      input.operation === "rollback"
        ? String(input.rollbackReason).trim()
        : null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  return { ...payload, evidenceDigest: digest(JSON.stringify(payload)) };
}

export function verifyPromotionValidationReceipt(receipt, run, expected = {}) {
  const errors = [];
  if (
    receipt?.schemaVersion !== 1 ||
    receipt?.kind !== "vaultfront-promotion-validation"
  )
    errors.push("unsupported-validation-receipt");
  if (
    !digestMatches(
      receipt?.evidenceDigest,
      digest(JSON.stringify(withoutDigest(receipt ?? {}))),
    )
  )
    errors.push("validation-receipt-digest-mismatch");
  if (
    receipt?.repository !== expected.repository ||
    run?.repository?.full_name !== expected.repository
  )
    errors.push("repository-mismatch");
  if (
    run?.path !== ".github/workflows/promote.yml" ||
    run?.event !== "workflow_dispatch"
  )
    errors.push("workflow-source-mismatch");
  if (run?.status !== "completed" || run?.conclusion !== "success")
    errors.push("validation-run-not-successful");
  if (Number(run?.id) !== Number(receipt?.workflowRunId))
    errors.push("validation-run-id-mismatch");
  if (receipt?.dryRun !== true) errors.push("validation-was-not-dry-run");
  if (receipt?.operation !== expected.operation)
    errors.push("operation-mismatch");
  if (receipt?.targetSubdomain !== expected.targetSubdomain)
    errors.push("target-subdomain-mismatch");
  if (Number(receipt?.target?.stagingRunId) !== Number(expected.stagingRunId))
    errors.push("target-staging-run-mismatch");
  if (
    expected.targetAttestationDigest &&
    receipt?.target?.attestationDigest !== expected.targetAttestationDigest
  )
    errors.push("target-attestation-digest-mismatch");
  if (receipt?.operation === "rollback") {
    if (
      Number(receipt?.replaced?.stagingRunId) !==
      Number(expected.replacedStagingRunId)
    )
      errors.push("replaced-staging-run-mismatch");
    if (
      expected.replacedAttestationDigest &&
      receipt?.replaced?.attestationDigest !==
        expected.replacedAttestationDigest
    )
      errors.push("replaced-attestation-digest-mismatch");
    if (
      receipt?.rollbackReason !== String(expected.rollbackReason ?? "").trim()
    )
      errors.push("rollback-reason-mismatch");
  }
  return { ok: errors.length === 0, errors };
}

export function createPromotionOutcomeReceipt(input) {
  const validation = verifyPromotionValidationReceipt(
    input.validationReceipt,
    input.validationRun,
    input.expected,
  );
  if (!validation.ok) throw new Error(validation.errors.join(","));
  let health;
  try {
    health = JSON.parse(input.healthResponse);
  } catch {
    throw new Error("production-health-not-json");
  }
  if (health.status !== "ok") throw new Error("production-health-not-ready");
  const revision = String(input.revisionResponse ?? "").trim();
  if (revision !== input.validationReceipt.target.gitSha)
    throw new Error("production-revision-mismatch");
  const startedAt = new Date(input.startedAt);
  const completedAt = new Date(input.completedAt ?? new Date().toISOString());
  if (
    !Number.isFinite(startedAt.getTime()) ||
    !Number.isFinite(completedAt.getTime()) ||
    completedAt < startedAt
  )
    throw new Error("invalid-outcome-timestamps");

  const payload = {
    schemaVersion: 1,
    kind: "vaultfront-promotion-outcome",
    repository: input.expected.repository,
    workflowPath: ".github/workflows/promote.yml",
    workflowRunId: Number(input.workflowRunId),
    workflowRunAttempt: Number(input.workflowRunAttempt),
    operation: input.validationReceipt.operation,
    targetSubdomain: input.validationReceipt.targetSubdomain,
    validation: {
      workflowRunId: Number(input.validationRun.id),
      evidenceDigest: input.validationReceipt.evidenceDigest,
    },
    target: input.validationReceipt.target,
    replaced: input.validationReceipt.replaced,
    rollbackReason: input.validationReceipt.rollbackReason,
    production: {
      origin: input.productionOrigin,
      health: {
        status: health.status,
        scope: health.scope ?? null,
        responseDigest: digest(input.healthResponse),
      },
      revision: {
        value: revision,
        responseDigest: digest(input.revisionResponse),
      },
    },
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
  };
  return { ...payload, evidenceDigest: digest(JSON.stringify(payload)) };
}

export function verifyPromotionOutcomeReceipt(receipt) {
  const errors = [];
  if (
    receipt?.schemaVersion !== 1 ||
    receipt?.kind !== "vaultfront-promotion-outcome"
  )
    errors.push("unsupported-outcome-receipt");
  if (
    !digestMatches(
      receipt?.evidenceDigest,
      digest(JSON.stringify(withoutDigest(receipt ?? {}))),
    )
  )
    errors.push("outcome-receipt-digest-mismatch");
  if (!DIGEST.test(receipt?.validation?.evidenceDigest ?? ""))
    errors.push("missing-validation-lineage");
  if (
    !DIGEST.test(receipt?.target?.attestationDigest ?? "") ||
    !DIGEST.test(receipt?.target?.imageDigest ?? "")
  )
    errors.push("missing-target-lineage");
  if (receipt?.production?.health?.status !== "ok")
    errors.push("health-not-ready");
  if (receipt?.production?.revision?.value !== receipt?.target?.gitSha)
    errors.push("revision-mismatch");
  if (receipt?.operation === "rollback" && !receipt?.replaced)
    errors.push("rollback-missing-replaced-lineage");
  return { ok: errors.length === 0, errors };
}
