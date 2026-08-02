#!/usr/bin/env node
import path from "node:path";
import {
  PROJECT_ROOT,
  resolveControlPlane,
} from "./lib/control-plane-tool.mjs";
import { spawnSync } from "./lib/safe-spawn.mjs";

const controlPlane = resolveControlPlane();
if (!controlPlane) {
  console.error("Missing Studio Ops control plane for settings sanitization.");
  process.exit(2);
}
const target = path.join(
  controlPlane,
  "scripts",
  "sanitize-claude-settings.mjs",
);
const settings = path.join(PROJECT_ROOT, ".claude", "settings.local.json");
const result = spawnSync(
  process.execPath,
  [target, "--path", settings, ...process.argv.slice(2)],
  { cwd: PROJECT_ROOT, stdio: "inherit" },
);
process.exit(result.status ?? 1);
