#!/usr/bin/env node
import fs from "node:fs";
import {
  createStagingAttestation,
  verifyStagingAttestation,
} from "./lib/staging-attestation.mjs";

const args = process.argv.slice(2);
const command = args.shift();
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const required = (name) => {
  const result = value(name);
  if (!result) throw new Error(`${name} is required`);
  return result;
};

if (command === "create") {
  const output = value("--output", "staging-attestation.json");
  const attestation = createStagingAttestation({
    repository: required("--repository"),
    workflowRunId: required("--run-id"),
    workflowRunAttempt: required("--run-attempt"),
    gitSha: required("--git-sha"),
    origin: required("--origin").replace(/\/$/u, ""),
    imageDigest: required("--image-digest"),
    healthResponse: fs.readFileSync(required("--health-response"), "utf8"),
    revisionResponse: fs.readFileSync(required("--revision-response"), "utf8"),
  });
  fs.writeFileSync(output, `${JSON.stringify(attestation, null, 2)}\n`);
  console.log(`WROTE ${output} ${attestation.attestationDigest}`);
} else if (command === "verify") {
  const attestation = JSON.parse(
    fs.readFileSync(required("--attestation"), "utf8"),
  );
  const run = JSON.parse(fs.readFileSync(required("--run-metadata"), "utf8"));
  const result = verifyStagingAttestation(attestation, run, {
    repository: required("--repository"),
    maxAgeMs: Number(value("--max-age-ms", 86_400_000)),
  });
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
      fs.appendFileSync(
        githubOutput,
        `image_digest=${result.imageDigest}\ngit_sha=${result.gitSha}\norigin=${result.origin}\nattestation_digest=${attestation.attestationDigest}\n`,
      );
    }
    console.log(`PASS staging attestation ${attestation.attestationDigest}`);
  }
} else {
  throw new Error("Usage: staging-attestation.mjs <create|verify> ...");
}
