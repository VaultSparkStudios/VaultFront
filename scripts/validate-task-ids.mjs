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
const lines = src.split(/\r?\n/);

// Match table rows: `| NNN | ...` where NNN is an integer (task ID column).
// Skip header separators (`| --- |`) and non-numeric first cells.
const rowRe = /^\|\s*(\d+)\s*\|/;
const ids = new Map(); // id -> [{ line, snippet }]

// Audit-result tables (header `| Audit ID | ... |`) reuse small sequential
// numbers (1..N) as per-audit row indices — NOT task IDs. They must not be
// validated for cross-table uniqueness, or every closed audit collides with
// the next. Skip a table's rows once its header declares "Audit ID"; a blank
// line / non-table line ends the table block and re-enables counting.
let inAuditTable = false;

lines.forEach((line, idx) => {
  if (!/^\s*\|/.test(line)) {
    inAuditTable = false;
    return;
  }
  if (/^\|\s*audit id\s*\|/i.test(line)) {
    inAuditTable = true;
    return;
  }
  if (inAuditTable) return;
  const m = line.match(rowRe);
  if (!m) return;
  const id = Number(m[1]);
  const snippet = line.slice(0, 120);
  if (!ids.has(id)) ids.set(id, []);
  ids.get(id).push({ line: idx + 1, snippet });
});

const duplicates = [...ids.entries()]
  .filter(([, rows]) => rows.length > 1)
  .map(([id, rows]) => ({ id, count: rows.length, rows }));

const total = ids.size;
const ok = duplicates.length === 0;

if (JSON_OUT) {
  console.log(JSON.stringify({ ok, total, duplicates, path: TARGET }, null, 2));
  process.exit(ok ? 0 : 1);
}

if (ok) {
  console.log(
    `✓ TASK_BOARD ID integrity — ${total} unique IDs, no duplicates.`,
  );
  process.exit(0);
}

console.error(
  `✗ TASK_BOARD ID integrity FAIL — ${duplicates.length} duplicate ID(s):`,
);
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
