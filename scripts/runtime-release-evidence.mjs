#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCanonicalReleaseObservation } from "../src/shared/release-gate-catalog.mjs";
import {
  signRuntimeReleaseClaim,
  verifyRuntimeReleaseEvidenceBundle,
} from "../src/shared/runtime-release-evidence.mjs";
import { verifyRollbackDrillReceipt } from "./lib/rollback-drill-receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEALTH_EVIDENCE_LIFETIME_MINUTES = 24 * 60;
const ROLLBACK_EVIDENCE_LIFETIME_MINUTES = 24 * 60;
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

function fileDigest(file) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function reportDigest(report) {
  const payload = { ...report };
  delete payload.digest;
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
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
    [
      "healthObservation",
      { httpStatus: 200, healthy: true },
      HEALTH_EVIDENCE_LIFETIME_MINUTES,
    ],
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
    now: Date.now(),
  });
  if (!verified.ok)
    throw new Error(`Self-verification failed: ${verified.errors.join(",")}`);
  fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(
    `Signed ${claims.length} observed staging claims for run ${attestation.workflowRunId}.`,
  );
}

function createStagingObservationsBundle() {
  const attestation = readJson(value("--attestation"));
  const smoke = readJson(value("--product-smoke"));
  const healthPath = value("--health-response");
  const revisionPath = value("--revision-response");
  const parityPath = value("--release-parity");
  const themeProofPath = value("--theme-proof");
  const themeCheckPath = value("--theme-check");
  const footerPath = value("--footer-observation");
  const output = value("--output");
  const workflow = value("--workflow");
  const runId = Number(value("--run-id"));
  const runAttempt = Number(value("--run-attempt"));
  const observedAt = value("--observed-at");
  const observedMs = Date.parse(observedAt);
  const health = readJson(healthPath);
  const revision = fs.readFileSync(revisionPath, "utf8").trim();
  const parity = readJson(parityPath);
  const themeProof = readJson(themeProofPath);
  const themeCheck = readJson(themeCheckPath);
  const footer = readJson(footerPath);
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
  if (
    !Number.isInteger(runId) ||
    runId < 1 ||
    !Number.isInteger(runAttempt) ||
    runAttempt < 1 ||
    !Number.isFinite(observedMs)
  )
    throw new Error("Observation workflow lineage is invalid");
  if (health.status !== "ok" || revision !== attestation.gitSha)
    throw new Error("Fresh health/revision observation is invalid");
  if (
    parity.schemaVersion !== 1 ||
    parity.origin !== attestation.origin ||
    parity.revision !== attestation.gitSha ||
    parity.summary?.pass !== true ||
    parity.summary?.cellCount !== 9 ||
    parity.summary?.findingCount !== 0 ||
    parity.digest !== reportDigest(parity)
  )
    throw new Error("Exact-live release parity is invalid");
  if (
    themeCheck.ok !== true ||
    themeProof.schemaVersion !== 1 ||
    themeProof.inspection?.renderedPixelsReviewed !== true ||
    themeProof.inspection?.blockingDefectsOpen !== 0 ||
    themeProof.source?.digest !== themeCheck.sourceDigest
  )
    throw new Error("Theme readability proof is invalid");
  if (
    footer.ok !== true ||
    footer.origin !== attestation.origin ||
    footer.revision !== attestation.gitSha ||
    footer.routeCount < 1 ||
    footer.errors?.length !== 0 ||
    footer.digest !== reportDigest(footer)
  )
    throw new Error("Live footer observation is invalid");
  const sourceText = `github-actions:observe-staging:${runId}:${runAttempt}`;
  const common = {
    keyId: "staging-v1",
    project: "vaultfront",
    repository: attestation.repository,
    environment: "staging",
    origin: attestation.origin,
    gitSha: attestation.gitSha,
    imageDigest: attestation.imageDigest,
  };
  const makeClaim = (
    gate,
    claimObservedAt,
    artifactDigest,
    semantic = {},
    lifetimeMinutes = 24 * 60,
  ) =>
    signRuntimeReleaseClaim(
      {
        ...common,
        gate,
        source: { workflow, runId, runAttempt, artifactDigest },
        observedAt: claimObservedAt,
        expiresAt: new Date(
          Date.parse(claimObservedAt) + lifetimeMinutes * 60_000,
        ).toISOString(),
        observation: buildCanonicalReleaseObservation(gate, {
          status: "verified",
          observedAt: claimObservedAt,
          source: sourceText,
          ...semantic,
        }),
      },
      privateKey(),
    );
  const deploySourceText = `github-actions:deploy:${attestation.workflowRunId}:${attestation.workflowRunAttempt}`;
  const deployCommon = {
    ...common,
    source: {
      workflow: attestation.workflowPath,
      runId: attestation.workflowRunId,
      runAttempt: attestation.workflowRunAttempt,
      artifactDigest: attestation.attestationDigest,
    },
    observedAt: attestation.observedAt,
    expiresAt: new Date(
      Date.parse(attestation.observedAt) + 24 * 60 * 60_000,
    ).toISOString(),
  };
  const deployClaim = (gate) =>
    signRuntimeReleaseClaim(
      {
        ...deployCommon,
        gate,
        observation: buildCanonicalReleaseObservation(gate, {
          status: "verified",
          observedAt: attestation.observedAt,
          source: deploySourceText,
        }),
      },
      privateKey(),
    );
  const claims = [
    deployClaim("staging"),
    makeClaim(
      "healthObservation",
      observedAt,
      fileDigest(healthPath),
      { httpStatus: 200, healthy: true },
      HEALTH_EVIDENCE_LIFETIME_MINUTES,
    ),
    makeClaim("stagingParity", parity.observedAt, parity.digest),
    makeClaim(
      "themeReadability",
      parity.observedAt,
      fileDigest(themeProofPath),
    ),
    makeClaim("footerManifest", footer.observedAt, footer.digest),
  ];
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
    `Signed ${claims.length} exact staging observation claims for run ${runId}.`,
  );
}

