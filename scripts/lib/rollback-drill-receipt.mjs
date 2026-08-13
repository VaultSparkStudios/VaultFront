import { createHash, timingSafeEqual } from "node:crypto";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const withoutDigest = (receipt) => {
  const { evidenceDigest: _evidenceDigest, ...payload } = receipt;
  return payload;
};
const digestMatches = (actual, expected) => {
  if (!DIGEST.test(actual ?? "") || !DIGEST.test(expected ?? "")) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

function admitted(attestation) {
  return {
    stagingRunId: Number(attestation.workflowRunId),
    gitSha: attestation.gitSha,
    imageDigest: attestation.imageDigest,
    attestationDigest: attestation.attestationDigest,
  };
}

function parseHealthy(body, label) {
  let health;
  try {
    health = JSON.parse(body);
  } catch {
    throw new Error(`${label}-health-not-json`);
  }
  if (health.status !== "ok") throw new Error(`${label}-health-not-ready`);
  return {
    status: health.status,
    scope: health.scope ?? null,
    responseDigest: digest(body),
  };
}

export function createRollbackDrillReceipt(input) {
  const target = admitted(input.targetAttestation);
  const restored = admitted(input.replacedAttestation);
  const validation = input.validationReceipt;
  const reason = String(input.rollbackReason ?? "").trim();
  if (
    validation?.operation !== "rollback" ||
    validation?.targetSubdomain !== "staging" ||
    Number(validation?.target?.stagingRunId) !== target.stagingRunId ||
    validation?.target?.attestationDigest !== target.attestationDigest ||
    Number(validation?.replaced?.stagingRunId) !== restored.stagingRunId ||
    validation?.replaced?.attestationDigest !== restored.attestationDigest ||
    validation?.rollbackReason !== reason
  ) {
    throw new Error("rollback-validation-lineage-mismatch");
  }
  if (target.stagingRunId === restored.stagingRunId) {
    throw new Error("rollback-target-equals-restored");
  }
  if (String(input.rollbackRevision).trim() !== target.gitSha) {
    throw new Error("rollback-revision-mismatch");
  }
  if (String(input.restoreRevision).trim() !== restored.gitSha) {
    throw new Error("restore-revision-mismatch");
  }
  const startedAt = new Date(input.startedAt);
  const rolledBackAt = new Date(input.rolledBackAt);
  const completedAt = new Date(input.completedAt ?? new Date().toISOString());
  if (
    ![startedAt, rolledBackAt, completedAt].every((value) =>
      Number.isFinite(value.getTime()),
    ) ||
    rolledBackAt < startedAt ||
    completedAt < rolledBackAt
  ) {
    throw new Error("invalid-rollback-timestamps");
  }
  const payload = {
    schemaVersion: 1,
    kind: "vaultfront-staging-rollback-drill",
    repository: input.repository,
    workflowPath: ".github/workflows/staging-rollback-drill.yml",
    workflowRunId: Number(input.workflowRunId),
    workflowRunAttempt: Number(input.workflowRunAttempt),
    origin: input.origin,
    rollbackReason: reason,
    validation: {
      workflowRunId: Number(validation.workflowRunId),
      evidenceDigest: validation.evidenceDigest,
    },
    target,
    restored,
    rollbackObservation: {
      health: parseHealthy(input.rollbackHealth, "rollback"),
      revision: {
        value: target.gitSha,
        responseDigest: digest(input.rollbackRevision),
      },
      observedAt: rolledBackAt.toISOString(),
    },
    restorationObservation: {
      health: parseHealthy(input.restoreHealth, "restore"),
      revision: {
        value: restored.gitSha,
        responseDigest: digest(input.restoreRevision),
      },
      observedAt: completedAt.toISOString(),
    },
    drillCompleted: true,
    restoredHealth: true,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
  };
  return { ...payload, evidenceDigest: digest(JSON.stringify(payload)) };
}

export function verifyRollbackDrillReceipt(receipt) {
  const errors = [];
  if (
    receipt?.schemaVersion !== 1 ||
    receipt?.kind !== "vaultfront-staging-rollback-drill"
  ) {
    errors.push("unsupported-rollback-drill-receipt");
  }
  if (
    !digestMatches(
      receipt?.evidenceDigest,
      digest(JSON.stringify(withoutDigest(receipt ?? {}))),
    )
  ) {
    errors.push("rollback-drill-digest-mismatch");
  }
  if (!DIGEST.test(receipt?.validation?.evidenceDigest ?? "")) {
    errors.push("missing-validation-lineage");
  }
  for (const key of ["target", "restored"]) {
    if (
      !Number.isInteger(receipt?.[key]?.stagingRunId) ||
      !SHA.test(receipt?.[key]?.gitSha ?? "") ||
      !DIGEST.test(receipt?.[key]?.imageDigest ?? "") ||
      !DIGEST.test(receipt?.[key]?.attestationDigest ?? "")
    ) {
      errors.push(`invalid-${key}-lineage`);
    }
  }
  if (receipt?.target?.stagingRunId === receipt?.restored?.stagingRunId) {
    errors.push("rollback-target-equals-restored");
  }
  if (
    receipt?.rollbackObservation?.health?.status !== "ok" ||
    receipt?.rollbackObservation?.revision?.value !== receipt?.target?.gitSha
  ) {
    errors.push("rollback-observation-invalid");
  }
  if (
    receipt?.restorationObservation?.health?.status !== "ok" ||
    receipt?.restorationObservation?.revision?.value !==
      receipt?.restored?.gitSha
  ) {
    errors.push("restoration-observation-invalid");
  }
  if (receipt?.drillCompleted !== true || receipt?.restoredHealth !== true) {
    errors.push("rollback-drill-incomplete");
  }
  return { ok: errors.length === 0, errors };
}
