import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandArgs,
  OPS_COMMANDS,
} from "../../scripts/lib/ops-command-registry.mjs";
import { spawnSync } from "../../scripts/lib/safe-spawn.mjs";

const root = process.cwd();

describe("Studio command surface", () => {
  it("maps every command to a real project-local target", () => {
    expect(Object.keys(OPS_COMMANDS).length).toBeGreaterThanOrEqual(16);
    for (const entry of Object.values(OPS_COMMANDS) as Array<{
      script: string;
    }>) {
      expect(
        fs.existsSync(path.join(root, "scripts", entry.script)),
        entry.script,
      ).toBe(true);
    }
    expect(commandArgs("genius-list", [])).toEqual(["--write"]);
    expect(commandArgs("doctor", ["--update-json"])).toEqual(["--update-json"]);
    expect(commandArgs("does-not-exist", [])).toBeNull();
  });

  it("covers every mandatory protocol command and standalone script", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-protocol-command-surface.mjs", "--json"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(result.status, String(result.stderr)).toBe(0);
    expect(JSON.parse(String(result.stdout))).toMatchObject({
      ok: true,
      errors: [],
    });
  });

  it("keeps closeout help inspection-only", () => {
    const before = spawnSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const help = spawnSync(
      process.execPath,
      ["scripts/ops.mjs", "closeout-autopilot", "--help"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const after = spawnSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(help.status, String(help.stderr)).toBe(0);
    expect(String(help.stdout)).toContain("Project-scoped only");
    expect(after.stdout).toBe(before.stdout);
  });
});
