import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import {
  canonicalReleaseGateFingerprint,
  canonicalReleaseGateNames,
  verifyCanonicalReleaseObservation,
} from "./release-gate-catalog.mjs";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]+$/u;
const MAX_CLAIM_LIFETIME_MS = 24 * 60 * 60 * 1_000;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function unsigned(claim) {
  const payload = { ...claim };
  delete payload.signature;
  return payload;
}

export function signRuntimeReleaseClaim(payload, privateKeyPem) {
  const claim = {
    schemaVersion: 1,
    catalogFingerprint: canonicalReleaseGateFingerprint,
    ...payload,
  };
  const signature = sign(
    null,
    Buffer.from(stable(claim)),
    createPrivateKey(privateKeyPem),
  ).toString("base64url");
  return { ...claim, signature };
}

function validateClaim(claim, policy, runtime, now) {
  const errors = [];
  const authority = policy?.authorities?.[claim?.keyId];
  const observedAt = Date.parse(claim?.observedAt);
  const expiresAt = Date.parse(claim?.expiresAt);
  if (claim?.schemaVersion !== 1) errors.push("unsupported-claim-schema");
  if (claim?.catalogFingerprint !== canonicalReleaseGateFingerprint)
    errors.push("catalog-mismatch");
  if (!canonicalReleaseGateNames.includes(claim?.gate))
    errors.push("unknown-gate");
  if (!authority) errors.push("unknown-authority");
  if (!authority?.gates?.includes(claim?.gate))
    errors.push("gate-authority-escalation");
  if (!authority?.workflows?.includes(claim?.source?.workflow))
    errors.push("workflow-authority-escalation");
  if (authority?.environment !== claim?.environment)
    errors.push("authority-environment-mismatch");
  if (authority?.origin !== claim?.origin)
    errors.push("authority-origin-mismatch");
  if (claim?.project !== "vaultfront") errors.push("project-mismatch");
  if (claim?.repository !== "VaultSparkStudios/vaultfront")
    errors.push("repository-mismatch");
  if (claim?.environment !== runtime.environment)
    errors.push("runtime-environment-mismatch");
  if (claim?.origin !== runtime.origin) errors.push("runtime-origin-mismatch");
  if (!SHA.test(claim?.gitSha ?? "") || claim?.gitSha !== runtime.gitSha)
    errors.push("runtime-revision-mismatch");
  if (
    !DIGEST.test(claim?.imageDigest ?? "") ||
    claim?.imageDigest !== runtime.imageDigest
  )
    errors.push("runtime-image-mismatch");
  if (!Number.isFinite(observedAt) || observedAt > now + 30_000)
    errors.push("invalid-observed-at");
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt - observedAt > MAX_CLAIM_LIFETIME_MS
  )
    errors.push("expired-or-overlong-claim");
  if (
    typeof claim?.source?.workflow !== "string" ||
    !Number.isInteger(claim?.source?.runId) ||
    claim.source.runId < 1 ||
    !Number.isInteger(claim?.source?.runAttempt) ||
    claim.source.runAttempt < 1 ||
    !DIGEST.test(claim?.source?.artifactDigest ?? "")
  )
    errors.push("invalid-workflow-lineage");
  if (!verifyCanonicalReleaseObservation(claim?.gate, claim?.observation))
    errors.push("invalid-observation-digest");
  if (!SIGNATURE.test(claim?.signature ?? "")) errors.push("invalid-signature");
  if (authority?.publicKey && errors.length === 0) {
    try {
      const valid = verify(
        null,
        Buffer.from(stable(unsigned(claim))),
        createPublicKey(authority.publicKey),
        Buffer.from(claim.signature, "base64url"),
      );
      if (!valid) errors.push("signature-mismatch");
    } catch {
      errors.push("signature-verification-failed");
    }
  }
  return errors;
}

export function verifyRuntimeReleaseEvidenceBundle(
  bundle,
  { policy, runtime, now = Date.now() },
) {
  const errors = [];
  const observations = {};
  if (bundle?.schemaVersion !== 1 || !Array.isArray(bundle?.claims)) {
    return { ok: false, errors: ["invalid-bundle-schema"], observations };
  }
  const claimsByGate = new Map();
  for (const claim of bundle.claims) {
    const claimErrors = validateClaim(claim, policy, runtime, now);
    if (claimErrors.length) {
      errors.push(
        ...claimErrors.map((error) => `${claim?.gate ?? "unknown"}:${error}`),
      );
      continue;
    }
    const existing = claimsByGate.get(claim.gate);
    if (existing) {
      delete observations[claim.gate];
      errors.push(`${claim.gate}:conflicting-claims`);
      continue;
    }
    claimsByGate.set(claim.gate, claim);
    observations[claim.gate] = claim.observation;
  }
  return { ok: errors.length === 0, errors, observations };
}
