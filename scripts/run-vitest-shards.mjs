#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

const WORKER_START_FAILURE =
  /(?:timeout|timed out|failed|unable)\s+(?:while\s+)?(?:to\s+)?start(?:ing)?\s+(?:a\s+)?worker|worker[^\n]{0,80}(?:startup|start)[^\n]{0,80}(?:timeout|timed out)|tinypool[^\n]{0,80}(?:timeout|timed out)/i;

export function classifyVitestFailure(result = {}) {
  if ((result.status ?? 1) === 0 && !result.error) return "passed";
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join("\n");
  return WORKER_START_FAILURE.test(output)
    ? "worker-start-exhaustion"
    : "test-failure";
}

function printCaptured(result) {
  if (result.stdout) process.stdout.write(String(result.stdout));
  if (result.stderr) process.stderr.write(String(result.stderr));
}

function writeAttemptSummary(root, summary) {
  const directory = join(root, ".cache", "vitest-shards");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "latest.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
}

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

export function runVitestShards({
  root = ROOT,
  spawn = spawnSync,
  maxWorkers = Number(process.env.VITEST_MAX_WORKERS) || Infinity,
  writeSummary = false,
} = {}) {
  if (
    maxWorkers !== Infinity &&
    (!(maxWorkers > 0) || !Number.isInteger(maxWorkers))
  ) {
    throw new Error("VITEST_MAX_WORKERS must be a positive integer");
  }
  const plan = createShardPlan();
  const summary = validateShardPlan(plan);
  const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
  const attempts = [];
  let exitCode = 0;
  for (const shard of plan) {
    const effectiveWorkers = Math.min(shard.maxWorkers, maxWorkers);
    const workerPlan = [
      effectiveWorkers,
      Math.max(1, Math.floor(effectiveWorkers / 2)),
    ].filter((workers, index, values) => values.indexOf(workers) === index);
    for (let attempt = 0; attempt < workerPlan.length; attempt += 1) {
      const workers = workerPlan[attempt];
      console.log(
        "\n[vitest-shard] " +
          shard.name +
          ": " +
          shard.files.length +
          " files, maxWorkers=" +
          workers +
          (attempt ? " (infrastructure retry)" : ""),
      );
      const result = spawn(
        process.execPath,
        [
          vitest,
          "run",
          ...shard.files,
          "--exclude=.cache/**",
          "--maxWorkers=" + workers,
        ],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          stdio: "pipe",
        },
      );
      printCaptured(result);
      const classification = classifyVitestFailure(result);
      attempts.push({
        shard: shard.name,
        attempt: attempt + 1,
        workers,
        status: result.status ?? 1,
        classification,
      });
      if (result.error && classification !== "worker-start-exhaustion") {
        if (writeSummary) {
          writeAttemptSummary(root, {
            schemaVersion: 1,
            state: "failed",
            fileCount: summary.fileCount,
            shardCount: summary.shardCount,
            attempts,
          });
        }
        throw result.error;
      }
      if (classification === "passed") break;
      const canRetry =
        classification === "worker-start-exhaustion" &&
        attempt + 1 < workerPlan.length;
      if (canRetry) {
        console.warn(
          "[vitest-shard] worker-start exhaustion detected; retrying " +
            shard.name +
            " once at maxWorkers=" +
            workerPlan[attempt + 1],
        );
        continue;
      }
      exitCode = result.status ?? 1;
      break;
    }
    if (exitCode !== 0) break;
  }
  const state = exitCode === 0 ? "passed" : "failed";
  if (writeSummary) {
    writeAttemptSummary(root, {
      schemaVersion: 1,
      state,
      fileCount: summary.fileCount,
      shardCount: summary.shardCount,
      attempts,
    });
  }
  if (exitCode === 0) {
    console.log(
      "\n[vitest-shard] complete: " +
        summary.fileCount +
        " files across " +
        summary.shardCount +
        " shards",
    );
  }
  return exitCode;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) process.exitCode = runVitestShards({ writeSummary: true });
