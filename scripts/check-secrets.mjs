#!/usr/bin/env node
/**
 * check-secrets.mjs — Secrets discovery CLI (v3.1)
 *
 * Agents MUST run this (or call `resolveCapability` from lib/secrets.mjs)
 * before labeling a task "Human Action Required". AGENTS.md v3.1 rule.
 *
 * Usage:
 *   node scripts/check-secrets.mjs                        # list all capabilities
 *   node scripts/check-secrets.mjs --for <capability>     # check one
 *   node scripts/check-secrets.mjs --json                 # machine output
 *   node scripts/check-secrets.mjs --for claude.api --json
 *   node scripts/check-secrets.mjs --for cloudflare --probe [--refresh]
 *                                  # S266 (S259 #1): action-scoped grade —
 *                                  # ACTION-VERIFIED / DEGRADED, not just presence
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gradeCapability,
  probeableCapabilities,
} from "./lib/capability-action-probes.mjs";
import { listCapabilities, resolveCapability } from "./lib/secrets.mjs";

const args = process.argv.slice(2);
const capArg = args.includes("--for") ? args[args.indexOf("--for") + 1] : null;
const json = args.includes("--json");
const probe = args.includes("--probe");
const refresh = args.includes("--refresh");
// S271: --emit writes a machine-readable capability STATUS artifact for the
// Studio Ops Console. It records capability names, readiness grade, and WHICH
// env var names are absent — never a value, never a partial value. The console
// is a browser surface; secrets resolve server-side through the gateway only
// (CANON-012). Without this artifact the console's secrets tile is honestly
// unavailable rather than guessed, which is why it is emitted explicitly.
const emit = args.includes("--emit");

function emitCapabilityStatus(rows) {
  const capabilities = rows.map((r) => ({
    capability: r.capability,
    ok: Boolean(r.ok),
    status: r.ok ? "READY" : (r.found || []).length > 0 ? "PARTIAL" : "MISSING",
    requiredCount: (r.required || []).length,
    presentCount: (r.found || []).length,
    missingKeys: r.missing || [], // NAMES only — no values, ever
  }));
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/check-secrets.mjs --emit",
    contract:
      "capability names and absent env-var NAMES only; never values (CANON-012)",
    total: capabilities.length,
    ready: capabilities.filter((c) => c.status === "READY").length,
    partial: capabilities.filter((c) => c.status === "PARTIAL").length,
    missing: capabilities.filter((c) => c.status === "MISSING").length,
    capabilities,
  };
  const out = new URL("../portfolio/CAPABILITY_STATUS.json", import.meta.url);
  fs.mkdirSync(path.dirname(fileURLToPath(out)), { recursive: true });
  fs.writeFileSync(fileURLToPath(out), JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `✓ capability status → portfolio/CAPABILITY_STATUS.json  (${payload.ready}/${payload.total} ready · ${payload.partial} partial · ${payload.missing} missing)`,
  );
}

function render(rows) {
  if (json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return;
  }
  const cols = [
    ["Capability", 32],
    ["Status", 10],
    ["Keys present", 42],
  ];
  const line = cols.map(([h, w]) => h.padEnd(w)).join(" ");
  const sep = cols.map(([, w]) => "─".repeat(w)).join(" ");
  console.log("\n" + line);
  console.log(sep);
  for (const r of rows) {
    const status = r.ok
      ? "✓ READY   "
      : r.found.length
        ? "⚠ PARTIAL "
        : "⛔ MISSING ";
    const keys = r.ok
      ? `${r.found.length}/${r.required.length} all present`
      : r.missing.length > 3
        ? `missing ${r.missing.length}: ${r.missing.slice(0, 2).join(", ")}…`
        : `missing: ${r.missing.join(", ")}`;
    console.log(
      r.capability.padEnd(32) + " " + status.padEnd(10) + " " + keys.padEnd(42),
    );
  }
  console.log("");
  const ready = rows.filter((r) => r.ok).length;
  console.log(
    `${ready}/${rows.length} capabilities ready. Missing → see docs/STUDIO_CANON.md + TASK_BOARD Human Action Required.`,
  );
  console.log("");
}

if (probe) {
  // Action-scoped grading: one capability, or every capability with a probe.
  const caps = capArg ? [capArg] : probeableCapabilities();
  const graded = caps.map((c) => gradeCapability(c, { refresh }));
  if (json) {
    process.stdout.write(JSON.stringify(graded, null, 2) + "\n");
  } else {
    console.log("");
    for (const g of graded) {
      const badge = {
        "ACTION-VERIFIED": "✓ ACTION-VERIFIED",
        DEGRADED: "⚠ DEGRADED",
        READY: "✓ READY (presence-only)",
        PARTIAL: "⚠ PARTIAL",
        MISSING: "⛔ MISSING",
      }[g.grade];
      console.log(
        `${g.capability.padEnd(28)} ${badge}${g.cached ? " (cached)" : ""}`,
      );
      if (g.action) console.log(`${"".padEnd(28)}   action: ${g.action}`);
      if (g.detail) console.log(`${"".padEnd(28)}   ${g.detail}`);
    }
    console.log("");
  }
  process.exit(
    graded.every((g) => g.grade === "ACTION-VERIFIED" || g.grade === "READY")
      ? 0
      : 1,
  );
} else if (capArg) {
  const result = resolveCapability(capArg);
  render([{ capability: capArg, ...result }]);
  process.exit(result.ok ? 0 : 1);
} else {
  const rows = listCapabilities().sort((a, b) =>
    a.capability.localeCompare(b.capability),
  );
  if (emit) emitCapabilityStatus(rows);
  else render(rows);
  process.exit(0);
}
