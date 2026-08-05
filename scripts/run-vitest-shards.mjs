#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "./lib/safe-spawn.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ROOT = join(ROOT, "tests");
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

export const SHARD_POLICY = Object.freeze([
  { name: "root", roots: ["tests"], maxWorkers: 4, directOnly: true },
  {
    name: "client-core",
    roots: ["tests/client", "tests/core", "tests/economy", "tests/nukes"],
    maxWorkers: 4,
  },
  { name: "scripts", roots: ["tests/scripts"], maxWorkers: 1 },
  { name: "server", roots: ["tests/server"], maxWorkers: 4 },
]);

function toPosix(value) {
  return value.split(sep).join("/");
}

function walk(directory, directOnly = false) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      if (!directOnly) files.push(...walk(absolute));
      continue;
    }
    if (TEST_FILE.test(name)) files.push(toPosix(relative(ROOT, absolute)));
  }
  return files.sort();
}

export function discoverTestFiles() {
  return walk(TEST_ROOT);
}

export function createShardPlan(policy = SHARD_POLICY) {
  return policy.map((shard) => ({
    ...shard,
    files: shard.roots
      .flatMap((root) => walk(join(ROOT, root), shard.directOnly === true))
      .sort(),
  }));
}

export function validateShardPlan(
  plan = createShardPlan(),
  discovered = discoverTestFiles(),
) {
  const assigned = plan.flatMap((shard) => shard.files);
  const counts = new Map();
  for (const file of assigned) counts.set(file, (counts.get(file) ?? 0) + 1);
  const duplicates = [...counts]
    .filter(([, count]) => count > 1)
    .map(([file]) => file);
  const omitted = discovered.filter((file) => !counts.has(file));
  const unknown = assigned.filter((file) => !discovered.includes(file));
  if (duplicates.length || omitted.length || unknown.length) {
    throw new Error(
      "Invalid Vitest shard plan: duplicates=" +
        (duplicates.join(",") || "none") +
        "; omitted=" +
        (omitted.join(",") || "none") +
        "; unknown=" +
        (unknown.join(",") || "none"),
    );
  }
  return { fileCount: discovered.length, shardCount: plan.length };
}

export function runVitestShards({ root = ROOT, spawn = spawnSync } = {}) {
  const plan = createShardPlan();
  const summary = validateShardPlan(plan);
  const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
  for (const shard of plan) {
    console.log(
      "\n[vitest-shard] " +
        shard.name +
        ": " +
        shard.files.length +
        " files, maxWorkers=" +
        shard.maxWorkers,
    );
    const result = spawn(
      process.execPath,
      [vitest, "run", ...shard.files, "--maxWorkers=" + shard.maxWorkers],
      { cwd: root, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  console.log(
    "\n[vitest-shard] complete: " +
      summary.fileCount +
      " files across " +
      summary.shardCount +
      " shards",
  );
  return 0;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) process.exitCode = runVitestShards();
