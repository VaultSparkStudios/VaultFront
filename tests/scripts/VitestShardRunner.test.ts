import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createShardPlan,
  discoverTestFiles,
  runVitestShards,
  SHARD_POLICY,
  validateShardPlan,
} from "../../scripts/run-vitest-shards.mjs";

describe("bounded Vitest shard runner", () => {
  it("assigns every discovered test file exactly once", () => {
    const discovered = discoverTestFiles();
    const plan = createShardPlan();

    expect(validateShardPlan(plan, discovered)).toEqual({
      fileCount: discovered.length,
      shardCount: 4,
    });
    expect(plan.flatMap((shard) => shard.files)).toHaveLength(
      discovered.length,
    );
  });

  it("serializes subprocess-heavy script tests while bounding every shard", () => {
    expect(SHARD_POLICY).toMatchObject([
      { name: "root", maxWorkers: 4 },
      { name: "client-core", maxWorkers: 4 },
      { name: "scripts", maxWorkers: 1 },
      { name: "server", maxWorkers: 4 },
    ]);
  });

  it("runs shards sequentially and fails fast", () => {
    const calls: string[][] = [];
    const status = runVitestShards({
      spawn: (_command, args) => {
        calls.push(args as string[]);
        return { status: calls.length === 3 ? 7 : 0 } as never;
      },
    });

    expect(status).toBe(7);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("tests/AiAttackBehavior.test.ts");
    expect(calls[1]).toContain("tests/client/CertifiedMatchFeedback.test.ts");
    expect(calls[2]).toContain("tests/scripts/AuditRenderer.test.ts");
  });

  it("allows a bounded worker cap for resource-constrained hosts", () => {
    const calls: string[][] = [];
    const status = runVitestShards({
      maxWorkers: 1,
      spawn: (_command, args) => {
        calls.push(args as string[]);
        return { status: 0 } as never;
      },
    });

    expect(status).toBe(0);
    expect(calls).toHaveLength(4);
    expect(calls.every((args) => args.includes("--maxWorkers=1"))).toBe(true);
  });

  it("owns the canonical package test command", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    expect(pkg.scripts.test).toBe("node scripts/run-vitest-shards.mjs");
  });
});
