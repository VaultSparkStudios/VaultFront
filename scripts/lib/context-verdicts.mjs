// context-verdicts.mjs — single source of truth for the context-meter verdict
// vocabulary + their process exit codes.
//
// WHY THIS EXISTS (S198): the verdict set drifted. `context-meter.mjs` grew a 4th
// verdict (`WARN_COMPACT_SOON`, added for proactive-autosave) but its contract test
// (`tier1-context-meter-gate`) still hardcoded the original 3, so the suite went red
// whenever the meter emitted the new verdict. Worse, the meter intentionally exits
// non-zero (2/3) to let hooks/skills route on the verdict — and the test used
// `execSync`, which THROWS on any non-zero exit, so the test silently failed 3/4
// assertions whenever measured context was high enough to recommend CLOSEOUT.
//
// Both producer (context-meter.mjs) and contract test now import from here, so the
// vocabulary and exit codes can never drift apart again (coherent-by-construction).
//
// Exit-code contract (consumed by ~/.claude hooks + closeout skills):
//   CONTINUE          → 0   keep working
//   WARN_COMPACT_SOON → 0   soft warn; compaction predicted soon, autosave but continue
//   CONSIDER_CLOSEOUT → 2   wrap up soon
//   CLOSEOUT          → 3   stop now; continuation risks truncation
//   UNMEASURED        → 4   the gauge could not read anything — honest dark
//
// A non-zero exit is a ROUTING SIGNAL, not a failure — callers that only want the
// JSON must read stdout regardless of exit status (spawnSync, not execSync).
//
// ── UNMEASURED (S262, reported by vaultsparkstudios-website S302) ─────────────
// The meter used to fall through to a byte-count heuristic when NOTHING was
// readable — no Stop-hook ledger entry, no interactive turn, no live transcript —
// and then emit a percentage and a confident CONTINUE from it. In the field that
// produced "1.5% used · CONTINUE" for a session actually sitting at ~154% of its
// window: the one gauge whose whole purpose is to stop an agent from overrunning
// told it to keep going, and every downstream gate that consumed the reading
// inherited the lie.
//
// The byte heuristic was never a context measurement — it sums context FILE sizes,
// git churn, and hook metrics, none of which is the agent's window usage.
//
// UNMEASURED is deliberately neither 0 nor 3: an unreadable gauge must not be able
// to say "you're fine", exactly as it must not be able to say "you're broken".
// Consumers treat it as honest-dark — proceed if they have other grounds, but they
// may NOT report a context percentage, and they may NOT substitute 0.
export const VERDICTS = Object.freeze([
  "CONTINUE",
  "WARN_COMPACT_SOON",
  "CONSIDER_CLOSEOUT",
  "CLOSEOUT",
  "UNMEASURED",
]);

export const VERDICT_EXITS = Object.freeze({
  CONTINUE: 0,
  WARN_COMPACT_SOON: 0,
  CONSIDER_CLOSEOUT: 2,
  CLOSEOUT: 3,
  UNMEASURED: 4,
});

/** True when the verdict carries no usable context reading. */
export function isUnmeasured(v) {
  return v === "UNMEASURED";
}

export function isValidVerdict(v) {
  return VERDICTS.includes(v);
}

export function exitForVerdict(v) {
  return VERDICT_EXITS[v] ?? 0;
}

export function deriveContextUsage({ usedTokens = 0, limit = 0 } = {}) {
  const safeUsed = Number.isFinite(Number(usedTokens))
    ? Math.max(0, Number(usedTokens))
    : 0;
  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(0, Number(limit))
    : 0;
  const fraction = Math.max(
    0,
    Math.min(1, safeLimit > 0 ? safeUsed / safeLimit : 0),
  );
  const percent = fraction * 100;
  return Object.freeze({
    usedTokens: safeUsed,
    limit: safeLimit,
    remainingTokens: Math.max(0, safeLimit - safeUsed),
    fraction,
    percent,
    roundedPercent: Math.round(percent),
  });
}
