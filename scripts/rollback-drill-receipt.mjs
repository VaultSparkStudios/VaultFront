#!/usr/bin/env node
import fs from "node:fs";
import {
  createRollbackDrillReceipt,
  verifyRollbackDrillReceipt,
} from "./lib/rollback-drill-receipt.mjs";

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

if (command === "create") {
  const receipt = createRollbackDrillReceipt({
    repository: required("--repository"),
    workflowRunId: required("--workflow-run-id"),
    workflowRunAttempt: required("--workflow-run-attempt"),
    origin: required("--origin"),
    rollbackReason: required("--rollback-reason"),
    validationReceipt: json("--validation-receipt"),
    targetAttestation: json("--target-attestation"),
    replacedAttestation: json("--replaced-attestation"),
    rollbackHealth: fs.readFileSync(required("--rollback-health"), "utf8"),
    rollbackRevision: fs.readFileSync(required("--rollback-revision"), "utf8"),
    restoreHealth: fs.readFileSync(required("--restore-health"), "utf8"),
    restoreRevision: fs.readFileSync(required("--restore-revision"), "utf8"),
    startedAt: required("--started-at"),
    rolledBackAt: required("--rolled-back-at"),
  });
  const output = value("--output", "staging-rollback-drill.json");
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`WROTE ${output} ${receipt.evidenceDigest}`);
} else if (command === "verify") {
  const receipt = json("--receipt");
  const result = verifyRollbackDrillReceipt(receipt);
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`PASS staging rollback drill ${receipt.evidenceDigest}`);
  }
} else {
  throw new Error(
    "Usage: rollback-drill-receipt.mjs <create|verify> [options]",
  );
}
