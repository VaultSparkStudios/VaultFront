// doctor-predicates.mjs — S172 [audit #4]. Single source of truth for the three
// status predicates over a doctor check object, killing the divergent inline
// definitions that had drifted across surfaces (the S153 divergent-observability
// hazard, at the meta level the whole honesty arc fights).
//
// Before this lib, "is this a warning?" was hand-rolled in at least two places
// with DIFFERENT denominators:
//   • render-startup-brief.mjs  →  !pass && warn && !skipped   (yellow only)
//   • classify-warning-provenance.mjs → pass===false || warn===true  (non-green:
//        yellow AND red) — its own comment admitted "a broader non-green set".
// Those two answer genuinely DIFFERENT questions (a warning tally vs a
// classify-everyone-non-green pass), so the fix is not to force them equal — it
// is to NAME both predicates canonically and make every surface pick the right
// one EXPLICITLY, so the choice is auditable and can never silently drift again.
//
// A doctor check is one of:
//   • skipped — not run (pass:null, skipped:true). Never green/yellow/red.
//   • green   — ran and clean (pass:true, !warn).
//   • warning — ran, soft advisory (warn:true, !pass). The yellow tally.
//   • failing — ran and hard-failed (pass:false, !warn).
//   • advisory-pass — ran, SUCCEEDED, but still raised an advisory (pass:true
//     AND warn:true). S261 [audit #1].
// warn+pass:false together still reads as warning (the soft path dominates the
// founder signal); the doctor tally treats it that way (run-doctor.mjs).
//
// ── S261 [audit #1] · why the fifth state had to be NAMED ─────────────────────
// `pass:true + warn:true` is a REAL and deliberate probe idiom — run-doctor.mjs
// emits it wherever a probe succeeded but wants to flag something soft (e.g.
// `{ pass: true, warn: true, detail: 'heartbeat output unparseable' }`). But it
// matched NONE of the four predicates above: isGreen excludes it (warn===true),
// isWarning excludes it (pass===true), isFailing and isSkipped obviously so.
//
// On the live 2026-08-01 board that was 6 of 163 checks — validate,
// portfolio-infrastructure-court, session-telemetry-coverage, propagation-adoption,
// agents-md-drift, intelligence-doc-freshness. Summing the four canonical
// predicates gave 157/163: six checks classified as NOTHING. The buckets only
// LOOKED reconciled because run-doctor.mjs tallied `passing` from raw `r.pass`
// instead of isGreen, silently absorbing them — so their advisory never reached
// a single founder-facing surface. That is precisely the divergent-observability
// hazard this module was created to end, reappearing one level up: not two
// surfaces disagreeing, but a state no surface could name.
//
// The fix is the same shape as the original: NAME the state, make every tally
// route through the named predicates, and assert the partition holds so it can
// never silently reopen (see assertPartition / partitionCounts below).

export function isSkipped(c) {
  return c?.skipped === true;
}

// GREEN — ran and clean. (pass strictly true, not warning, not skipped.)
export function isGreen(c) {
  return !isSkipped(c) && c?.pass === true && c?.warn !== true;
}

// WARNING — the canonical yellow tally. Matches run-doctor.mjs's warning count
// and the brief's box tally: ran, not green, carries a warn flag. This is what
// "N warn" means on every founder-facing surface.
export function isWarning(c) {
  return !isSkipped(c) && c?.pass !== true && c?.warn === true;
}

// FAILING — ran, hard fail, no soft-warn flag. Reds the board / blocks closeout
// when blocking:true.
export function isFailing(c) {
  return !isSkipped(c) && c?.pass === false && c?.warn !== true;
}

// ADVISORY-PASS — S261 [audit #1]. Ran, SUCCEEDED, and still raised an advisory
// (pass:true AND warn:true). Green-with-a-note: it must never red or yellow the
// board, but its advisory must never be swallowed either. Disjoint from isGreen
// (which requires warn!==true) and from isWarning (which requires pass!==true).
export function isAdvisoryPass(c) {
  return !isSkipped(c) && c?.pass === true && c?.warn === true;
}

// NON-GREEN — the union the provenance classifier walks: every check that is not
// skipped and not green (warnings AND failures AND advisory-passes). Strictly a
// superset of isWarning. Use this when you mean "everything that needs an owner",
// and isWarning when you mean "the yellow count the founder reads".
export function isNonGreen(c) {
  return !isSkipped(c) && (c?.pass === false || c?.warn === true);
}

// ── The partition contract (S261 [audit #1]) ─────────────────────────────────
// The five states are mutually exclusive and jointly exhaustive over any check
// list. Every doctor-shaped tally MUST be derived from these counts rather than
// hand-rolled boolean arithmetic — that is what keeps a state from going unnamed
// again. `passing` is deliberately EXPOSED as green + advisoryPass so callers can
// keep reporting a familiar "passing" number without re-inventing raw `r.pass`.
export function partitionCounts(checks = []) {
  const list = Array.isArray(checks) ? checks : [];
  const skipped = list.filter(isSkipped).length;
  const green = list.filter(isGreen).length;
  const warning = list.filter(isWarning).length;
  const failing = list.filter(isFailing).length;
  const advisoryPass = list.filter(isAdvisoryPass).length;
  const total = list.length;
  const classified = skipped + green + warning + failing + advisoryPass;
  return {
    total,
    skipped,
    green,
    warning,
    failing,
    advisoryPass,
    // Ran = everything that actually executed. Score denominators use this.
    ran: total - skipped,
    // The founder-facing "passing" number: clean AND clean-with-a-note.
    passing: green + advisoryPass,
    classified,
    unclassified: total - classified,
  };
}

// Throws when the partition does not hold — i.e. some check matched no state.
// Callers that must not crash a board should use partitionCounts().unclassified
// directly and warn instead. Returns the counts so it composes inline.
export function assertPartition(checks = []) {
  const counts = partitionCounts(checks);
  if (counts.unclassified !== 0) {
    const orphans = (Array.isArray(checks) ? checks : [])
      .filter(
        (c) =>
          !isSkipped(c) &&
          !isGreen(c) &&
          !isWarning(c) &&
          !isFailing(c) &&
          !isAdvisoryPass(c),
      )
      .map(
        (c) =>
          `${c?.id ?? "<no id>"}(pass=${c?.pass},warn=${c?.warn},skipped=${c?.skipped})`,
      );
    throw new Error(
      `doctor-predicates partition violated: ${counts.unclassified} of ${counts.total} check(s) match no state — ${orphans.join(", ")}`,
    );
  }
  return counts;
}

export default {
  isSkipped,
  isGreen,
  isWarning,
  isFailing,
  isAdvisoryPass,
  isNonGreen,
  partitionCounts,
  assertPartition,
};
