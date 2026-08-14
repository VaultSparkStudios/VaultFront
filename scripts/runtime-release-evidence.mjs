#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCanonicalReleaseObservation } from "../src/shared/release-gate-catalog.mjs";
import {
  signRuntimeReleaseClaim,
  verifyRuntimeReleaseEvidenceBundle,
} from "../src/shared/runtime-release-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(
  fs.readFileSync(
    path.join(root, "config/release-evidence-trust.json"),
    "utf8",
  ),
);

function value(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${flag}`);
  return process.argv[index + 1];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function privateKey() {
  const fileIndex = process.argv.indexOf("--private-key-file");
  if (fileIndex >= 0)
    return fs.readFileSync(process.argv[fileIndex + 1], "utf8");
  const configured = process.env.RELEASE_EVIDENCE_PRIVATE_KEY;
  if (!configured) throw new Error("RELEASE_EVIDENCE_PRIVATE_KEY is required");
  return configured.replace(/\\n/gu, "\n");
}

function smokeCheck(smoke, id) {
  return smoke.checks?.find((check) => check.id === id)?.pass === true;
}

function createStagingBundle() {
  const attestation = readJson(value("--attestation"));
  const smoke = readJson(value("--product-smoke"));
  const output = value("--output");
  if (
    attestation.schemaVersion !== 1 ||
    attestation.environment !== "staging" ||
    attestation.revision?.value !== attestation.gitSha ||
    smoke.pass !== true ||
    smoke.expectedRevision !== attestation.gitSha ||
    smoke.origin !== attestation.origin ||
    smoke.receiptDigest !== attestation.productSmoke?.receiptDigest
  )
    throw new Error("Staging attestation/product-smoke binding is invalid");
  for (const id of [
    "health-json",
    "exact-revision",
    "obelisk-unauthenticated-json",
    "obelisk-pkce-redirect",
  ]) {
    if (!smokeCheck(smoke, id))
      throw new Error(`Missing passed smoke check: ${id}`);
  }
  const observedAt = attestation.observedAt;
  const observedMs = Date.parse(observedAt);
  const sourceText = `github-actions:deploy:${attestation.workflowRunId}:${attestation.workflowRunAttempt}`;
  const common = {
    keyId: "staging-v1",
    project: "vaultfront",
    repository: attestation.repository,
    environment: "staging",
    origin: attestation.origin,
    gitSha: attestation.gitSha,
    imageDigest: attestation.imageDigest,
    source: {
      workflow: attestation.workflowPath,
      runId: attestation.workflowRunId,
      runAttempt: attestation.workflowRunAttempt,
      artifactDigest: attestation.attestationDigest,
    },
    observedAt,
  };
  const claims = [
    ["staging", {}, 24 * 60],
    ["healthObservation", { httpStatus: 200, healthy: true }, 15],
    ["obeliskIdentity", {}, 24 * 60],
  ].map(([gate, semantic, lifetimeMinutes]) => {
    const observation = buildCanonicalReleaseObservation(gate, {
      status: "verified",
      observedAt,
      source: sourceText,
      ...semantic,
    });
    return signRuntimeReleaseClaim(
      {
        ...common,
        gate,
        expiresAt: new Date(
          observedMs + lifetimeMinutes * 60_000,
        ).toISOString(),
        observation,
      },
      privateKey(),
    );
  });
  const bundle = { schemaVersion: 1, claims };
  const verified = verifyRuntimeReleaseEvidenceBundle(bundle, {
    policy,
    runtime: {
      environment: "staging",
      origin: attestation.origin,
      gitSha: attestation.gitSha,
      imageDigest: attestation.imageDigest,
    },
    now: observedMs,
  });
  if (!verified.ok)
    throw new Error(`Self-verification failed: ${verified.errors.join(",")}`);
  fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(
    `Signed ${claims.length} observed staging claims for run ${attestation.workflowRunId}.`,
  );
}

function verifyBundle() {
  const bundle = readJson(value("--bundle"));
  const result = verifyRuntimeReleaseEvidenceBundle(bundle, {
    policy,
    runtime: {
      environment: value("--environment"),
      origin: value("--origin"),
      gitSha: value("--git-sha"),
      imageDigest: value("--image-digest"),
    },
  });
  if (!result.ok) throw new Error(result.errors.join(","));
  console.log(
    `Verified ${Object.keys(result.observations).length} runtime claims.`,
  );
}

const command = process.argv[2];
if (command === "create-staging") createStagingBundle();
else if (command === "verify") verifyBundle();
else
  throw new Error(
    "Usage: runtime-release-evidence.mjs <create-staging|verify> ...",
  );
