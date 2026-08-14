#!/usr/bin/env node
// check-last-session-summary.mjs — ensure cached last-session prose names the latest completed session.
//
// Usage:
//   node scripts/check-last-session-summary.mjs [--json]
//   node scripts/check-last-session-summary.mjs --fix   # self-heal from currentFocus when coherent
//
// Exit: 0 = coherent (or healed) · 1 = stale/missing/unparseable (and not healable).
//
// WHY --fix exists (S210): lastSessionSummary was a required-fresh field with a detector
// but NO writer — so it silently went stale (S208 prose survived the S209 closeout). The
// agent-maintained `currentFocus` always names the session just completed, so when it
// already names the expected (latest SIL) session we can mirror it into lastSessionSummary.
// Wired into closeout → coherent-by-construction, can't drift again.

import fs from "node:fs";
import path from "node:path";
import {
  latestSilSession as latestLedgerSession,
  parseSilSessions,
} from "./lib/sil-ledger.mjs";
import { writeProjectStatus } from "./lib/write-project-status.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const JSON_OUT = process.argv.includes("--json");
const FIX = process.argv.includes("--fix");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function extractSessionId(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object")
    return extractSessionId(value.session ?? value.id ?? value.label ?? "");
  const text = String(value);
  const match =
    text.match(/\bS(?:ession\s*)?(\d+)\b/i) ||
    text.match(/\bSession\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function latestSilSession(silText) {
  return latestLedgerSession(silText);
}

export function evaluateLastSessionSummary({ status = {}, silText = "" } = {}) {
  const expected =
    latestSilSession(silText) ?? extractSessionId(status.currentSession);
  const actual = extractSessionId(status.lastSessionSummary);
  if (!expected)
    return {
      ok: false,
      expected,
      actual,
      reason: "latest SIL session unavailable",
    };
  if (!actual)
    return {
      ok: false,
      expected,
      actual,
      reason: "lastSessionSummary has no session marker",
    };
  if (actual !== expected)
    return {
      ok: false,
      expected,
      actual,
      reason: `expected S${expected}, summary says S${actual}`,
    };
  return {
    ok: true,
    expected,
    actual,
    reason: `lastSessionSummary coherent at S${actual}`,
  };
}

export function run(root = ROOT) {
  const status = readJson(
    path.join(root, "context", "PROJECT_STATUS.json"),
    {},
  );
  const silText = readText(
    path.join(root, "context", "SELF_IMPROVEMENT_LOOP.md"),
  );
  return evaluateLastSessionSummary({ status, silText });
}

// deriveSummaryFromSil (S264): build an honest summary line straight from the
// latest SIL ledger entry — the canonical, append-only record of what the
// session actually was. Used when currentFocus cannot heal (e.g. a recovery
// session whose focus names the RECOVERED session, not the one that closed:
// exactly how S263's summary froze at S261 for two closeouts).
export function deriveSummaryFromSil(silText = "") {
  const expected = latestSilSession(silText);
  if (!expected) return null;
  // S276 — this used to copy the header's stat string VERBATIM after re-matching it
  // locally. That made the summary carry the session's ORIGINAL total even when a later
  // `Score revised: X → Y` addendum superseded it (S275 read 982, settled 985). The file
  // already imported the ledger for the session NUMBER, so it looked governed while the
  // SCORE came from a private match. Both now come from the parsed entry.
  const entry = parseSilSessions(silText).find((e) => e.session === expected);
  if (!entry || !entry.date) return null;

  const parts = [];
  if (entry.total != null) {
    // When a session was rescored, say so — the ledger header still shows the base
    // number, and a summary that silently disagrees with it reads as a typo.
    parts.push(
      entry.baseTotal != null && entry.total !== entry.baseTotal
        ? `Total: ${entry.total}/${entry.max ?? 1000} (revised from ${entry.baseTotal})`
        : `Total: ${entry.total}/${entry.max ?? 1000}`,
    );
  }
  if (Number.isFinite(entry.velocity))
    parts.push(`Velocity: ${entry.velocity}`);
  if (parts.length === 0) return null;

  const win =
    silText.slice(entry.sourceIndex).match(/^\*\*Win:\*\*\s+([^\n]+)/m)?.[1] ??
    "";
  const winSnippet = win
    ? ` Win: ${win.slice(0, 180)}${win.length > 180 ? "…" : ""}`
    : "";
  return `S${expected} (${entry.date}, from SIL ledger): ${parts.join(" | ")}.${winSnippet}`;
}

// Self-heal: mirror currentFocus → lastSessionSummary ONLY when currentFocus already
// names the expected (latest-completed) session; otherwise (S264) fall back to a
// summary DERIVED from the latest SIL ledger entry — never fabricated, always
// sourced from the append-only session record.
export function fix(root = ROOT) {
  const statusPath = path.join(root, "context", "PROJECT_STATUS.json");
  const status = readJson(statusPath, {});
  const silText = readText(
    path.join(root, "context", "SELF_IMPROVEMENT_LOOP.md"),
  );
  const verdict = evaluateLastSessionSummary({ status, silText });
  if (verdict.ok) return { ...verdict, healed: false };
  const focusSession = extractSessionId(status.currentFocus);
  let healedFrom;
  if (focusSession && focusSession === verdict.expected) {
    status.lastSessionSummary = String(status.currentFocus);
    healedFrom = "currentFocus";
  } else {
    const derived = deriveSummaryFromSil(silText);
    if (!derived) {
      return {
        ...verdict,
        healed: false,
        healable: false,
        reason: `${verdict.reason}; currentFocus names S${focusSession ?? "?"} (not S${verdict.expected}) and SIL entry unparsable — cannot auto-heal`,
      };
    }
    status.lastSessionSummary = derived;
    healedFrom = "sil-ledger";
  }
  writeProjectStatus(root, status, { touchLastUpdated: false });
  const after = evaluateLastSessionSummary({ status, silText });
  return {
    ...after,
    healed: true,
    reason: `healed from ${healedFrom} → S${after.actual}`,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = FIX ? fix() : run();
  if (JSON_OUT) console.log(JSON.stringify(result));
  else
    console.log(
      `${result.ok ? "✓" : "⚠"} last-session-summary: ${result.reason}`,
    );
  process.exit(result.ok ? 0 : 1);
}
