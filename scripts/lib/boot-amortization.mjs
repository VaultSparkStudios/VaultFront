// boot-amortization.mjs — S176 [audit #5]. Persist the per-session boot-amortization metric the
// harness computes-but-DISCARDS, and expose the trailing-average helper the doctor probe reads.
//
// session-economics.bootAmortization() is computed live in session-floor.mjs every session, then
// thrown away — so the one signal that makes Codex's 4-10min wasted-boot sessions VISIBLE never
// reaches a persisted surface. This module records it into PROJECT_STATUS at closeout and the
// gentle doctor probe (check-boot-amortization.mjs) reads the trailing average.
//
// HONESTY CAVEAT (S175): the harness context-meter undercounts real usage (measured 0× here), so a
// ratio of null/unknown is NOT a wasted boot — it is an UNMEASURED boot. The recorder stores it
// honestly (ratio:null, verdict:'unknown') and trailingMeasuredAvg ignores unmeasured samples, so
// the probe can only warn on a genuine measured run of low ratios — never on a missing denominator.

import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "./safe-spawn.mjs";
import { bootAmortization } from "./session-economics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..", "..");

export const HISTORY_CAP = 10;
export const MIN_SAMPLES_TO_WARN = 3; // never warn on < 3 measured samples
export const WASTED_AVG_BAND = 1.5; // trailing measured avg < this (thin/wasted) → warn

// Read the live context-meter and classify this session's boot amortization. Returns the same shape
// as bootAmortization() plus the raw token inputs (for transparency in the persisted record).
export function liveAmortization(root = ROOT) {
  // S264: `j.usedTokens ?? 0` was the S262 non-measurement class again — a null
  // meter reading became workTokens=0 → ratio=0 → a MEASURED-looking "wasted"
  // verdict. 9 of the 10 live history rows were fabricated zeros, and the
  // boot-amortization probe was chronic-red on data that never existed. A
  // non-measurement must reach bootAmortization as unmeasured (ratio:null).
  let usedTokens = null,
    startupTokens = 0;
  try {
    const out = spawnSync(
      "node",
      [path.join(root, "scripts", "context-meter.mjs"), "--json"],
      { encoding: "utf8" },
    );
    const j = JSON.parse(out.stdout);
    const measured = j.measured_ok !== false && j.usedTokens != null;
    if (measured) {
      usedTokens = j.usedTokens;
      startupTokens = j.freshSessionBootstrap ?? 0;
    }
  } catch {
    /* unmeasured → unknown below */
  }
  if (usedTokens == null) {
    return {
      ...bootAmortization({ workTokens: 0, startupTokens: 0 }),
      workTokens: null,
      startupTokens: null,
    };
  }
  const workTokens = Math.max(0, usedTokens - startupTokens);
  const amort = bootAmortization({ workTokens, startupTokens });
  return { ...amort, workTokens, startupTokens };
}

export function inferTrigger(meta = {}, env = process.env) {
  return (
    meta.trigger ||
    meta.triggerType ||
    env.TRIGGER_TYPE ||
    env.SESSION_TRIGGER ||
    env.STUDIO_SESSION_TRIGGER ||
    env.CODEX_SESSION_TRIGGER ||
    env.CLAUDE_SESSION_TRIGGER ||
    env.GITHUB_EVENT_NAME ||
    ""
  );
}
export function isScheduledTrigger(trigger) {
  // S240 [audit #10] — `scheduled-routine` is the typed value the session-lock
  // contract uses (trigger: founder-mission | recovery | scheduled-routine | ad-hoc).
  return /^(schedule|scheduled|scheduled-routine|routine|cron|timer|workflow_dispatch:scheduled)$/i.test(
    String(trigger || ""),
  );
}

