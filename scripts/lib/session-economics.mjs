// session-economics.mjs — S175. The shared engine that makes a /goal session
// SATURATE its budget instead of stopping at "one objective done".
//
// THE PROBLEM (founder, S175): Codex /goal sessions finish in 4-10 minutes and
// waste their startup context. Root cause is structural, not behavioral: Claude
// Code's /goal sets a Stop HOOK that BLOCKS termination until a condition holds,
// while Codex's /goal stop-condition (SESSION_PROTOCOL §2A.3) is "stop when the
// one bounded objective is verified" — a completion stop, so it terminates early.
//
// THE FIX: one shared, agent-neutral set of pure predicates that both harnesses
// consult, turning every /goal stop-condition from "completion-of-one" into
// "saturation-of-budget". Claude's Stop hook and Codex's session-floor loop both
// call sessionFloorVerdict(); the answer is identical because the math is here,
// once. (Same "N surfaces, one shared predicate" discipline as S174 ownership.)
//
// Pure + injectable — no I/O, no clocks. scripts/session-floor.mjs wires the live
// data sources (context-meter, skill-cost ledger, genius-list cache); this module
// is the math and is the unit-tested source of truth.

// Context-meter verdict thresholds (mirror scripts/context-meter.mjs semantics).
export const CLOSEOUT_PCT = 0.92; // hard stop — terminal exhausted
export const CONSIDER_PCT = 0.75; // soft — finish current item then stop

// Boot-amortization bands. ratio = workTokens / startupTokens. A session that
// boots (~25-40k: brief render + doctor) and ships almost nothing has a low
// ratio — a "wasted boot". This is the metric that makes Codex's short sessions
// VISIBLE (you cannot fix what you cannot see) and feeds the floor + min-value gate.
export const AMORTIZATION_BANDS = [
  {
    min: 0,
    verdict: "wasted",
    label: "wasted boot — startup cost barely amortized",
  },
  {
    min: 1.5,
    verdict: "thin",
    label: "thin — startup not yet paid back in work",
  },
  {
    min: 3,
    verdict: "healthy",
    label: "healthy — work clears startup several times over",
  },
  {
    min: 6,
    verdict: "excellent",
    label: "excellent — deep session, startup fully amortized",
  },
];

// Classify boot amortization. startupTokens<=0 → unknown (never flag as wasted on
// a missing denominator — the S162 never-satisfiable-denominator honesty rule).
export function bootAmortization({ workTokens = 0, startupTokens = 0 } = {}) {
  if (!startupTokens || startupTokens <= 0) {
    return {
      ratio: null,
      verdict: "unknown",
      label: "startup cost unmeasured — cannot assess amortization",
    };
  }
  const ratio = workTokens / startupTokens;
  let band = AMORTIZATION_BANDS[0];
  for (const b of AMORTIZATION_BANDS) if (ratio >= b.min) band = b;
  return {
    ratio: Math.round(ratio * 100) / 100,
    verdict: band.verdict,
    label: band.label,
  };
}

