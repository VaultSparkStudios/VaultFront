import { createHash } from "node:crypto";

const REQUIRED_GATES = Object.freeze([
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
]);

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function createReleaseAdmission(
  { readiness, revision, attestation, repository, origin },
  { now = Date.now(), maxAgeMs = 5 * 60_000 } = {},
) {
  const errors = [];
  const generatedAtMs = Date.parse(readiness?.generatedAt ?? "");
  const gates = readiness?.canonicalRelease?.gates ?? [];
  const byName = new Map(gates.map((gate) => [gate?.gate, gate]));
  if (readiness?.project !== "vaultfront") errors.push("wrong-project");
  if (readiness?.status !== "ready" || readiness?.serverStatus !== "ready")
    errors.push("staging-server-not-ready");
  if (readiness?.releaseStatus !== "ready") errors.push("release-not-ready");
  if (readiness?.canonicalRelease?.status !== "ready")
    errors.push("canonical-release-not-ready");
  if (!Number.isFinite(generatedAtMs) || now - generatedAtMs > maxAgeMs)
    errors.push("readiness-stale");
  if (generatedAtMs > now + 30_000) errors.push("readiness-from-future");
  if (readiness?.processRole !== "master") errors.push("wrong-process-role");
  if (readiness?.playtestPulse?.alphaGate?.status !== "ready")
    errors.push("alpha-human-not-ready");
  if (String(revision).trim() !== attestation?.gitSha)
    errors.push("revision-attestation-mismatch");
  if (attestation?.repository !== repository)
    errors.push("repository-attestation-mismatch");
  if (attestation?.environment !== "staging")
    errors.push("attestation-not-staging");
  if (attestation?.origin !== origin.replace(/\/$/u, ""))
    errors.push("origin-attestation-mismatch");
  if (!/^sha256:[0-9a-f]{64}$/u.test(attestation?.imageDigest ?? ""))
    errors.push("invalid-image-digest");
  for (const gate of REQUIRED_GATES) {
    if (byName.get(gate)?.status !== "pass")
      errors.push(`gate-blocked:${gate}`);
  }
  if (gates.length !== REQUIRED_GATES.length || byName.size !== gates.length)
    errors.push("canonical-gate-set-mismatch");
  if ((readiness?.canonicalRelease?.blockers ?? []).length > 0)
    errors.push("canonical-blockers-present");

  if (errors.length > 0) return { ok: false, errors };
  const payload = {
    schemaVersion: 1,
    kind: "vaultfront-release-admission",
    repository,
    origin: origin.replace(/\/$/u, ""),
    gitSha: attestation.gitSha,
    imageDigest: attestation.imageDigest,
    attestationDigest: attestation.attestationDigest,
    readinessGeneratedAt: readiness.generatedAt,
    catalogFingerprint: readiness.canonicalRelease.catalogFingerprint,
    gateDigests: Object.fromEntries(
      REQUIRED_GATES.map((gate) => [gate, byName.get(gate).digest]),
    ),
  };
  return {
    ok: true,
    receipt: { ...payload, admissionDigest: digest(JSON.stringify(payload)) },
  };
}
