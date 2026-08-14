#!/usr/bin/env node
// check-writeback-currency.mjs — did the last working session actually write back?
//
// THE GAP THIS CLOSES (S272, found live).
// Every pre-existing coherence probe compares surface against surface:
//   · closeout-session-coherence — status must not CLAIM more than the surfaces contain
//   · session-number-freshness   — PROJECT_STATUS must not LAG SIL/handoff
// Both are satisfied when every surface agrees at S<n>. Neither can see the
// opposite failure: the surfaces agree with each other and are all equally
// WRONG, because real work landed in git afterwards and closeout never ran.
//
// That is exactly what happened after S269: two working blocks (186 files,
// +38k lines — Studio Ops Console v1, CANON-054/055, CANON-053 bypass fixes,
// twin alwaysApprove, sanitize-by-content) were committed and pushed, but the
// closeout write-back never executed. Tree stayed clean, every surface still
// said S269, every coherence probe stayed green, and the drift was invisible.
//
// So this probe measures surfaces against GIT REALITY instead.
//
// ANCHOR CHOICE (deliberate): the newest commit touching
// context/SELF_IMPROVEMENT_LOOP.md. SIL is append-only and written exactly once
// per closeout, which makes it the only true closeout fingerprint. Do NOT anchor
// on PROJECT_STATUS.json — the live incident had a test-receipt-only commit
// (`chore(proof): S271 full-suite receipt`) touching PROJECT_STATUS without a
// closeout, which would have laundered the debt into a false green.
//
// Exit: 0 = current (or in-flight) · 1 = write-back debt.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "./lib/safe-spawn.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const JSON_OUT = process.argv.includes("--json");
const EXPLAIN =
  process.argv.includes("--explain") || process.argv.includes("--repair-plan");

/** The append-only closeout fingerprint. One commit per closeout, never generated. */
export const WRITE_BACK_ANCHOR = "context/SELF_IMPROVEMENT_LOOP.md";

/**
 * Commits whose SUBJECT marks them as an out-of-session automation lane or a
 * pure receipt/regeneration commit. These land on main without a human session
 * and must never be mistaken for un-written-back work.
 */
// `chore(closeout)` is included deliberately: those commits ARE the closeout
// (receipt capture, rebased-surface regeneration) and legitimately land after
// the SIL anchor. Counting them as debt would make every clean closeout dirty.
export const AUTOMATION_SUBJECT_RE =
  /^(?:chore\((?:routine-[\w-]+|closeout|ledgers?|proof|deps|release-please)\)|Merge (?:branch|pull request|remote-tracking)|Revert ")/i;

/**
 * Paths that are generated, appended by tooling, or pure receipts. A commit that
 * touches ONLY these is churn, not session work — regardless of its subject.
 */
export const GENERATED_PATH_RES = [
  /^portfolio\/.*\.ndjson$/i,
  /^portfolio\/ark\/log\//i,
  /^reports?\//i,
  /^docs\/AUDIT_\d{4}-\d{2}-\d{2}-routine\./i,
  /^docs\/STARTUP_BRIEF/i,
  /^docs\/FRONTIER_CAPABILITY_RADAR\.md$/i,
  /^docs\/CLOSEOUT_CHECKLIST\.md$/i,
  /\.lock$/i,
];

export function isGeneratedPath(file = "") {
  const p = String(file).replace(/\\/g, "/");
  return GENERATED_PATH_RES.some((re) => re.test(p));
}

/**
 * A commit counts as SUBSTANTIVE session work when it is not an automation-lane
 * subject AND it touches at least one non-generated file.
 */
export function isSubstantiveCommit(commit = {}) {
  if (AUTOMATION_SUBJECT_RE.test(String(commit.subject || ""))) return false;
  const files = Array.isArray(commit.files) ? commit.files : [];
  if (!files.length) return false; // empty/merge commit — nothing to write back
  return files.some((f) => !isGeneratedPath(f));
}

/**
 * Pure core. `commits` is newest-first, each { sha, subject, isoDate, files[] }.
 *
 * @param {number} staleHours grace window: a session that just committed and is
 *   still running has legitimate un-written-back work. Only once the newest
 *   substantive commit is older than this do we call it an abandoned closeout.
 *   Bounded AGE, never calendar-day identity (S266 freshness rule).
 */
export function evaluateWriteBackCurrency({
  commits = [],
  nowMs = null,
  staleHours = 12,
} = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const anchorIdx = commits.findIndex((c) =>
    (c.files || []).some(
      (f) => String(f).replace(/\\/g, "/") === WRITE_BACK_ANCHOR,
    ),
  );

  if (anchorIdx === -1) {
    return {
      ok: true,
      inFlight: false,
      debtCount: 0,
      anchor: null,
      reason: `no ${WRITE_BACK_ANCHOR} commit in the inspected range — cannot measure write-back currency`,
      unmeasured: true,
      debt: [],
    };
  }

  const anchor = commits[anchorIdx];
  const debt = commits.slice(0, anchorIdx).filter(isSubstantiveCommit);

  if (!debt.length) {
    return {
      ok: true,
      inFlight: false,
      debtCount: 0,
      anchor: {
        sha: anchor.sha,
        subject: anchor.subject,
        isoDate: anchor.isoDate,
      },
      reason: `write-back current — no substantive commits since ${anchor.sha} (${anchor.isoDate})`,
      unmeasured: false,
      debt: [],
    };
  }

  // AGE IS MEASURED FROM THE **OLDEST** UN-WRITTEN-BACK COMMIT, not the newest.
  // Anchoring on the newest lets a single fresh commit mask days-old debt behind
  // it — the exact way the live incident stayed invisible: work from 2026-08-06
  // sat un-written-back while 2026-08-07 commits kept the "newest" age at ~1h.
  // A genuinely in-flight session has ALL its commits inside the grace window,
  // so oldest-anchoring stays correct for the in-flight case and strictly
  // stronger for the abandoned-closeout case.
  const newest = debt[0];
  const oldest = debt[debt.length - 1];
  const oldestMs = Date.parse(oldest.isoDate);
  const ageHours = Number.isFinite(oldestMs)
    ? (now - oldestMs) / 3_600_000
    : Infinity;
  const inFlight = ageHours < staleHours;

  return {
    ok: inFlight,
    inFlight,
    unmeasured: false,
    debtCount: debt.length,
    ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(1)) : null,
    staleHours,
    anchor: {
      sha: anchor.sha,
      subject: anchor.subject,
      isoDate: anchor.isoDate,
    },
    newest: {
      sha: newest.sha,
      subject: newest.subject,
      isoDate: newest.isoDate,
    },
    oldest: {
      sha: oldest.sha,
      subject: oldest.subject,
      isoDate: oldest.isoDate,
    },
    debt: debt.map((c) => ({
      sha: c.sha,
      subject: c.subject,
      isoDate: c.isoDate,
    })),
    reason: inFlight
      ? `${debt.length} substantive commit(s) since last closeout write-back (${anchor.sha}), oldest ${ageHours.toFixed(1)}h old — session likely in flight`
      : `WRITE-BACK DEBT — ${debt.length} substantive commit(s) landed after the last closeout write-back (${anchor.sha}, ${anchor.isoDate}); oldest is ${ageHours.toFixed(1)}h old (≥${staleHours}h). A session ended without running closeout.`,
  };
}