function addRollbackObservation() {
  const bundle = readJson(value("--bundle"));
  const receipt = readJson(value("--receipt"));
  const attestation = readJson(value("--attestation"));
  const healthPath = value("--health-response");
  const health = readJson(healthPath);
  const observationRunId = Number(value("--observation-run-id"));
  const output = value("--output");
  const runtime = {
    environment: "staging",
    origin: attestation.origin,
    gitSha: attestation.gitSha,
    imageDigest: attestation.imageDigest,
  };
  const claims = (bundle.claims ?? []).filter(
    (claim) =>
      !["healthObservation", "rollbackObservation"].includes(claim.gate),
  );
  const issuanceNow =
    Math.min(
      ...(bundle.claims ?? []).map((claim) => Date.parse(claim.expiresAt)),
    ) - 1;
  const prior = verifyRuntimeReleaseEvidenceBundle(bundle, {
    policy,
    runtime,
    now: issuanceNow,
  });
  if (!prior.ok)
    throw new Error(
      `Prior observation bundle is invalid: ${prior.errors.join(",")}`,
    );
  for (const gate of [
    "staging",
    "stagingParity",
    "themeReadability",
    "footerManifest",
  ]) {
    if (!prior.observations[gate])
      throw new Error(`Prior observation bundle is missing ${gate}`);
  }
  const parityClaim = bundle.claims.find(
    (claim) => claim.gate === "stagingParity",
  );
  if (
    !Number.isInteger(observationRunId) ||
    parityClaim?.source?.runId !== observationRunId ||
    parityClaim?.source?.workflow !== ".github/workflows/observe-staging.yml"
  )
    throw new Error("Observation run lineage is invalid");
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "vaultfront-staging-rollback-drill" ||
    receipt.repository !== attestation.repository ||
    receipt.workflowPath !== ".github/workflows/staging-rollback-drill.yml" ||
    receipt.origin !== attestation.origin ||
    receipt.drillCompleted !== true ||
    receipt.restoredHealth !== true ||
    receipt.restored?.gitSha !== attestation.gitSha ||
    receipt.restored?.imageDigest !== attestation.imageDigest ||
    receipt.restored?.attestationDigest !== attestation.attestationDigest ||
    receipt.restorationObservation?.revision?.value !== attestation.gitSha ||
    receipt.restorationObservation?.health?.status !== "ok" ||
    receipt.restorationObservation?.health?.responseDigest !==
      fileDigest(healthPath) ||
    verifyRollbackDrillReceipt(receipt).ok !== true ||
    health.status !== "ok"
  )
    throw new Error("Rollback receipt/runtime binding is invalid");
  const observedAt = receipt.completedAt;
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs))
    throw new Error("Rollback completion time is invalid");
  const common = {
    keyId: "staging-v1",
    project: "vaultfront",
    repository: attestation.repository,
    environment: "staging",
    origin: attestation.origin,
    gitSha: attestation.gitSha,
    imageDigest: attestation.imageDigest,
    source: {
      workflow: receipt.workflowPath,
      runId: receipt.workflowRunId,
      runAttempt: receipt.workflowRunAttempt,
      artifactDigest: receipt.evidenceDigest,
    },
  };
  const sourceText = `github-actions:rollback-drill:${receipt.workflowRunId}:${receipt.workflowRunAttempt}`;
  const signed = (
    gate,
    semantic,
    lifetimeMinutes,
    artifactDigest = receipt.evidenceDigest,
  ) => {
    if (!Number.isFinite(lifetimeMinutes) || lifetimeMinutes <= 0)
      throw new Error(`Invalid evidence lifetime for ${gate}`);
    return signRuntimeReleaseClaim(
      {
        ...common,
        gate,
        source: { ...common.source, artifactDigest },
        observedAt,
        expiresAt: new Date(
          observedMs + lifetimeMinutes * 60_000,
        ).toISOString(),
        observation: buildCanonicalReleaseObservation(gate, {
          status: "verified",
          observedAt,
          source: sourceText,
          ...semantic,
        }),
      },
      privateKey(),
    );
  };
  claims.push(
    signed(
      "healthObservation",
      { httpStatus: 200, healthy: true },
      HEALTH_EVIDENCE_LIFETIME_MINUTES,
      fileDigest(healthPath),
    ),
    signed(
      "rollbackObservation",
      {
        drillCompleted: true,
        imageDigest: attestation.imageDigest,
        restoredHealth: true,
      },
      ROLLBACK_EVIDENCE_LIFETIME_MINUTES,
    ),
  );
  const nextBundle = { schemaVersion: 1, claims };
  const verified = verifyRuntimeReleaseEvidenceBundle(nextBundle, {
    policy,
    runtime,
    now: Date.now(),
  });
  if (!verified.ok)
    throw new Error(
      `Rollback bundle self-verification failed: ${verified.errors.join(",")}`,
    );
  fs.writeFileSync(output, `${JSON.stringify(nextBundle, null, 2)}\n`);
  console.log(
    `Added exact rollback and renewed health claims for run ${receipt.workflowRunId}.`,
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
else if (command === "create-staging-observations")
  createStagingObservationsBundle();
else if (command === "add-rollback-observation") addRollbackObservation();
else if (command === "verify") verifyBundle();
else
  throw new Error(
    "Usage: runtime-release-evidence.mjs <create-staging|create-staging-observations|add-rollback-observation|verify> ...",
  );
