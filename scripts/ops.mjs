#!/usr/bin/env node
/**
 * ops.mjs — Studio OS operations orchestrator.
 *
 * Top-level dispatcher for studio workflow subcommands.
 * Each subcommand delegates to the relevant standalone script.
 *
 * Usage:
 *   node scripts/ops.mjs <subcommand> [args...]
 *
 * Subcommands:
 *   blocker-preflight     Run scripts/blocker-preflight.mjs
 *   startup-brief         Run scripts/render-startup-brief.mjs
 *   closeout-board        Run scripts/render-closeout-board.mjs
 *   genius-list           Run scripts/generate-genius-list.mjs --write
 *   innovation-pack       Run scripts/innovation-pack.mjs
 *   write-session-lock    Run scripts/write-session-lock.mjs
 *   check-secrets         Run scripts/check-secrets.mjs
 *   doctor                Print project health summary
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandArgs, OPS_COMMANDS } from "./lib/ops-command-registry.mjs";
import { spawnSync } from "./lib/safe-spawn.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = __dirname;

const [, , subcommand, ...rest] = process.argv;

if (!subcommand) {
  console.log("Usage: node scripts/ops.mjs <subcommand> [args...]");
  console.log("Subcommands:", Object.keys(OPS_COMMANDS).join(", "));
  process.exit(0);
}

const command = OPS_COMMANDS[subcommand];
if (!command) {
  console.error(`ops.mjs: unknown subcommand '${subcommand}'`);
  console.error("Known subcommands:", Object.keys(OPS_COMMANDS).join(", "));
  process.exit(1);
}

const scriptPath = path.join(SCRIPTS, command.script);
const mappedArgs = commandArgs(subcommand, rest);
const result = spawnSync(process.execPath, [scriptPath, ...mappedArgs], {
  stdio: "inherit",
});
process.exit(result.status ?? 0);
