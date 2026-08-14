#!/usr/bin/env node
/**
 * flaky-trend.mjs — shared lib for flaky-test trend tracking (S166 · [SIL][S165 #1]).
 *
 * The S165 isolation-retry counts a solo-pass as honest `flaky` in
 * PROJECT_STATUS.testsFlaky — but a chronically flaky test could be silently
 * retried forever, the retry becoming a crutch rather than a net. This lib keeps
 * a per-session flaky ledger (portfolio/FLAKY_HISTORY.json) and computes
 * consecutive-session streaks so the doctor can escalate any test flaky ≥N
 * sessions running to a root-cause task.
 *
 * Honest by construction (CANON-031): a session with a clean run (test not in
 * the flaky set) resets that test's streak. Streaks count only real recorded
 * sessions, never interpolate gaps.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioOpsRoot = path.resolve(__dirname, "..", "..");
const HISTORY = path.join(studioOpsRoot, "portfolio", "FLAKY_HISTORY.json");

/** Sessions older than this many entries are pruned (bounded ledger). */
const MAX_SESSIONS = 50;
/** Default streak length that triggers root-cause escalation. */
export const ESCALATE_STREAK = 3;

export function loadHistory(file = HISTORY) {
  if (!fs.existsSync(file)) return { schemaVersion: "1.0", sessions: [] };
  try {
    const h = JSON.parse(fs.readFileSync(file, "utf8"));
    h.sessions = Array.isArray(h.sessions) ? h.sessions : [];
    return h;
  } catch {
    return { schemaVersion: "1.0", sessions: [] };
  }
}

/**
 * Record (or replace) the flaky set for a session. Latest run of a session wins
 * — re-running the suite in the same session overwrites that session's entry.
 * Returns the updated history (also written to disk unless file === null).
 */
export function recordFlaky({ session, date, flaky }, file = HISTORY) {
  const h = loadHistory(file);
  const sess = String(session ?? "unknown");
  const entry = {
    session: sess,
    date: date || new Date().toISOString().slice(0, 10),
    flaky: [...new Set(flaky || [])].sort(),
  };
  const idx = h.sessions.findIndex((s) => String(s.session) === sess);
  if (idx >= 0) h.sessions[idx] = entry;
  else h.sessions.push(entry);
  // Keep chronological by session number when numeric, else insertion order.
  h.sessions.sort(
    (a, b) => numericSession(a.session) - numericSession(b.session),
  );
  if (h.sessions.length > MAX_SESSIONS)
    h.sessions = h.sessions.slice(-MAX_SESSIONS);
  if (file) fs.writeFileSync(file, JSON.stringify(h, null, 2) + "\n", "utf8");
  return h;
}

function numericSession(s) {
  const n = parseInt(String(s).replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Compute per-test consecutive-session streaks anchored at the most recent
 * recorded session. A streak is the count of consecutive most-recent sessions
 * in which the test appeared flaky (broken the moment a session lacks it).
 *
 * Returns { latestSession, sparkline, streaks: [{file, streak}], escalate: [...] }
 * where escalate = streaks with streak >= threshold (default ESCALATE_STREAK).
 */
export function computeTrend(
  history = loadHistory(),
  threshold = ESCALATE_STREAK,
) {
  const sessions = (history.sessions || [])
    .slice()
    .sort((a, b) => numericSession(a.session) - numericSession(b.session));
  const sparkline = sessions.map((s) => (s.flaky || []).length);
  const latest = sessions[sessions.length - 1] || null;
  const streaks = [];
  if (latest) {
    for (const f of latest.flaky || []) {
      let streak = 0;
      for (let i = sessions.length - 1; i >= 0; i--) {
        if ((sessions[i].flaky || []).includes(f)) streak++;
        else break;
      }
      streaks.push({ file: f, streak });
    }
  }
  streaks.sort((a, b) => b.streak - a.streak);
  return {
    latestSession: latest?.session ?? null,
    sessionsTracked: sessions.length,
    sparkline,
    currentFlakyCount: latest ? (latest.flaky || []).length : 0,
    streaks,
    escalate: streaks.filter((s) => s.streak >= threshold),
  };
}

export const HISTORY_PATH = HISTORY;

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--record")) {
    // Pull the current flaky set + session from PROJECT_STATUS.json.
    const sp = path.join(studioOpsRoot, "context", "PROJECT_STATUS.json");
    const j = JSON.parse(fs.readFileSync(sp, "utf8"));
    const h = recordFlaky({
      session: j.currentSession,
      date: j.testsLastRun,
      flaky: j.testsFlaky || [],
    });
    console.log(
      `✓ recorded flaky set for S${j.currentSession}: ${(j.testsFlaky || []).length} flaky (${h.sessions.length} sessions tracked)`,
    );
    process.exit(0);
  }
  const trend = computeTrend();
  if (args.includes("--json")) {
    console.log(JSON.stringify(trend, null, 2));
  } else {
    console.log(
      `Flaky trend · ${trend.sessionsTracked} sessions · current ${trend.currentFlakyCount} flaky · spark ${trend.sparkline.join(" ")}`,
    );
    for (const s of trend.streaks)
      console.log(
        `  ${s.streak >= ESCALATE_STREAK ? "⚠" : "·"} ${s.file} — ${s.streak} consecutive session(s)`,
      );
    if (trend.escalate.length)
      console.log(
        `\n⚠ ${trend.escalate.length} test(s) flaky ≥${ESCALATE_STREAK} sessions — open a root-cause task.`,
      );
  }
  process.exit(trend.escalate.length ? 1 : 0);
}

export default {
  loadHistory,
  recordFlaky,
  computeTrend,
  ESCALATE_STREAK,
  HISTORY_PATH,
};
