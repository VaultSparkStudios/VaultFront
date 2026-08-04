#!/usr/bin/env node
import fs from "node:fs";
import { normalizeKnownHostsEvidence } from "./lib/deploy-known-hosts.mjs";

const host = process.env.DEPLOY_SERVER_HOST?.trim();
const evidence = process.env.DEPLOY_KNOWN_HOSTS?.trim();
const output = process.argv[2];
if (!host || !evidence || !output)
  throw new Error(
    "DEPLOY_SERVER_HOST, DEPLOY_KNOWN_HOSTS, and output path are required",
  );
fs.writeFileSync(output, normalizeKnownHostsEvidence(host, evidence), {
  mode: 0o600,
});
console.log(`WROTE verified known_hosts evidence for ${host}`);
