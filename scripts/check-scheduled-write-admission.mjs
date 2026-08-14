#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "./lib/safe-spawn.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const trigger = args.includes("--scheduled")
  ? "scheduled-routine"
  : process.env.SESSION_TRIGGER ||
    process.env.STUDIO_SESSION_TRIGGER ||
    "unknown";
const projectIndex = args.indexOf("--project");
const project = projectIndex >= 0 ? args[projectIndex + 1] : "studio-ops";
const jsonMode = args.includes("--json");
const modeIndex = args.indexOf("--write-mode");
const writeMode = modeIndex >= 0 ? args[modeIndex + 1] : "telemetry";
const scheduled =
  /^(schedule|scheduled|scheduled-routine|routine|cron|timer)$/i.test(trigger);

if (!scheduled) {
  const result = {
    ok: true,
    decision: "allow",
    reason: `interactive trigger ${trigger}`,
    project,
  };
  console.log(
    jsonMode
      ? JSON.stringify(result, null, 2)
      : `ALLOW scheduled-write admission: ${result.reason}`,
  );
  process.exit(0);
}
if (writeMode === "git") {
  let policy = {};
  try {
    policy = JSON.parse(
      readFileSync(
        path.join(ROOT, "portfolio", "FLEET_SCHEDULE_POLICY.json"),
        "utf8",
      ),
    );
  } catch {}
  if (policy?.policy?.scheduledGitWritesAllowed !== true) {
    const result = {
      ok: false,
      decision: "deny",
      reason:
        "fleet policy forbids scheduled Git publication; use Analytica/R2 or an Ark receipt",
      project,
      trigger,
      writeMode,
    };
    console.log(
      jsonMode
        ? JSON.stringify(result, null, 2)
        : `DENY scheduled-write admission: ${result.reason}`,
    );
    process.exit(2);
  }
}

const beacon = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "scripts", "session-beacon.mjs"),
    "check",
    "--project",
    project,
    "--require-clear",
    "--json",
  ],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  },
);
let detail = {};
try {
  detail = JSON.parse(beacon.stdout || "{}");
} catch {}
const ok = beacon.status === 0 && detail.ok === true;
const result = {
  ok,
  decision: ok ? "allow" : "deny",
  reason: ok
    ? "no active remotely visible session lease"
    : detail.detail || "session lease truth unavailable",
  project,
  trigger,
  beacon: detail,
};
console.log(
  jsonMode
    ? JSON.stringify(result, null, 2)
    : `${ok ? "ALLOW" : "DENY"} scheduled-write admission: ${result.reason}`,
);
process.exit(ok ? 0 : 2);
