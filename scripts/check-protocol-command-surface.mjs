#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPS_COMMANDS } from "./lib/ops-command-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const protocol = fs.readFileSync(
  path.join(ROOT, "docs", "SESSION_PROTOCOL.md"),
  "utf8",
);
const documentedOps = new Set(
  [...protocol.matchAll(/node scripts\/ops\.mjs\s+([a-z0-9-]+)/g)].map(
    (match) => match[1],
  ),
);
const documentedScripts = new Set(
  [...protocol.matchAll(/node scripts\/([a-z0-9-]+\.mjs)/g)].map(
    (match) => match[1],
  ),
);
const OPTIONAL_STANDALONE = new Set([
  "studio-pulse.mjs",
  "render-founder-queue.mjs",
]);
const missingOps = [...documentedOps].filter(
  (command) =>
    command !== "session-plan" && !Object.hasOwn(OPS_COMMANDS, command),
);
const missingScripts = [...documentedScripts].filter(
  (script) =>
    !OPTIONAL_STANDALONE.has(script) &&
    !fs.existsSync(path.join(ROOT, "scripts", script)),
);
const missingTargets = Object.entries(OPS_COMMANDS)
  .filter(
    ([, entry]) => !fs.existsSync(path.join(ROOT, "scripts", entry.script)),
  )
  .map(([command, entry]) => `${command}->${entry.script}`);
const errors = [
  ...missingOps.map((entry) => `missing-ops:${entry}`),
  ...missingScripts.map((entry) => `missing-script:${entry}`),
  ...missingTargets.map((entry) => `missing-target:${entry}`),
];
const report = {
  ok: errors.length === 0,
  documentedOps: documentedOps.size,
  documentedScripts: documentedScripts.size,
  registeredOps: Object.keys(OPS_COMMANDS).length,
  errors,
};
if (process.argv.includes("--json"))
  console.log(JSON.stringify(report, null, 2));
else if (report.ok)
  console.log(
    `✓ protocol command surface: ${report.registeredOps} ops commands · ${report.documentedScripts} standalone references`,
  );
else console.error(errors.join("\n"));
if (!report.ok) process.exitCode = 1;
