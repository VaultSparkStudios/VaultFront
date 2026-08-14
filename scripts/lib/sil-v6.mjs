// sil-v6.mjs — SIL v6.0 dual-axis (Health × Impact). Founder-ratified S195/196.
// Spec + rationale: docs/SIL_V6_DUAL_AXIS_PROPOSAL.md.
//
// WHY: SIL v3 is a process-conformance score that fully saturated (studio-ops
// pinned 999/1000 since S128). A maxed conformance score stops discriminating.
// v6 splits the metric into two co-equal axes shown as a 2-tuple:
//   • HEALTH (1000) — wraps v3's 10 categories + per-staleness DECAY. A hygiene
//     floor, easy to reach, hard to HOLD (decay forces re-verification → the
//     number moves again instead of inheriting 999 forever).
//   • IMPACT (1000) — UNGATED, hard-to-max outcome score (5 categories × 200),
//     per-medium signals. Every signal defaults to 0 + needs-instrumentation
//     until wired — an honest zero on "does anyone use this?" is the point.
//
// This is the P1–P2 scaffold: real Health (with decay) + Impact shape, the
// write-time invariant, and a dual-render CLI. NOT the primary metric yet — it
// dual-renders alongside v3 until the founder flips it (proposal P5). silScore
// (= v3 Health) stays untouched for every existing consumer.

import { V3_CATS } from "./sil-categories.mjs";

export const HEALTH_MAX = 1000;
export const HEALTH_DECAY_PER_WEEK = 3; // proposal open-q default (−3/wk)
export const HEALTH_FLOOR = 60; // a category that started high never decays below this

export const IMPACT_CATS = [
  "reach",
  "retention",
  "conversion",
  "feedbackLoop",
  "launchMomentum",
];
export const IMPACT_MAX_PER_CATEGORY = 200;
export const IMPACT_MAX_TOTAL = 1000;

// What to instrument per medium so a 0 says "wire THIS", not just "unknown".
const APP = {
  reach: "MAU / installs",
  retention: "D1/D7/D30 cohort",
  conversion: "paid conversion / MRR",
  feedbackLoop: "feedback→shipped change in 30d",
  launchMomentum: "deployed→announced ratio + growth slope",
};
export const IMPACT_SIGNALS = {
  app: APP,
  tool: APP,
  game: {
    reach: "DAU/MAU",
    retention: "D1/D7/D30 cohort retention",
    conversion: "D30 retention × monetization",
    feedbackLoop: "playtest feedback→shipped change",
    launchMomentum: "deployed→announced + install slope",
  },
  novel: {
    reach: "reads / chapter",
    retention: "chapter completion rate",
    conversion: "subscribe / finish rate",
    feedbackLoop: "reader feedback incorporation",
    launchMomentum: "release cadence + audience slope",
  },
  prose: {
    reach: "reads / chapter",
    retention: "chapter completion rate",
    conversion: "subscribe / finish rate",
    feedbackLoop: "reader feedback incorporation",
    launchMomentum: "release cadence + audience slope",
  },
  infrastructure: {
    reach: "repos/agents consuming it",
    retention: "sustained consumption (not one-shot)",
    conversion: "founder-hours-saved",
    feedbackLoop: "sibling pain → fix → measured relief",
    launchMomentum: "adoption slope across the portfolio",
  },
  "internal-ops": {
    reach: "repos/agents consuming it",
    retention: "sustained consumption (not one-shot)",
    conversion: "founder-hours-saved",
    feedbackLoop: "sibling pain → fix → measured relief",
    launchMomentum: "adoption slope across the portfolio",
  },
  platform: {
    reach: "DAU / connected accounts",
    retention: "repeat-call rate",
    conversion: "network density",
    feedbackLoop: "consumer request → response rate",
    launchMomentum: "integration slope",
  },
  network: {
    reach: "DAU / connected accounts",
    retention: "repeat-call rate",
    conversion: "network density",
    feedbackLoop: "consumer request → response rate",
    launchMomentum: "integration slope",
  },
  website: {
    reach: "unique visitors",
    retention: "return-visitor rate",
    conversion: "signup / lead rate",
    feedbackLoop: "visitor feedback → change",
    launchMomentum: "announced + traffic slope",
  },
  dashboard: {
    reach: "active viewers",
    retention: "return rate",
    conversion: "decisions-driven / actions-taken",
    feedbackLoop: "viewer ask → panel shipped",
    launchMomentum: "adoption slope",
  },
};