/** Actionable repair steps — the surfaces a skipped closeout left behind. */
export function repairPlanForWriteBackCurrency(result = {}) {
  if (result.ok || !result.debtCount) return [];
  const range = result.anchor ? `${result.anchor.sha}..HEAD` : "HEAD~20..HEAD";
  return [
    {
      step: "reconstruct",
      action: `Read the un-written-back work: git log --stat ${range}`,
    },
    {
      step: "CURRENT_STATE",
      action:
        "context/CURRENT_STATE.md — describe the shipped behaviour those commits changed.",
    },
    {
      step: "LATEST_HANDOFF",
      action:
        "context/LATEST_HANDOFF.md — prepend the authoritative handoff for the recovered session.",
    },
    {
      step: "WORK_LOG",
      action: "logs/WORK_LOG.md — append the session entry.",
    },
    {
      step: "DECISIONS",
      action:
        "context/DECISIONS.md — append any decisions those commits encode (append-only).",
    },
    {
      step: "SELF_IMPROVEMENT_LOOP",
      action:
        "context/SELF_IMPROVEMENT_LOOP.md — append the SIL entry; this is the anchor that clears this probe.",
    },
    {
      step: "PROJECT_STATUS",
      action:
        "context/PROJECT_STATUS.json — refresh currentFocus/lastUpdated (CANON-031 invariant holds).",
    },
  ];
}

/** Read commits from git. Newest-first, with the file list per commit. */
export function readCommits(root = ROOT, limit = 60) {
  const res = spawnSync(
    "git",
    [
      "log",
      `-${limit}`,
      "--name-only",
      "--date=iso-strict",
      "--format=%x00%H%x1f%ad%x1f%s",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (res.status !== 0) return [];
  const commits = [];
  for (const block of String(res.stdout || "").split("\0")) {
    if (!block.trim()) continue;
    const [header, ...rest] = block.split("\n");
    const [sha, isoDate, subject] = header.split("\x1f");
    if (!sha) continue;
    commits.push({
      sha: sha.slice(0, 8),
      isoDate: (isoDate || "").trim(),
      subject: (subject || "").trim(),
      files: rest.map((l) => l.trim()).filter(Boolean),
    });
  }
  return commits;
}

export function run(root = ROOT, opts = {}) {
  if (!fs.existsSync(path.join(root, ".git"))) {
    return {
      ok: true,
      unmeasured: true,
      debtCount: 0,
      debt: [],
      reason: "not a git repository — write-back currency unmeasured",
    };
  }
  return evaluateWriteBackCurrency({
    commits: readCommits(root, opts.limit || 60),
    ...opts,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = run();
  const payload = EXPLAIN
    ? { ...result, repairPlan: repairPlanForWriteBackCurrency(result) }
    : result;
  if (JSON_OUT) console.log(JSON.stringify(payload));
  else {
    console.log(
      `${result.ok ? "✓" : "⛔"} writeback-currency: ${result.reason}`,
    );
    if (!result.ok)
      for (const c of result.debt)
        console.log(`   · ${c.sha} ${c.isoDate.slice(0, 10)} ${c.subject}`);
    if (EXPLAIN)
      for (const s of repairPlanForWriteBackCurrency(result))
        console.log(`- ${s.step}: ${s.action}`);
  }
  process.exit(result.ok ? 0 : 1);
}
