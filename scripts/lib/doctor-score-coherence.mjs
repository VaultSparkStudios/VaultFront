// doctor-score-coherence.mjs — guard the cached doctorScore the startup brief
// surfaces against cross-session staleness (S173 [audit #2]).
//
// Background: the SIGNALS box in the startup brief reads `status.doctorScore`
// from PROJECT_STATUS.json. Historically the brief's doctor preflight ran
// `doctor --fix` WITHOUT `--update-json`, so the displayed score was whatever
// the PRIOR session's closeout persisted. When a probe self-healed between
// sessions (propagation-adoption fail→warn) the brief kept surfacing a phantom
// ⛔ "N failing" the live doctor no longer agreed with — a CANON-031 lie on the
// studio's most-read surface.
//
// This lib is deliberately a pure, testable pair of predicates rather than a
// live doctor probe: a probe reading the very score the doctor writes is one
// run behind by construction (the score is persisted AFTER runChecks()), which
// would reintroduce the self-referential staleness-phantom class S167–S170
// worked to eliminate. The guard therefore lives in a deterministic tier test
// that asserts (a) the renderer's preflight still refreshes the score, and
// (b) the behavioral invariant that a render leaves the score same-day fresh.

// S266 ([SIL:1][S259 #2]) — midnight-stable freshness. Day-identity comparison
// fabricated a stale-red at every UTC rollover (00:00 UTC = 8pm founder-local):
// a score persisted 23:59 read "stale by 1d" one minute later. Freshness is a
// bounded AGE, not a calendar identity — prefer the full-resolution `ranAt`
// (persisted since S174) and compare hours; day-identity survives only as the
// legacy fallback for scores predating `ranAt`.
export const SCORE_FRESH_MAX_AGE_HOURS = 24;

/**
 * Is the cached doctorScore fresh (bounded age ≤ 24h)?
 * @param {object} status  parsed PROJECT_STATUS.json
 * @param {string} today   YYYY-MM-DD (legacy fallback comparison)
 * @param {number} [nowMs] clock override for tests (defaults to Date.now())
 * @returns {{ ok: boolean, date: string|null, ageDays: number|null, ageHours: number|null, reason: string }}
 */
export function scoreFreshness(status, today, nowMs = Date.now()) {
  const ds = status?.doctorScore;
  if (!ds || !ds.date) {
    return {
      ok: false,
      date: null,
      ageDays: null,
      ageHours: null,
      reason: "no doctorScore persisted",
    };
  }
  const ranAtMs = ds.ranAt ? new Date(ds.ranAt).getTime() : NaN;
  if (Number.isFinite(ranAtMs)) {
    const ageHours = (nowMs - ranAtMs) / 3600_000;
    const ok = ageHours <= SCORE_FRESH_MAX_AGE_HOURS;
    return {
      ok,
      date: ds.date,
      ageDays: Math.floor(Math.max(0, ageHours) / 24),
      ageHours: Math.round(ageHours * 10) / 10,
      reason: ok
        ? `fresh (${Math.round(ageHours)}h old, bounded ≤${SCORE_FRESH_MAX_AGE_HOURS}h)`
        : `stale by ${Math.round(ageHours)}h (ran ${ds.ranAt})`,
    };
  }
  const ageDays = daysBetween(ds.date, today);
  return {
    ok: ageDays <= 0,
    date: ds.date,
    ageDays,
    ageHours: null,
    reason:
      ageDays <= 0
        ? "fresh (same-day, legacy day-granular score)"
        : `stale by ${ageDays}d (persisted ${ds.date}, today ${today})`,
  };
}

/**
 * Is the persisted `doctorScore` the SHAPE every surface renders — the
 * `{ passing, total, … }` object `run-doctor.mjs --update-json` writes?
 *
 * S276: the live field was the bare number `124`. Every reader guarded only against
 * ABSENCE (`!doctorScore`), and a number is truthy, so the brief took the object path
 * and printed `Doctor undefined/undefined (undefined%)` on the studio's most-read
 * surface. A malformed value is UNMEASURED, and CANON-031 says unmeasured must say so
 * — never as a stale value, and never as a token that merely looks like a reading.
 * `render-closeout-board.mjs` had already grown its own inline both-shapes guard, which
 * is the tell that this belonged in one shared place.
 *
 * @param {*} value  raw `status.doctorScore`
 * @returns {{ ok: boolean, score: object|null, reason: string }}
 */
export function readableDoctorScore(value) {
  if (value == null) {
    return { ok: false, score: null, reason: "no doctorScore persisted" };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      score: null,
      reason: `doctorScore is a bare ${Array.isArray(value) ? "array" : typeof value} (${JSON.stringify(value)}), not the {passing,total,…} object the doctor writes`,
    };
  }
  const missing = ["passing", "total"].filter(
    (k) => !Number.isFinite(value[k]),
  );
  if (missing.length) {
    return {
      ok: false,
      score: null,
      reason: `doctorScore is missing numeric ${missing.join(" + ")}`,
    };
  }
  return { ok: true, score: value, reason: "well-formed" };
}

/**
 * Does the startup-brief renderer's doctor preflight persist the freshly-computed
 * score? Guards the exact mechanism of S173 [audit #1] against a flag-drop
 * regression. Mechanism-agnostic on HOW (looks for an `ops.mjs doctor` preflight
 * spawn that carries `--update-json`), so a future refactor that keeps refreshing
 * the score by another means must also keep this true.
 * @param {string} rendererSrc  source text of render-startup-brief.mjs
 * @returns {boolean}
 */
export function preflightRefreshesScore(rendererSrc) {
  if (typeof rendererSrc !== "string") return false;
  // Find a spawn argv array that invokes the doctor and carries --update-json.
  // Tolerant of arg order / whitespace; rejects a bare `doctor --fix` preflight.
  const spawnMatch = rendererSrc.match(/\[[^\]]*['"]doctor['"][^\]]*\]/g);
  if (!spawnMatch) return false;
  return spawnMatch.some((argv) => /--update-json/.test(argv));
}

/**
 * Coherence between the persisted failing count and a freshly-computed one.
 * @param {object} status        parsed PROJECT_STATUS.json
 * @param {number} liveFailing   failing count from a current runChecks()
 * @returns {{ ok: boolean, cached: number|null, live: number, reason: string }}
 */
export function failingCoherent(status, liveFailing) {
  const cached = status?.doctorScore?.failing ?? null;
  const ok = cached === liveFailing;
  return {
    ok,
    cached,
    live: liveFailing,
    reason: ok
      ? "cached failing matches live"
      : `cached ${cached} ≠ live ${liveFailing} failing`,
  };
}

function daysBetween(a, b) {
  try {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  } catch {
    return null;
  }
}
