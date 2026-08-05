#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeDoctorEvidence } from "./lib/doctor-evidence.mjs";
import { spawnSync } from "./lib/safe-spawn.mjs";
import { updateProjectStatus as mutateProjectStatus } from "./lib/write-project-status.mjs";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function probeResult(id, command, args, root) {
  const observedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  const exitCode = result.status ?? 1;
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  return {
    id,
    status: exitCode === 0 ? "pass" : "fail",
    source: [command, ...args].join(" "),
    observedAt,
    exitCode,
    detail: stderr || stdout || result.error?.message || `Exited ${exitCode}`,
    data: parseJson(stdout),
  };
}

export function runProjectDoctor({
  root = defaultRoot,
  truthOnly = false,
  forceFailure = false,
} = {}) {
  const probes = [
    {
      id: "release-metadata-truth",
      command: process.execPath,
      args: [
        path.join(defaultRoot, "scripts", "check-project-truth.mjs"),
        "--root",
        root,
        "--json",
      ],
    },
  ];
  if (!truthOnly) {
    probes.push(
      {
        id: "task-id-integrity",
        command: process.execPath,
        args: [path.join(defaultRoot, "scripts", "validate-task-ids.mjs")],
      },
      {
        id: "windows-spawn-hygiene",
        command: process.execPath,
        args: [path.join(defaultRoot, "scripts", "check-windows-hide.mjs")],
      },
      {
        id: "project-status-write-path",
        command: process.execPath,
        args: [
          path.join(defaultRoot, "scripts", "check-project-status-writers.mjs"),
          "--root",
          root,
        ],
      },
      {
        id: "client-reachability",
        command: process.execPath,
        args: [
          path.join(defaultRoot, "scripts", "check-client-reachability.mjs"),
        ],
      },
      {
        id: "runtime-feature-reachability",
        command: process.execPath,
        args: [
          path.join(
            defaultRoot,
            "scripts",
            "check-runtime-feature-reachability.mjs",
          ),
        ],
        blocking: true,
      },
      {
        id: "mutation-route-policy-coverage",
        command: process.execPath,
        args: ["scripts/check-route-policy-coverage.mjs"],
        blocking: true,
      },
      {
        id: "release-workflow-contract",
        command: process.execPath,
        args: [path.join(defaultRoot, "scripts", "check-deploy-contract.mjs")],
      },
      {
        id: "public-footer-manifest",
        command: process.execPath,
        args: [path.join(defaultRoot, "scripts", "check-footer-manifest.mjs")],
      },
      {
        id: "local-theme-proof",
        command: process.execPath,
        args: [
          path.join(defaultRoot, "scripts", "check-theme-proof-receipt.mjs"),
          "--root",
          root,
        ],
      },
      {
        id: "capability-reachability",
        command: process.execPath,
        args: [
          path.join(
            defaultRoot,
            "scripts",
            "check-capability-reachability.mjs",
          ),
          "--root",
          root,
        ],
      },
      {
        id: "certified-feedback-reachability",
        command: process.execPath,
        args: [
          path.join(
            defaultRoot,
            "scripts",
            "check-certified-feedback-reachability.mjs",
          ),
          "--root",
          root,
        ],
      },
      {
        id: "work-exhaustion",
        command: process.execPath,
        args: [
          path.join(defaultRoot, "scripts", "check-work-exhaustion.mjs"),
          "--root",
          root,
          "--json",
        ],
      },
    );
  }
  if (forceFailure) {
    probes.push({
      id: "forced-failure",
      command: process.execPath,
      args: ["-e", "process.exit(17)"],
    });
  }

  const checks = probes.map((probe) =>
    probeResult(probe.id, probe.command, probe.args, root),
  );
  const warnings = checks
    .flatMap((check) => check.data?.warnings ?? [])
    .filter((warning) => typeof warning === "string" && warning.length > 0);
  return {
    checks,
    warnings,
    blockingFailing: checks.filter((check) => check.status === "fail").length,
    observedAt: new Date().toISOString(),
    source: "scripts/project-doctor.mjs",
  };
}

export function updateProjectStatus(root, report) {
  const passing = report.checks.filter(
    (check) => check.status === "pass",
  ).length;
  const evidence = writeDoctorEvidence(root, report);
  const doctorScore = {
    passing,
    total: report.checks.length,
    score:
      report.checks.length === 0
        ? 0
        : Math.round((passing / report.checks.length) * 100),
    warning: report.warnings.length,
    warnings: report.warnings.length,
    failing: report.blockingFailing,
    blockingFailing: report.blockingFailing,
    date: report.observedAt.slice(0, 10),
    observedAt: report.observedAt,
    source: report.source,
    evidencePath: evidence.path,
    evidenceDigest: evidence.digest,
    evidenceSchemaVersion: evidence.schemaVersion,
    checkCount: evidence.checkCount,
  };
  mutateProjectStatus(root, (current) => ({ ...current, doctorScore }), {
    touchLastUpdated: false,
  });
}

function renderHuman(report) {
  const lines = ["Project doctor"];
  for (const check of report.checks) {
    lines.push(
      `${check.status === "pass" ? "PASS" : "FAIL"} ${check.id} (exit ${check.exitCode})`,
    );
  }
  for (const warning of report.warnings) lines.push(`WARN ${warning}`);
  lines.push(`blockingFailing: ${report.blockingFailing}`);
  lines.push(`observedAt: ${report.observedAt}`);
  return lines.join("\n");
}

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  const rootIndex = process.argv.indexOf("--root");
  const root =
    rootIndex >= 0 && process.argv[rootIndex + 1]
      ? path.resolve(process.argv[rootIndex + 1])
      : defaultRoot;
  const report = runProjectDoctor({
    root,
    truthOnly: process.argv.includes("--truth-only"),
    forceFailure: process.argv.includes("--force-failure"),
  });
  if (process.argv.includes("--update-json")) updateProjectStatus(root, report);
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(renderHuman(report));
  }
  process.exit(report.blockingFailing === 0 ? 0 : 1);
}
