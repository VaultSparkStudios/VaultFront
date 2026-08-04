import { createHash } from "node:crypto";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function unsigned(value) {
  const { attestationDigest: _ignored, ...payload } = value;
  return payload;
}

export function createStagingAttestation(input) {
  let healthPayload;
  try {
    healthPayload = JSON.parse(input.healthResponse);
  } catch {
    throw new Error("staging health response is not valid JSON");
  }
  if (healthPayload.status !== "ok") {
    throw new Error("staging health response is not ready");
  }
  const payload = {
    schemaVersion: 1,
    repository: input.repository,
    workflowPath: ".github/workflows/deploy.yml",
    workflowRunId: Number(input.workflowRunId),
    workflowRunAttempt: Number(input.workflowRunAttempt),
    gitSha: input.gitSha,
    environment: "staging",
    origin: input.origin,
    imageDigest: input.imageDigest,
    health: {
      endpoint: `${input.origin.replace(/\/$/u, "")}/_health`,
      status: healthPayload.status,
      scope: healthPayload.scope ?? null,
      responseDigest: digest(input.healthResponse),
    },
    revision: {
      endpoint: `${input.origin.replace(/\/$/u, "")}/commit.txt`,
      responseDigest: digest(input.revisionResponse),
      value: input.revisionResponse.trim(),
    },
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
  return { ...payload, attestationDigest: digest(JSON.stringify(payload)) };
}

export function verifyStagingAttestation(attestation, run, options = {}) {
  const errors = [];
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1_000;
  if (attestation.schemaVersion !== 1) errors.push("unsupported-schema");
  if (attestation.repository !== options.repository)
    errors.push("repository-mismatch");
  if (attestation.workflowPath !== ".github/workflows/deploy.yml")
    errors.push("workflow-path-mismatch");
  if (attestation.workflowRunId !== Number(run.id))
    errors.push("run-id-mismatch");
  if (attestation.workflowRunAttempt !== Number(run.run_attempt))
    errors.push("run-attempt-mismatch");
  if (run.repository?.full_name !== options.repository)
    errors.push("run-repository-mismatch");
  if (run.path !== ".github/workflows/deploy.yml")
    errors.push("run-workflow-mismatch");
  if (run.event !== "workflow_dispatch" || run.head_branch !== "main")
    errors.push("run-source-ref-mismatch");
  if (run.conclusion !== "success" || run.status !== "completed")
    errors.push("run-not-successful");
  if (
    attestation.gitSha !== run.head_sha ||
    !SHA.test(attestation.gitSha ?? "")
  )
    errors.push("revision-mismatch");
  if (attestation.revision?.value !== attestation.gitSha)
    errors.push("deployed-revision-mismatch");
  if (!DIGEST.test(attestation.imageDigest ?? ""))
    errors.push("invalid-image-digest");
  if (!DIGEST.test(attestation.health?.responseDigest ?? ""))
    errors.push("missing-health-digest");
  if (attestation.health?.status !== "ok") errors.push("health-not-ready");
  if (!/^https:\/\/[^/]+$/u.test(attestation.origin ?? ""))
    errors.push("invalid-staging-origin");
  const observed = Date.parse(attestation.observedAt);
  if (!Number.isFinite(observed) || observed > now || now - observed > maxAgeMs)
    errors.push("stale-or-invalid-observation");
  if (
    attestation.attestationDigest !==
    digest(JSON.stringify(unsigned(attestation)))
  )
    errors.push("attestation-digest-mismatch");
  return {
    ok: errors.length === 0,
    errors,
    imageDigest: errors.length ? null : attestation.imageDigest,
    gitSha: errors.length ? null : attestation.gitSha,
    origin: errors.length ? null : attestation.origin,
  };
}
