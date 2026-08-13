#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const METRICS = ["lines", "statements", "functions", "branches"];
const ALWAYS_CRITICAL = [
  "src/server/ObeliskAuth.ts",
  "src/server/WorkerApiProxy.ts",
  "src/server/RemoteAiPolicy.ts",
  "src/server/ReleaseEvidenceContract.ts",
  "src/server/ServerCrashStore.ts",
  "src/server/FatalProcessCoordinator.ts",
];

export function normalizeCoveragePath(value) {
  return String(value).replaceAll("\\", "/");
}

export function deriveTrustCriticalCoverageOwners(root) {
  const owners = new Set();
  const ledgerPath = path.join(root, "src/server/StateScopeLedger.ts");
  if (fs.existsSync(ledgerPath)) {
    const ledger = fs.readFileSync(ledgerPath, "utf8");
    for (const block of ledger.split(/\}\),|\n\s*\},/u)) {
      if (!/releaseCritical:\s*true/u.test(block)) continue;
      const source = block.match(/sourceFile:\s*"([^"]+)"/u)?.[1];
      if (source) owners.add(normalizeCoveragePath(source));
    }
  }
  const serverRoot = path.join(root, "src/server");
  if (fs.existsSync(serverRoot)) {
    for (const entry of fs.readdirSync(serverRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const absolute = path.join(serverRoot, entry.name);
      const source = fs.readFileSync(absolute, "utf8");
      if (
        /assertRoutePolicyBinding\(|app\.(?:get|post)\("\/auth\//u.test(source)
      ) {
        owners.add(`src/server/${entry.name}`);
      }
    }
  }
  for (const source of ALWAYS_CRITICAL) {
    if (fs.existsSync(path.join(root, source))) owners.add(source);
  }
  return [...owners].sort();
}

export function evaluateCoverage(summary, baseline, requiredModules = []) {
  const failures = [];
  const tolerance = Number(baseline.tolerance ?? 0);

  function compare(label, actual, floors) {
    for (const metric of METRICS) {
      const pct = Number(actual?.[metric]?.pct);
      const floor = Number(floors?.[metric]);
      if (!Number.isFinite(pct)) {
        failures.push(`${label} ${metric}: missing coverage value`);
      } else if (!Number.isFinite(floor)) {
        failures.push(`${label} ${metric}: missing baseline floor`);
      } else if (pct + tolerance < floor) {
        failures.push(
          `${label} ${metric}: ${pct.toFixed(2)}% < ${floor.toFixed(2)}% floor`,
        );
      }
    }
  }

  compare("global", summary.total, baseline.global);
  const entries = Object.entries(summary).map(([key, value]) => [
    normalizeCoveragePath(key),
    value,
  ]);
  const reportedPaths = entries.map(([key]) => key);
  for (const modulePath of requiredModules) {
    if (!(modulePath in (baseline.criticalModules ?? {}))) {
      failures.push(`${modulePath}: missing trust-critical baseline floor`);
    }
  }
  for (const modulePath of baseline.observedModules ?? []) {
    const suffix = `/${normalizeCoveragePath(modulePath)}`;
    if (!reportedPaths.some((key) => key.endsWith(suffix))) {
      failures.push(`${modulePath}: missing from production coverage surface`);
    }
  }

  for (const [modulePath, floors] of Object.entries(
    baseline.criticalModules ?? {},
  )) {
    const suffix = `/${normalizeCoveragePath(modulePath)}`;
    const match = entries.find(([key]) => key.endsWith(suffix));
    if (!match) {
      failures.push(`${modulePath}: missing from coverage report`);
      continue;
    }
    compare(modulePath, match[1], floors);
  }

  return { ok: failures.length === 0, failures };
}

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  const root = process.cwd();
  const summaryPath = path.join(root, "coverage", "coverage-summary.json");
  const baselinePath = path.join(root, "coverage-baseline.json");
  if (!fs.existsSync(summaryPath) || !fs.existsSync(baselinePath)) {
    console.error(
      "Coverage ratchet requires coverage/coverage-summary.json and coverage-baseline.json",
    );
    process.exit(2);
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const requiredModules = deriveTrustCriticalCoverageOwners(root);
  const result = evaluateCoverage(summary, baseline, requiredModules);
  if (!result.ok) {
    console.error("Coverage ratchet failed:");
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    `Coverage ratchet passed: global floor + ${requiredModules.length} derived trust-critical owners + ${Object.keys(baseline.criticalModules ?? {}).length} measured floors`,
  );
}
