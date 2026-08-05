import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "./safe-spawn.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const CONTROL_PLANE_TOOL_POLICIES = new Map([
  ["append-genome-snapshot.mjs", { projectFlag: "--project" }],
  ["closeout-summary.mjs", { projectFlag: "--project" }],
  ["compute-entropy.mjs", { projectFlag: "--project" }],
  ["render-state-vector.mjs", { projectFlag: "--project" }],
  ["sample-codebase.mjs", { projectFlag: "--root" }],
  ["lib/skill-profile.mjs", { projectFlag: null }],
]);

export function prepareControlPlaneArgs(toolName, args = [], options = {}) {
  const policy = CONTROL_PLANE_TOOL_POLICIES.get(toolName);
  if (!policy)
    throw new Error(`control-plane-tool-not-allowlisted:${toolName}`);
  const forwarded = [...args];
  const projectFlag =
    options.projectScoped === false
      ? null
      : (options.projectFlag ?? policy.projectFlag);
  if (projectFlag && !forwarded.includes(projectFlag)) {
    forwarded.unshift(projectFlag, PROJECT_ROOT);
  }
  return forwarded;
}

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
  const forwarded = prepareControlPlaneArgs(toolName, args, options);
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
  const result = spawnSync(process.execPath, [target, ...forwarded], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export { PROJECT_ROOT };