// THE KEYSTONE. Given the live session signals, decide whether a /goal session
// must keep going (CONTINUE) or may stop (STOP). Returns { verdict, reason,
// signals }. The contract both Claude's Stop hook and Codex's /goal loop obey.
//
//   contextPct      0..1 fraction of context used (from context-meter pctUsed/100)
//   itemsShipped    verified items completed this session
//   velocityFloor   minimum items a healthy session ships (floor(recentVelocity))
//   listExhausted   true when genius list + innovation pack are dry AND re-verified
//   budgetTotal     optional output-token floor from a `/goal +Nk` directive (null = none)
//   budgetSpent     output tokens spent so far this session
//
// Stop ONLY when truly saturated. The ordering matters: context exhaustion always
// wins (safety), then an explicit budget floor, then work-saturation.
export function sessionFloorVerdict({
  contextPct = 0,
  itemsShipped = 0,
  velocityFloor = 1,
  listExhausted = false,
  budgetTotal = null,
  budgetSpent = 0,
  // S261 [audit #7] — did we actually OBSERVE the spend, or is budgetSpent just
  // its default? Callers that cannot measure must say so; the verdict is the same
  // (CONTINUE — an unmet floor and an unknown floor both mean keep working) but
  // the REASON must not report an unmeasured 0 as if it were an observation.
  budgetSpentMeasured = true,
} = {}) {
  // S262 — a NULL contextPct means the meter could not read, and JS coerces
  // `null < 0.75` to `0 < 0.75` → true. Left implicit, an unmeasured gauge would
  // therefore behave EXACTLY like "0% used" and keep saying CONTINUE forever —
  // the same defect one layer down. Every comparison below is guarded on this.
  const contextMeasured = contextPct != null && Number.isFinite(contextPct);
  const pctLabel = contextMeasured
    ? `${Math.round(contextPct * 100)}%`
    : "UNMEASURED";
  const hasRoom = contextMeasured ? contextPct < CONSIDER_PCT : false;
  const signals = {
    contextPct: contextMeasured ? contextPct : null,
    contextMeasured,
    itemsShipped,
    velocityFloor,
    listExhausted,
    budgetTotal,
    budgetSpent,
    budgetSpentMeasured,
  };

  // 1. Context exhaustion is a hard stop — never push a terminal past CLOSEOUT.
  //    Cannot fire when unmeasured: we do not know, and guessing either way lies.
  if (contextMeasured && contextPct >= CLOSEOUT_PCT) {
    return {
      verdict: "STOP",
      reason: `context ${pctLabel} — terminal exhausted, close out`,
      signals,
    };
  }

  // 2. An explicit budget floor (/goal +Nk) is a hard FLOOR: cannot stop until met,
  //    regardless of how "done" the objective feels. This is the most direct cure
  //    for early-finishing.
  if (budgetTotal && budgetSpent < budgetTotal) {
    const k = Math.round(budgetTotal / 1000);
    if (!budgetSpentMeasured) {
      // Honest: we know a floor was requested and we cannot see the spend. Say
      // that, rather than printing a fabricated "0% of +Nk".
      return {
        verdict: "CONTINUE",
        reason: `budget floor +${k}k set but spend is UNMEASURED — cannot prove the floor is met, so keep shipping verified work`,
        signals,
      };
    }
    const pctOfBudget = Math.round((budgetSpent / budgetTotal) * 100);
    return {
      verdict: "CONTINUE",
      reason: `budget floor not met (${pctOfBudget}% of +${k}k) — keep shipping verified work`,
      signals,
    };
  }

  // 3. Below the velocity floor → CONTINUE even if the current item feels done.
  //    This is the line that makes Codex behave like Claude: shipping 1 of N when
  //    the budget has room is a wasted boot, not a finished session.
  if (itemsShipped < velocityFloor && hasRoom) {
    return {
      verdict: "CONTINUE",
      reason: `only ${itemsShipped}/${velocityFloor} velocity-floor items shipped with context at ${pctLabel} — select the next-highest item`,
      signals,
    };
  }

  // 4. List not exhausted and context has room → keep climbing (depth ladder /
  //    second-order work). "Empty list must be impossible" (the /go discipline).
  if (!listExhausted && hasRoom) {
    return {
      verdict: "CONTINUE",
      reason: `work remains (list not exhausted) and context at ${pctLabel} — climb the depth ladder or take the next item`,
      signals,
    };
  }

  // 4b. S262 — context UNMEASURED. The overrun guard is dark, so neither a
  //     context-based CONTINUE nor a context-based STOP is honest. Decide on the
  //     signals that ARE readable (items shipped vs floor, list exhaustion) and
  //     say plainly that the gauge is unreadable, so the agent can restore the
  //     measurement or choose deliberately rather than inherit a fabricated 0%.
  if (!contextMeasured) {
    const more = itemsShipped < velocityFloor || !listExhausted;
    return {
      verdict: more ? "CONTINUE" : "STOP",
      reason: `context UNMEASURED (meter could not read) — verdict from items ${itemsShipped}/${velocityFloor} and list ${listExhausted ? "exhausted" : "open"}; the overrun guard is DARK, re-establish the reading before trusting a long run`,
      signals,
    };
  }

  // 5. Saturated: floor met, list dry or context tight. Stopping is honest now.
  const why = listExhausted
    ? "list exhausted + re-verified"
    : `context ${pctLabel} past soft threshold`;
  return {
    verdict: "STOP",
    reason: `saturated (${why}, ${itemsShipped} items shipped) — closeout is honest`,
    signals,
  };
}

