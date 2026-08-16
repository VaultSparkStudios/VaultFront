#!/usr/bin/env node
import fs from "node:fs";
import { createReleaseAdmission } from "./lib/release-admission.mjs";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  const found = index >= 0 ? args[index + 1] : null;
  if (!found) throw new Error(`${name} is required`);
  return found;
};
const readJson = (name) => JSON.parse(fs.readFileSync(value(name), "utf8"));

const result = createReleaseAdmission({
  readiness: readJson("--readiness"),
  revision: fs.readFileSync(value("--revision"), "utf8"),
  attestation: readJson("--attestation"),
  repository: value("--repository"),
  origin: value("--origin"),
});
if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  const output = value("--output");
  fs.writeFileSync(output, `${JSON.stringify(result.receipt, null, 2)}\n`);
  console.log(`PASS release admission ${result.receipt.admissionDigest}`);
}
