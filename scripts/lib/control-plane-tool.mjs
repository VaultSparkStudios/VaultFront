import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "./safe-spawn.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const PROJECT_SCOPED_TOOLS = new Set([
  "append-genome-snapshot.mjs",
  "closeout-summary.mjs",
  "compute-entropy.mjs",
  "render-state-vector.mjs",
]);

export function resolveControlPlane() {
  const candidates = [
    path.resolve(PROJECT_ROOT, "..", "vaultspark-studio-ops"),
    path.resolve(PROJECT_ROOT, "..", "..", "vaultspark-studio-ops"),
    path.resolve(PROJECT_ROOT, "..", "vaultspark-studio-ops-main"),
  ];
  return (
    candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, "docs", "STUDIO_CANON.md")),
    ) ?? null
  );
}

export function runControlPlaneTool(toolName, args = [], options = {}) {
  if (!PROJECT_SCOPED_TOOLS.has(toolName)) {
    throw new Error(`control-plane-tool-not-allowlisted:${toolName}`);
  }
  const controlPlane = resolveControlPlane();
  if (!controlPlane) {
    console.error(`Missing Studio Ops control plane for ${toolName}`);
    return 2;
  }
  const target = path.join(controlPlane, "scripts", toolName);
  if (!fs.existsSync(target)) {
    console.error(`Missing control-plane tool: ${target}`);
    return 2;
  }
  const forwarded = [...args];
  if (options.projectScoped !== false && !forwarded.includes("--project")) {
    forwarded.unshift("--project", PROJECT_ROOT);
  }
  const result = spawnSync(process.execPath, [target, ...forwarded], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export { PROJECT_ROOT };