function daysBetween(asOf, now) {
  try {
    return Math.max(0, Math.floor((now - new Date(asOf)) / 86400000));
  } catch {
    return 0;
  }
}

// ── HEALTH: v3 categories + per-staleness decay ──────────────────────────────
// A category that started above the floor decays −3/week of staleness toward the
// floor; one already at/below the floor is left alone (you can't game decay by
// starting low). Staleness measured from status.lastUpdated (or silHealthAsOf).
export function computeHealth(status, { now = new Date() } = {}) {
  const cats = status?.silCategoriesV3 || {};
  const asOf = status?.silHealthAsOf || status?.lastUpdated || null;
  const weeksStale = Math.floor(daysBetween(asOf, now) / 7);
  const decay = weeksStale * HEALTH_DECAY_PER_WEEK;
  const categories = {};
  let rawSum = 0;
  for (const k of V3_CATS) {
    const v = Math.min(100, Math.max(0, Number(cats[k]) || 0));
    rawSum += v;
    categories[k] = v <= HEALTH_FLOOR ? v : Math.max(HEALTH_FLOOR, v - decay);
  }
  const health = Math.round(
    Object.values(categories).reduce((s, v) => s + v, 0),
  );
  return {
    health,
    max: HEALTH_MAX,
    categories,
    weeksStale,
    decayApplied: rawSum - health,
    asOf,
  };
}

// ── IMPACT: ungated outcome score, per-medium, honest-zero by default ────────
export function computeImpact(status, medium = "infrastructure") {
  const provided = status?.silImpactCategories || {};
  // S246 (P4 start): the write invariant zero-fills missing categories, so a
  // bare 0 no longer distinguishes "measured zero" from "never wired". When
  // silImpactProvenance exists, it is the honesty source: a category with no
  // provenance entry is still uninstrumented even if a 0 was stamped for it.
  const prov = status?.silImpactProvenance || null;
  const signals = IMPACT_SIGNALS[medium] || IMPACT_SIGNALS.infrastructure;
  const categories = {};
  const needsInstrumentation = [];
  for (const k of IMPACT_CATS) {
    const v = Number(provided[k]);
    const instrumented = Number.isFinite(v) && (!prov || Boolean(prov[k]));
    if (instrumented) {
      categories[k] = Math.min(IMPACT_MAX_PER_CATEGORY, Math.max(0, v));
    } else {
      categories[k] = Number.isFinite(v)
        ? Math.min(IMPACT_MAX_PER_CATEGORY, Math.max(0, v))
        : 0;
      needsInstrumentation.push({ category: k, signal: signals[k] });
    }
  }
  const impact = Object.values(categories).reduce((s, v) => s + v, 0);
  return {
    impact,
    max: IMPACT_MAX_TOTAL,
    categories,
    medium,
    needsInstrumentation,
    provenance: prov,
  };
}

// ── The 2-tuple ──────────────────────────────────────────────────────────────
export function computeSilV6(
  status,
  { medium = "infrastructure", now = new Date() } = {},
) {
  const health = computeHealth(status, { now });
  const impact = computeImpact(status, medium);
  return {
    version: "6.0",
    health: health.health,
    healthMax: HEALTH_MAX,
    impact: impact.impact,
    impactMax: IMPACT_MAX_TOTAL,
    tuple: `Health ${health.health}/${HEALTH_MAX} · Impact ${impact.impact}/${IMPACT_MAX_TOTAL}`,
    healthDetail: health,
    impactDetail: impact,
  };
}

