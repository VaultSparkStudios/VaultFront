import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spawnSync } from "../../scripts/lib/safe-spawn.mjs";
import { PROCESS_INTEGRATION_TIMEOUT_MS } from "../helpers/processBudget";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function runNode(args: string[]) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
  });
}

describe("Studio /start → /go protocol smoke", () => {
  it(
    "advertises both protocol entry points from the dispatcher",
    () => {
      const result = runNode(["scripts/ops.mjs"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("startup-brief");
      expect(result.stdout).toContain("genius-list");
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );

  it(
    "routes /go through ops.mjs without losing the JSON contract",
    () => {
      const result = runNode(["scripts/ops.mjs", "genius-list", "--json"]);

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.project).toBe("vaultfront");
      expect(Array.isArray(payload.items)).toBe(true);
      expect(payload.items.length).toBeGreaterThan(0);
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );
});