// S240 [audit #10] — session-lock trigger provenance. The lock is the one
// surface EVERY agent (Claude Code, Codex, cloud routines) writes at start, so
// a typed `trigger:` row there classifies the whole session without needing
// env vars to survive into every child process. Returns '' when absent.
export function readLockTrigger(root = ROOT) {
  try {
    const lock = fsSync.readFileSync(
      path.join(root, "context", ".session-lock"),
      "utf8",
    );
    const m = lock.match(/^trigger:\s*(\S+)/m);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

// S248 [audit #3] — trigger provenance loss root-fix. The lock is cleared by the
// harness's global Stop hook, so a closeout/finalize that runs AFTER the hook
// (the S247 23:09 row's fingerprint) reads no lock and records an untyped row
// even though the session WAS typed. Fix: capture the typed trigger to a
// session cache WHILE the lock exists (every context-meter/closeout touchpoint),
// and resolve from that cache when the lock is already gone. The cache carries
// the lock's session_start + capture time so a stale value never leaks across
// sessions (24h fence); an unresolvable trigger stays honestly empty.
const TRIGGER_CACHE_REL = path.join(".cache", "session-trigger.json");

export function captureLockTrigger(root = ROOT) {
  const trigger = readLockTrigger(root);
  if (!trigger) return "";
  try {
    const lock = fsSync.readFileSync(
      path.join(root, "context", ".session-lock"),
      "utf8",
    );
    const sessionStart = lock.match(/^session_start:\s*(\S+)/m)?.[1] ?? null;
    fsSync.mkdirSync(path.join(root, ".cache"), { recursive: true });
    fsSync.writeFileSync(
      path.join(root, TRIGGER_CACHE_REL),
      JSON.stringify(
        { trigger, sessionStart, capturedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
  } catch {
    /* capture is best-effort; the live lock read below still works */
  }
  return trigger;
}

export function resolveSessionTrigger(root = ROOT, { maxAgeHours = 24 } = {}) {
  const live = readLockTrigger(root);
  if (live) return live;
  try {
    const j = JSON.parse(
      fsSync.readFileSync(path.join(root, TRIGGER_CACHE_REL), "utf8"),
    );
    if (
      j?.trigger &&
      Number.isFinite(Date.parse(j.capturedAt)) &&
      Date.now() - Date.parse(j.capturedAt) < maxAgeHours * 3600 * 1000
    )
      return j.trigger;
  } catch {
    /* no cache → honestly unknown */
  }
  return "";
}

// PURE: stamp `status.bootAmortization` and push onto a bounded `status.bootAmortizationHistory`.
// `ranAt` is passed in (no clock here — the caller stamps it, keeping this unit-testable). Mutates
// and returns the status object.
export function recordAmortization(
  status,
  amort,
  ranAt,
  cap = HISTORY_CAP,
  meta = {},
) {
  const trigger = inferTrigger({
    ...meta,
    trigger: amort.trigger ?? meta.trigger,
  });
  const scheduled = isScheduledTrigger(trigger);
  const record = {
    ratio: amort.ratio ?? null,
    verdict: scheduled ? "scheduled-routine" : (amort.verdict ?? "unknown"),
    ranAt,
    ...(trigger ? { trigger } : {}),
  };
  status.bootAmortization = record;
  const hist = Array.isArray(status.bootAmortizationHistory)
    ? status.bootAmortizationHistory
    : [];
  hist.push(record);
  status.bootAmortizationHistory = hist.slice(-cap);
  return status;
}

// PURE: is a history row UNTYPED — a measured (non-scheduled) session that carries no `trigger:`
// provenance at all? These are the S240 defect's fingerprint: a scheduled/cloud routine whose lock
// never stamped `trigger: scheduled-routine`, so it reads as an anonymous founder boot. We CANNOT
// prove it was a routine (that would be fabrication), only that its provenance is unknown.
function isUntyped(h) {
  if (!h) return false;
  if (h.verdict === "scheduled-routine" || isScheduledTrigger(h.trigger))
    return false; // typed-scheduled
  return !h.trigger; // measured but no trigger row → provenance unknown
}

// PURE: trailing average over MEASURED (non-null) ratios only. Returns { avg, samples, scheduledCount,
// untyped } — avg is null when there are no measured samples (an honestly unmeasurable history, never
// a warning). `untyped` counts measured samples with no `trigger:` provenance (S245 [audit R08]).
export function trailingMeasuredAvg(history = []) {
  const arr = Array.isArray(history) ? history : [];
  const scheduledCount = arr.filter(
    (h) => h?.verdict === "scheduled-routine" || isScheduledTrigger(h?.trigger),
  ).length;
  const measuredRows = arr.filter(
    (h) =>
      h?.verdict !== "scheduled-routine" &&
      !isScheduledTrigger(h?.trigger) &&
      h &&
      typeof h.ratio === "number",
  );
  const untyped = measuredRows.filter(isUntyped).length;
  const measured = measuredRows.map((h) => h.ratio);
  if (!measured.length)
    return { avg: null, samples: 0, scheduledCount, untyped };
  const avg = measured.reduce((a, b) => a + b, 0) / measured.length;
  return {
    avg: Math.round(avg * 100) / 100,
    samples: measured.length,
    scheduledCount,
    untyped,
  };
}

// PURE: the gentle-probe verdict. WARN only on a genuine measured run of low ratios; an unmeasured
// or short history is green (honest — you cannot flag what you cannot measure).
//
// S245 [audit R08] — OBSERVABILITY HONESTY (CANON-031). The old message asserted every low-ratio
// measured session was "a session ending before amortizing its boot" — i.e. founder waste. But when
// the measured set is DOMINATED by untyped sessions (no `trigger:` provenance), the metric cannot
// tell an unstamped cloud routine from a real short founder session. Asserting "founder waste" there
// is a lie. So: still WARN (something IS mis-stamped and worth fixing — see R06 / docs/CLAUDE_ROUTINES.md),
// but the detail names the untyped provenance instead of pretending it measured founder inefficiency.
export function amortizationProbe(history = []) {
  const { avg, samples, scheduledCount, untyped } =
    trailingMeasuredAvg(history);
  const scheduledNote = scheduledCount
    ? ` · ${scheduledCount} scheduled routine(s) excluded`
    : "";
  if (samples < MIN_SAMPLES_TO_WARN || avg == null) {
    return {
      pass: true,
      warn: false,
      detail: `boot-amortization unmeasured/insufficient (${samples}/${MIN_SAMPLES_TO_WARN} measured samples)${scheduledNote} — no signal`,
      avg,
      samples,
      scheduledCount,
      untyped,
    };
  }
  if (avg < WASTED_AVG_BAND) {
    // Untyped provenance dominates → do NOT claim founder waste; name the real gap (unstamped triggers).
    if (untyped > samples / 2) {
      return {
        pass: false,
        warn: true,
        detail: `trailing boot-amortization ${avg}× over ${samples} sessions${scheduledNote} — ${untyped}/${samples} untyped (no trigger: provenance; likely unstamped routine sessions, not measured founder waste — see docs/CLAUDE_ROUTINES.md)`,
        avg,
        samples,
        scheduledCount,
        untyped,
      };
    }
    return {
      pass: false,
      warn: true,
      detail: `trailing boot-amortization ${avg}× over ${samples} sessions < ${WASTED_AVG_BAND}×${scheduledNote} — sessions ending before amortizing their boot`,
      avg,
      samples,
      scheduledCount,
      untyped,
    };
  }
  return {
    pass: true,
    warn: false,
    detail: `trailing boot-amortization ${avg}× over ${samples} sessions${scheduledNote} — healthy`,
    avg,
    samples,
    scheduledCount,
    untyped,
  };
}

export default {
  liveAmortization,
  recordAmortization,
  trailingMeasuredAvg,
  amortizationProbe,
  inferTrigger,
  isScheduledTrigger,
  readLockTrigger,
  HISTORY_CAP,
  MIN_SAMPLES_TO_WARN,
  WASTED_AVG_BAND,
};
