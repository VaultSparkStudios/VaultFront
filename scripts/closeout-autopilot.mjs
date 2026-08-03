#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "./lib/safe-spawn.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const help = args.includes("--help") || args.includes("-h");
const dryRun = args.includes("--dry-run");
const skipPush = args.includes("--skip-push");
const messageIndex = args.indexOf("--message");
const message =
  messageIndex >= 0 && args[messageIndex + 1]
    ? args[messageIndex + 1]
    : "chore(vaultfront): close session";

if (help) {
  console.log(`Usage: node scripts/closeout-autopilot.mjs [--dry-run] [--skip-push] [--message <message>]

Project-scoped only. Runs doctor, brief validation, settings sanitization,
stages non-secret changes, scans staged content, commits, pushes main, clears
the session lock, and renders the closeout board. --dry-run performs no writes.`);
  process.exit(0);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return result;
}

function requireSuccess(label, result) {
  if ((result.status ?? 1) !== 0) {
    console.error(`closeout-autopilot failed at ${label}`);
    process.exit(result.status ?? 1);
  }
}

if (dryRun) {
  requireSuccess(
    "doctor",
    run(process.execPath, [path.join(ROOT, "scripts", "project-doctor.mjs")]),
  );
  const status = run("git", ["status", "--short"], { capture: true });
  requireSuccess("git-status", status);
  console.log(String(status.stdout ?? "").trim() || "Working tree clean.");
  console.log("dry-run: no files staged, committed, pushed, or cleared");
  process.exit(0);
}

requireSuccess(
  "doctor",
  run(process.execPath, [
    path.join(ROOT, "scripts", "project-doctor.mjs"),
    "--update-json",
  ]),
);
requireSuccess(
  "startup-brief",
  run(process.execPath, [
    path.join(ROOT, "scripts", "render-startup-brief.mjs"),
  ]),
);
requireSuccess(
  "startup-brief-format",
  run(process.execPath, [
    path.join(ROOT, "node_modules", "prettier", "bin", "prettier.cjs"),
    "--write",
    "docs/STARTUP_BRIEF.md",
  ]),
);
requireSuccess(
  "brief-validation",
  run(process.execPath, [
    path.join(ROOT, "scripts", "validate-brief-format.mjs"),
    "docs/STARTUP_BRIEF.md",
  ]),
);
requireSuccess(
  "settings-sanitization",
  run(process.execPath, [
    path.join(ROOT, "scripts", "sanitize-project-settings.mjs"),
  ]),
);
requireSuccess(
  "git-add",
  run("git", ["add", "--all", "--", ".", ":(exclude)secrets/**"]),
);
requireSuccess(
  "staged-secret-scan",
  run(process.execPath, [
    path.join(ROOT, "scripts", "scan-secrets.mjs"),
    "--staged",
  ]),
);
requireSuccess("diff-preview", run("git", ["diff", "--cached", "--stat"]));
const staged = run("git", ["diff", "--cached", "--quiet"]);
if ((staged.status ?? 1) !== 0) {
  requireSuccess("commit", run("git", ["commit", "-m", message]));
}
let pushed = "no";
if (!skipPush) {
  requireSuccess("push", run("git", ["push", "origin", "main"]));
  pushed = "yes";
}
const lock = path.join(ROOT, "context", ".session-lock");
if (fs.existsSync(lock)) fs.unlinkSync(lock);
requireSuccess(
  "closeout-board",
  run(process.execPath, [
    path.join(ROOT, "scripts", "render-closeout-board.mjs"),
    "--pushed",
    pushed,
  ]),
);
const boardPath = "docs/CLOSEOUT_STATUS_BOARD.md";
const boardChanged = run("git", ["diff", "--quiet", "--", boardPath]);
if ((boardChanged.status ?? 1) !== 0) {
  requireSuccess("closeout-board-stage", run("git", ["add", "--", boardPath]));
  requireSuccess(
    "closeout-board-secret-scan",
    run(process.execPath, [
      path.join(ROOT, "scripts", "scan-secrets.mjs"),
      "--staged",
    ]),
  );
  requireSuccess(
    "closeout-board-commit",
    run("git", ["commit", "-m", "chore(vaultfront): record closeout board"]),
  );
  if (!skipPush) {
    requireSuccess(
      "closeout-board-push",
      run("git", ["push", "origin", "main"]),
    );
  }
}
