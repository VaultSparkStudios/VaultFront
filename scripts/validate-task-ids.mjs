#!/usr/bin/env node
/**
 * validate-task-ids.mjs — TASK_BOARD ID integrity check
 *
 * Parses context/TASK_BOARD.md, extracts all `| <id> |` task IDs from table rows,
 * reports duplicates, and exits non-zero if any duplicate exists.
 *
 * Wired into closeout autopilot as a pre-commit blocker (step 3d).
 *
 * Usage:
 *   node scripts/validate-task-ids.mjs              # default: ./context/TASK_BOARD.md
 *   node scripts/validate-task-ids.mjs --path <p>   # custom path
 *   node scripts/validate-task-ids.mjs --json       # machine-readable
 *
 * Exit codes:
 *   0 — no duplicates
 *   1 — one or more duplicate IDs
 *   2 — file missing / unreadable
 */

import fs from "fs";
import path from "path";
import { analyzeTaskBoard } from "./lib/task-board.mjs";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const pathIdx = args.indexOf("--path");
const TARGET =
  pathIdx >= 0
    ? args[pathIdx + 1]
    : path.resolve(process.cwd(), "context/TASK_BOARD.md");

if (!fs.existsSync(TARGET)) {
  const msg = `TASK_BOARD not found: ${TARGET}`;
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error(`✗ ${msg}`);
  process.exit(2);
}

const src = fs.readFileSync(TARGET, "utf8");
const analysis = analyzeTaskBoard(src);
const ids = new Map();
for (const row of analysis.taskRows) {
  const id = Number(row.idNumber);
  if (!ids.has(id)) ids.set(id, []);
  ids.get(id).push({ line: row.line, snippet: row.raw.slice(0, 120) });
}

const duplicates = [...ids.entries()]
  .filter(([, rows]) => rows.length > 1)
  .map(([id, rows]) => ({ id, count: rows.length, rows }));

const total = ids.size;
const structuralErrors = [];
if (!analysis.supported) {
  structuralErrors.push(
    "No supported task rows or explicit exhausted active-work contract found.",
  );
}
if (
  analysis.hasActiveSection &&
  analysis.activeRows.length === 0 &&
  !analysis.explicitExhaustion
) {
  structuralErrors.push(
    "Active task sections contain no parseable work and no explicit exhaustion marker.",
  );
}
const ok = duplicates.length === 0 && structuralErrors.length === 0;

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        ok,
        total,
        parsedRows: analysis.counts.parsed,
        counts: analysis.counts,
        representation: total > 0 ? "numeric-table" : "compact-checklist",
        explicitExhaustion: analysis.explicitExhaustion,
        structuralErrors,
        duplicates,
        path: TARGET,
      },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 1);
}

if (ok) {
  console.log(
    `✓ TASK_BOARD integrity — ${analysis.counts.parsed} parsed row(s) · ${total} numeric ID(s) · no duplicates · ${analysis.explicitExhaustion ? "explicitly exhausted" : analysis.counts.active + " active"}.`,
  );
  process.exit(0);
}

console.error(
  `✗ TASK_BOARD integrity FAIL — ${duplicates.length} duplicate ID(s), ${structuralErrors.length} structural error(s):`,
);
for (const error of structuralErrors) console.error(`  - ${error}`);
for (const { id, count, rows } of duplicates) {
  console.error(`\n  #${id} (${count}×):`);
  for (const r of rows) {
    console.error(`    line ${r.line}: ${r.snippet}…`);
  }
}
console.error(
  `\n  Fix: renumber the newer row(s) to a fresh unused ID (current max + 1).`,
);
process.exit(1);
