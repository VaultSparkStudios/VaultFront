#!/usr/bin/env node
import fs from "node:fs";
import {
  createPromotionOutcomeReceipt,
  createPromotionValidationReceipt,
  verifyPromotionOutcomeReceipt,
  verifyPromotionValidationReceipt,
} from "./lib/promotion-receipt.mjs";

const args = process.argv.slice(2);
const command = args.shift();
const value = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const required = (name) => {
  const result = value(name);
  if (!result) throw new Error(`${name} is required`);
  return result;
};
const json = (name) => JSON.parse(fs.readFileSync(required(name), "utf8"));
const write = (name, payload) => {
  const output = value("--output", name);
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`WROTE ${output} ${payload.evidenceDigest}`);
};
const expected = () => ({
  repository: required("--repository"),
  operation: required("--operation"),
  targetSubdomain: required("--target-subdomain"),
  stagingRunId: required("--staging-run-id"),
  replacedStagingRunId: value("--replaced-staging-run-id"),
  targetAttestationDigest: value("--target-attestation-digest"),
  replacedAttestationDigest: value("--replaced-attestation-digest"),
  rollbackReason: value("--rollback-reason"),
});

if (command === "create-validation") {
  write(
    "promotion-validation.json",
    createPromotionValidationReceipt({
      ...expected(),
      workflowRunId: required("--workflow-run-id"),
      workflowRunAttempt: required("--workflow-run-attempt"),
      targetAttestation: json("--target-attestation"),
      replacedAttestation: value("--replaced-attestation")
        ? json("--replaced-attestation")
        : null,
      createdAt: value("--created-at") || undefined,
    }),
  );
} else if (command === "verify-validation") {
  const receipt = json("--receipt");
  const result = verifyPromotionValidationReceipt(
    receipt,
    json("--run-metadata"),
    expected(),
  );
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`PASS promotion validation ${receipt.evidenceDigest}`);
  }
} else if (command === "create-outcome") {
  const validationReceipt = json("--validation-receipt");
  const receipt = createPromotionOutcomeReceipt({
    validationReceipt,
    validationRun: json("--validation-run-metadata"),
    expected: expected(),
    workflowRunId: required("--workflow-run-id"),
    workflowRunAttempt: required("--workflow-run-attempt"),
    productionOrigin: required("--production-origin"),
    healthResponse: fs.readFileSync(required("--health-response"), "utf8"),
    revisionResponse: fs.readFileSync(required("--revision-response"), "utf8"),
    startedAt: required("--started-at"),
    completedAt: value("--completed-at") || undefined,
  });
  write("promotion-outcome.json", receipt);
} else if (command === "verify-outcome") {
  const receipt = json("--receipt");
  const result = verifyPromotionOutcomeReceipt(receipt);
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`PASS promotion outcome ${receipt.evidenceDigest}`);
  }
} else {
  throw new Error(
    "Usage: promotion-receipt.mjs <create-validation|verify-validation|create-outcome|verify-outcome> ...",
  );
}