// ── Write-time invariant (NON-BREAKING) ──────────────────────────────────────
// Fires ONLY when silImpactCategories is present, so every existing v3-only
// status is untouched. Mirrors CANON-031 for the Impact axis: each category
// 0..200, silImpact := sum, silImpactMax := 1000. Also stamps a derived silHealth
// so consumers can read the 2-tuple without recomputation. Wired into
// write-project-status.mjs so there is ONE write path (no policy drift).
export function enforceSilV6Invariant(status, { now = new Date() } = {}) {
  const violations = [];
  const out = { ...status };
  const cats = out.silImpactCategories;
  if (cats && typeof cats === "object") {
    const fixed = {};
    for (const k of IMPACT_CATS) {
      let v = cats[k];
      if (typeof v !== "number" || Number.isNaN(v)) {
        violations.push({
          field: `silImpactCategories.${k}`,
          value: v,
          fix: "set 0 (was missing/non-numeric)",
        });
        v = 0;
      } else if (v < 0 || v > IMPACT_MAX_PER_CATEGORY) {
        const c = Math.min(IMPACT_MAX_PER_CATEGORY, Math.max(0, v));
        violations.push({
          field: `silImpactCategories.${k}`,
          value: v,
          fix: `clamped to ${c}`,
        });
        v = c;
      }
      fixed[k] = v;
    }
    for (const [k, v] of Object.entries(cats)) if (!(k in fixed)) fixed[k] = v;
    out.silImpactCategories = fixed;
    const sum = IMPACT_CATS.reduce((s, k) => s + fixed[k], 0);
    if (out.silImpact !== sum) {
      violations.push({
        field: "silImpact",
        value: out.silImpact,
        fix: `recomputed to ${sum} (= sum of impact categories)`,
      });
      out.silImpact = sum;
    }
    if (out.silImpactMax !== IMPACT_MAX_TOTAL) {
      violations.push({
        field: "silImpactMax",
        value: out.silImpactMax,
        fix: `set ${IMPACT_MAX_TOTAL}`,
      });
      out.silImpactMax = IMPACT_MAX_TOTAL;
    }
    // Derived Health stamp (read-only convenience; silScore stays the v3 source).
    out.silHealth = computeHealth(out, { now }).health;
    out.silHealthMax = HEALTH_MAX;
  }
  return { status: out, violations };
}

// ── CLI: dual-render the 2-tuple for a project ───────────────────────────────
//   node scripts/lib/sil-v6.mjs [--repo-root .] [--medium infrastructure] [--json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const arg = (n, d = null) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : d;
  };
  const repoRoot = path.resolve(arg("--repo-root", "."));
  const medium = arg("--medium", "infrastructure");
  const json = args.includes("--json");
  const p = path.join(repoRoot, "context", "PROJECT_STATUS.json");
  if (!fs.existsSync(p)) {
    console.error(`⛔ no PROJECT_STATUS.json at ${p}`);
    process.exit(2);
  }
  const status = JSON.parse(fs.readFileSync(p, "utf8"));
  const v6 = computeSilV6(status, { medium });
  if (json) {
    console.log(JSON.stringify(v6, null, 2));
    process.exit(0);
  }
  console.log(
    `\n  SIL v6 (dual-axis) — ${status.slug ?? path.basename(repoRoot)} · medium=${medium}`,
  );
  console.log(`  ┌──────────────────────────────────────────────────────────┐`);
  console.log(
    `  │  HEALTH  ${String(v6.health).padStart(4)} / 1000   (process · hygiene · decaying)   │`,
  );
  console.log(
    `  │  IMPACT  ${String(v6.impact).padStart(4)} / 1000   (outcome · adoption · revenue)   │`,
  );
  console.log(`  └──────────────────────────────────────────────────────────┘`);
  if (v6.healthDetail.decayApplied > 0)
    console.log(
      `  ⏳ Health decayed −${v6.healthDetail.decayApplied} (${v6.healthDetail.weeksStale}wk stale)`,
    );
  if (v6.impactDetail.needsInstrumentation.length) {
    console.log(
      `  ⚠ Impact uninstrumented — wire these signals to move off 0:`,
    );
    for (const n of v6.impactDetail.needsInstrumentation)
      console.log(`     • ${n.category.padEnd(15)} ${n.signal}`);
  }
  console.log("");
  process.exit(0);
}

export default {
  computeHealth,
  computeImpact,
  computeSilV6,
  enforceSilV6Invariant,
  IMPACT_CATS,
  IMPACT_SIGNALS,
};
