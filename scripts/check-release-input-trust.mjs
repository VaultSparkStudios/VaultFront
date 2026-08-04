#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleaseInputTrust } from "./lib/release-input-trust.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = checkReleaseInputTrust(root, {
  release: process.argv.includes("--release"),
});
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
