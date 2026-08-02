#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "./lib/safe-spawn.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const write = args.some((arg) =>
  ["--repair", "--write", "--bootstrap", "--adopt"].includes(arg),
);

function run(script, scriptArgs = []) {
  return (
    spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", script), ...scriptArgs],
      {
        cwd: ROOT,
        stdio: "inherit",
      },
    ).status ?? 1
  );
}

if (write && run("render-startup-brief.mjs") !== 0) process.exit(1);
process.exit(run("validate-brief-format.mjs", ["docs/STARTUP_BRIEF.md"]));