// Codex-specific CLOSEOUT REFUSAL gate. Claude's Stop hook enforces this already;
// this is the equivalent for Codex (the exact parity gap the founder named).
// Returns { pass, reason }: pass=false means /closeout must REFUSE to run — the
// session has barely used its boot and shipped below floor, so closing out now
// would lock in a wasted boot. Hard gate, not a suggestion.
export function minSessionValueGate({
  amortizationRatio = null,
  itemsShipped = 0,
  velocityFloor = 1,
  contextPct = 0,
  founderInvoked = false,
  workEvidence = null,
} = {}) {
  // An explicit founder `/closeout` always wins — never trap the human.
  if (founderInvoked)
    return { pass: true, reason: "founder-invoked closeout — always honored" };

  // Plenty of context burned already → the boot is amortized regardless of count.
  if (contextPct >= CONSIDER_PCT)
    return {
      pass: true,
      reason: "context past soft threshold — boot amortized",
    };

  const belowFloor = itemsShipped < velocityFloor;
  // For the closeout-refusal gate, "not yet amortized" means below the HEALTHY
  // band (< 3×), not merely the wasted band: a thin boot that has barely touched
  // context and shipped below floor is still a session worth continuing.
  const notAmortized =
    amortizationRatio != null && amortizationRatio < AMORTIZATION_BANDS[2].min; // < 3
  const barelyStarted = contextPct < 0.5;

  if (
    belowFloor &&
    barelyStarted &&
    (notAmortized || amortizationRatio == null)
  ) {
    // CANON-031 honesty (S183): this gate exists to catch EMPTY sessions (the
    // Codex-finishes-in-4-min case), but the context meter reads near-0% on
    // large-context (1M) windows, so contextPct + amortization go blind and it
    // FALSE-REFUSES sessions that demonstrably did real work — forcing --founder
    // every time. Substantial git work-evidence (commits made / files changed this
    // session) is proof the session is NOT empty, so trust it over the blind meter.
    // A truly empty session has no commits + nothing changed → no evidence → still refused.
    if (workEvidence && workEvidence.substantial) {
      return {
        pass: true,
        reason: `work-evidenced closeout (${workEvidence.commits} commit(s) · ${workEvidence.filesChanged} file(s) this session) — not an empty session; trusting git over the context meter (blind on large-context windows)`,
      };
    }
    return {
      pass: false,
      reason: `refusing closeout: ${itemsShipped}/${velocityFloor} floor items, context ${Math.round(contextPct * 100)}%${amortizationRatio != null ? `, amortization ${amortizationRatio}×` : ""} — return and implement the unshipped audit items before closing`,
    };
  }
  return {
    pass: true,
    reason: `value floor met (${itemsShipped} items · context ${Math.round(contextPct * 100)}%)`,
  };
}

// Parse a `/goal +Nk` / `+Nm` budget directive into an output-token floor.
// "+300k" → 300000 · "+1.5m" → 1500000 · no match → null.
export function parseBudgetDirective(text = "") {
  const m = String(text).match(/\+\s*([\d.]+)\s*([km])\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  return Math.round(n * (m[2].toLowerCase() === "m" ? 1_000_000 : 1_000));
}
