// doctor-remedies.mjs — single source of truth for the doctor's remediation maps
// (extracted from run-doctor.mjs in S167 [audit #1]) plus the probe-honesty
// meta-detector. Turning the observability-honesty arc inward onto the doctor
// itself: a probe is DISHONEST when it routes its remediation as human
// (script: null) while its label names a command an agent could run. That is a
// phantom-blocker at the meta level (CANON-019) — the discipline applied to
// agents, now applied to the surfaces that generate the founder's red signals.

// ── Auto-remediation map (a non-null script is auto-run by `doctor --fix`) ───
export const REMEDIES = {
  validate: {
    script: "validate-compliance.mjs",
    args: [],
    label: "validate-compliance",
  },
  "compliance-velocity": {
    script: "track-compliance-velocity.mjs",
    args: [],
    label: "track-compliance-velocity",
  },
  revenue: {
    script: "render-revenue-signals.mjs",
    args: [],
    label:
      "auto-render revenue signals (S167 #6: agent-runnable self-heal; the probe also passes --auto-refresh)",
  },
  ignis: {
    script: "rescore-ignis.mjs",
    args: ["--stale"],
    label: "rescore-ignis --stale",
  },
  "prompt-ver": {
    script: null,
    args: [],
    label:
      "prompt-version drift — run: bash scripts/propagate-templates.sh --apply",
  },
};

// S151 #5: self-heal only stale, self-fixable derived surfaces. Never wire
// destructive, network-mutating, billing, secret-touching, or cross-repo writes
// into this map.
//
// S171 [audit #2] — HEAL HONESTY. The old comment claimed keys here are
// "AUTO-HEALED → honest by construction." That was itself a small lie: some
// heals only REFRESH a derived REPORT (re-measure) while the condition they
// measure is untouched by studio-ops running the script. `doctor --heal` would
// report such a probe "fixed" while nothing actually changed. Each entry now
// carries `kind`:
//   • 'remediate' — running the script moves the probe toward green (the
//     condition IS staleness of a derived surface, and regenerating it IS the
//     fix). Counts toward the --heal `fixed` tally.
//   • 'refresh'   — the script only recomputes a report/measurement; the
//     underlying condition (a sibling port's depth, cross-repo section drift)
//     is NOT changed by studio-ops. NEVER counted as `fixed`; --heal labels it
//     "refreshed (condition unchanged)" and points at the real remediation.
// Unannotated entries default to 'remediate' (back-compatible).
export const HEAL_MAP = {
  "router-catalog-fresh": {
    script: "build-skill-catalog.mjs",
    args: [],
    label: "rebuild skill router catalog",
    kind: "remediate",
  },
  "compliance-velocity": {
    script: "track-compliance-velocity.mjs",
    args: ["--json"],
    label: "refresh compliance velocity",
    kind: "remediate",
  },
  ignis: {
    script: "rescore-ignis.mjs",
    args: ["--stale"],
    label: "refresh stale IGNIS scores",
    kind: "remediate",
  },
  tests: {
    script: "refresh-test-count.mjs",
    args: [],
    label: "refresh test-count cache",
    kind: "remediate",
  },
  "test-suite-freshness": {
    script: "refresh-test-count.mjs",
    args: [],
    label: "refresh test-count cache",
    kind: "remediate",
  },
  // refresh-only: ark-harbormaster --dry-run recomputes the harbor report but
  // ships nothing and cannot drain a RECEIVING port's inbox (that is the
  // receiving repo's /start). Running it never reduces the measured depth.
  "ark-inbox-depth": {
    script: "ark-harbormaster.mjs",
    args: ["--dry-run"],
    label: "refresh harbor report without shipping alerts",
    kind: "refresh",
    remediation: null,
  },
  "ark-slo": {
    script: "ark-slo-check.mjs",
    args: ["--json"],
    label: "refresh Ark SLO report",
    kind: "remediate",
  },
  // refresh-only: validate-agents-md recomputes the drift report; the actual
  // remediation is cross-repo section propagation (deliberately NOT auto-healed
  // — it is a cross-repo write). studio-ops CAN run it, so the probe stays
  // self-owned (see SELF_REMEDIABLE_NO_AUTOHEAL).
  "agents-md-drift": {
    script: "validate-agents-md.mjs",
    args: [],
    label: "refresh AGENTS.md drift report",
    kind: "refresh",
    remediation: "node scripts/propagate-agents-sections.mjs --apply",
  },
  "analytica-freshness": {
    script: "build-analytica-dashboard.mjs",
    args: [],
    label: "refresh Analytica dashboard",
    kind: "remediate",
  },
  // S274 — refresh-only by design. Re-collecting proves what the fleet is
  // currently emitting; it cannot make a project start emitting. The real
  // remediation is per-project (publish a Feed v1 document), which is a
  // cross-repo write and therefore deliberately not auto-healed.
  "analytica-feed-coverage": {
    script: "collect-analytica-feeds.mjs",
    args: [],
    label: "recollect Analytica feeds",
    kind: "refresh",
    remediation:
      "publish an Analytica Feed v1 document per project (docs/ANALYTICA_FEED_SPEC.md)",
  },
  "maintenance-overdue": {
    script: "run-maintenance.mjs",
    args: ["--apply", "--auto"],
    label: "run safe due maintenance jobs",
    kind: "remediate",
  },
  // S210 — lastSessionSummary had a detector but no writer, so it silently went stale
  // (S208 prose survived the S209 closeout). --fix mirrors the agent-maintained
  // currentFocus into lastSessionSummary when currentFocus names the expected session;
  // a genuine state mutation (kind:'remediate'), not a report refresh.
  "last-session-summary": {
    script: "check-last-session-summary.mjs",
    args: ["--fix"],
    label: "heal lastSessionSummary from currentFocus",
    kind: "remediate",
  },
};

// S171 [audit #2/#3] — probes studio-ops CAN remediate via a real action that is
// deliberately NOT wired into HEAL_MAP (because it is a cross-repo write, which
// must never auto-run). These are still SELF-owned debt: the existence of a
// studio-ops remediation path — not membership in HEAL_MAP — is what makes a
// probe self-fixable. Keyed → the remediation command, for legibility.
export const SELF_REMEDIABLE_NO_AUTOHEAL = {
  "agents-md-drift": "node scripts/propagate-agents-sections.mjs --apply",
  // S172 [audit #1] — a consumer's adopted feed snippet drifted from the canonical
  // copy studio-ops publishes. studio-ops owns the re-propagation (cross-repo
  // write, deliberately not auto-run): re-applying the canonical wiring snippet.
  "consumer-adoption":
    "node scripts/verify-consumer-adoption.mjs --apply-snippets",
  "codex-trusted-project": "node scripts/check-codex-trusted-project.mjs --fix",
};

// S171 [audit #1/#3] — single source of truth for "can studio-ops actually fix
// this probe itself?" Used by BOTH the heal layer and the warning-provenance
// guard so the two cannot diverge (the S153 divergent-policy hazard). A probe is
// self-remediable iff:
//   • it has a 'remediate'-kind HEAL_MAP entry (regenerating the surface IS the
//     fix), OR
//   • it has an agent-runnable REMEDIES entry (doctor --fix path), OR
//   • it is listed in SELF_REMEDIABLE_NO_AUTOHEAL (real but non-auto-healed fix).
// A 'refresh'-kind heal does NOT count — refreshing a report is not fixing the
// condition. This is the corrected premise behind the provenance "you can't
// launder self-fixable debt to sibling" guard.
export function isSelfRemediable(
  id,
  {
    healMap = HEAL_MAP,
    remedies = REMEDIES,
    selfRemediable = SELF_REMEDIABLE_NO_AUTOHEAL,
  } = {},
) {
  if (id in selfRemediable) return true;
  const heal = healMap[id];
  if (heal && (heal.kind ?? "remediate") === "remediate") return true;
  const rem = remedies[id];
  if (rem && isAgentRunnableRemedy(rem.label, rem.script)) return true;
  return false;
}

// ── driftClass taxonomy (S158/S167 era; extracted from run-doctor.mjs in S171) ─
// A doctor probe's driftClass answers "what KIND of drift is this red?" — it is
// the field render-action-queue.mjs prints to the founder. The values:
//   • local-broken     — studio-ops's OWN local state/copy is broken. A genuine
//                        self-health failure. Reserved for owner=self probes.
//   • portfolio-outdated — the wider portfolio is behind (sibling adoption /
//                        propagation lag). studio-ops surfaces it; it is NOT
//                        studio-ops being broken.
//   • expected-external — drift that is expected to live outside studio-ops
//                        (sibling-owned content, founder-accepted chronic state).
//   • derived-stale    — a derived/cached surface needs regeneration.
// blocking:true means a HARD FAIL of this probe blocks closeout (self-clears for
// warn/pass/skip — see run-doctor.mjs).
export const DRIFT_META = {
  manifest: { driftClass: "local-broken", blocking: true },
  validate: { driftClass: "portfolio-outdated", blocking: false },
  canon: { driftClass: "portfolio-outdated", blocking: false },
  "compliance-velocity": { driftClass: "portfolio-outdated", blocking: false },
  sanitize: { driftClass: "portfolio-outdated", blocking: false },
  launch: { driftClass: "expected-external", blocking: false },
  feedback: { driftClass: "derived-stale", blocking: false },
  entropy: { driftClass: "local-broken", blocking: true },
  revenue: { driftClass: "derived-stale", blocking: false },
  ignis: { driftClass: "derived-stale", blocking: false },
  genome: { driftClass: "local-broken", blocking: true },
  "prompt-ver": { driftClass: "local-broken", blocking: true },
  "codex-trusted-project": { driftClass: "local-broken", blocking: false },
  "registry-drift": { driftClass: "portfolio-outdated", blocking: false },
  "launch-truth-drift": { driftClass: "portfolio-outdated", blocking: false },

  "website-products-drift": {
    driftClass: "expected-external",
    blocking: false,
  },
  "studio-os-conformance": {
    driftClass: "portfolio-outdated",
    blocking: false,
  },
  // S171 [audit #1] — self-OWNED but the drift KIND is "portfolio copies are
  // behind", NOT "studio-ops's own files are broken". driftClass is the
  // kind-of-drift axis (what the founder reads), distinct from the provenance
  // owner axis (who fixes it). local-broken would falsely imply studio-ops's
  // local AGENTS.md / propagation state is broken — it is not; the portfolio is
  // simply outdated and studio-ops owns catching it up.
  "agents-md-drift": { driftClass: "portfolio-outdated", blocking: false },
  "propagation-adoption": { driftClass: "portfolio-outdated", blocking: false },
  // S172 [audit #1] — self-OWNED (studio-ops re-applies the canonical snippet via
  // --apply-snippets) but the drift KIND is "a consumer's copy is behind", not
  // "studio-ops's own state is broken". local-broken would falsely red the founder
  // ACTION_QUEUE for studio-ops (its canonical snippets are fine: 4/4 adopted).
  "consumer-adoption": { driftClass: "portfolio-outdated", blocking: false },
  // S179 [audit #2] — cost spend is studio-ops-local (our API calls), so it is
  // local-broken. blocking:false — the spend already happened; this is advisory.
  "cost-anomaly": { driftClass: "local-broken", blocking: false },
  // S179 [audit #1] — coherence-map registry miss. A new map file not registered
  // in COHERENCE_REGISTRY is studio-ops's own structural gap (local-broken).
  // blocking:false — warn only; the fix is a COHERENCE_REGISTRY row addition.
  "unregistered-maps": { driftClass: "local-broken", blocking: false },
  "truth-audit-duplicates": { driftClass: "local-broken", blocking: false },
  "derived-surface-coherence": { driftClass: "local-broken", blocking: false },
  "doctor-probe-metadata": { driftClass: "local-broken", blocking: false },
  // S237 [arc audit #7] — four self-owned advisory probes that lacked an
  // explicit driftClass (relying on the fail-honest local-broken default). All
  // are studio-ops's OWN state, warn-only: unmapped-warnings (a warning not yet
  // owner-classified), no-tracked-gitignored (a gitignored file still tracked),
  // unbounded-fetch (a new raw fetch in our scripts), analytica-freshness (our
  // ANALYTICA_DASHBOARD build is stale — remedy build-analytica-dashboard.mjs).
  "unmapped-warnings": { driftClass: "local-broken", blocking: false },
  "no-tracked-gitignored": { driftClass: "local-broken", blocking: false },
  "unbounded-fetch": { driftClass: "local-broken", blocking: false },
  "analytica-freshness": { driftClass: "local-broken", blocking: false },
  "maintenance-overdue": { driftClass: "local-broken", blocking: false },
  "scheduled-writer-boundary": { driftClass: "local-broken", blocking: true },
  "fleet-schedule-policy": {
    driftClass: "portfolio-outdated",
    blocking: false,
  },
  "cpx-capacity-admission": { driftClass: "local-broken", blocking: true },
  "protocol-skill-parity": { driftClass: "local-broken", blocking: true },
  "maintenance-execution-plane": { driftClass: "local-broken", blocking: true },
  "portfolio-infrastructure-court": {
    driftClass: "portfolio-outdated",
    blocking: false,
  },
  "postgres-recovery-contract": { driftClass: "local-broken", blocking: true },
  // S276 — a test whose named import no longer resolves runs ZERO assertions. Always
  // this repo's own breakage, and never a judgement call (the module either provides
  // the name or it does not), so it blocks.
  "test-import-resolution": { driftClass: "local-broken", blocking: true },
  // S276 — both were non-green with NO explicit metadata, so they fell through to the
  // provenance-derived default and showed up as findings of `doctor-probe-metadata`.
  // `coherence` compares metrics ACROSS surfaces in this repo: a disagreement is always
  // local and always actionable here, so it blocks (matching its derived behaviour).
  coherence: { driftClass: "local-broken", blocking: true },
  // CANON-055 adoption across SIBLING repos — studio-ops surfaces it but does not own
  // the fix, and the checker is explicitly structural-only, so it warns rather than blocks.
  "surface-followthrough": {
    driftClass: "portfolio-outdated",
    blocking: false,
  },
};

// S171 [audit #1] — provenance-derived driftClass. The old run-doctor default
// for any probe ABSENT from DRIFT_META was `{ driftClass:'local-broken',
// blocking:true }` — silently asserting "studio-ops is broken" for every
// unmapped probe. 7 sibling-rollout probes hit that default and printed
// `local-broken` on the founder's ACTION_QUEUE (a CANON-031 lie). The honest
// default DERIVES from the warning-provenance owner instead, so a new
// sibling-owned probe can never silently claim studio-ops is broken:
//   owner=sibling → portfolio-outdated · owner=chronic → expected-external
//   owner=self / unmapped → local-broken (fail-honest: an unclassified probe is
//   assumed YOUR breakage until proven otherwise).
export function deriveDriftClass(owner) {
  if (owner === "sibling") return "portfolio-outdated";
  if (owner === "chronic") return "expected-external";
  return "local-broken"; // self / unmapped → fail-honest
}

// Resolve the {driftClass, blocking} for a probe: an explicit DRIFT_META entry
// always wins; otherwise derive from the provenance owner. `owner` is the
// warning-provenance owner (or undefined → self). The single source of truth
// shared by run-doctor.mjs (assignment) and check-drift-provenance-coherence
// (the guard) so the two cannot diverge (S153 anti-pattern).
export function resolveDriftMeta(id, owner, { driftMeta = DRIFT_META } = {}) {
  const explicit = driftMeta[id];
  if (explicit)
    return {
      driftClass: explicit.driftClass,
      blocking: explicit.blocking,
      source: "explicit",
    };
  return {
    driftClass: deriveDriftClass(owner),
    blocking: owner && owner !== "self" ? false : true,
    source: "derived",
  };
}

// S179 [audit #1] — key-getter exports for COHERENCE_REGISTRY set-membership rows.
// Registering these maps in the coherence engine means a new REMEDIES or DRIFT_META
// entry that creates a set divergence turns the `coherence` doctor probe red at
// the next check — catching the S153/S171/S174 silent-drift class.
export function getHealMapKeys() {
  return Object.keys(HEAL_MAP);
}
export function getRemediesKeys() {
  return Object.keys(REMEDIES);
}
export function getDriftMetaKeys() {
  return Object.keys(DRIFT_META);
}

// CANON-019 taxonomy: does this remediation name a command an agent could run
// itself? Agent-runnable surfaces: node/bash scripts, wrangler, gh, npx, ops.mjs
// sub-commands, --apply/--fix flags. A non-null script is auto-run by definition.
// Word-starting tokens get a leading \b; the --flag tokens start with a dash
// (a non-word char) so a leading \b would never match — they carry only a
// trailing \b. Splitting the two cases is required for correctness.
const AGENT_CMD =
  /(\b(?:ops\.mjs|node\s+scripts\/|node\s+\.\.|bash\s+scripts\/|propagate-templates|npx?\s|wrangler\s|gh\s)|--apply\b|--fix\b)/i;

export function isAgentRunnableRemedy(label = "", script = null) {
  if (script) return true; // a wired script is agent-run by --fix
  return AGENT_CMD.test(String(label));
}

// Find probes whose remediation is routed as human (script: null) but whose
// label names an agent-runnable command — i.e. a red an agent should have
// cleared itself, or that must be EXPLICITLY justified as human-only in the
// exempt list rather than buried behind a "human data required" adjective.
// exempt: array of probe keys (with a documented reason) that are genuinely
// human-only despite naming a command.
export function findDishonestProbes({
  remedies = REMEDIES,
  healMap = HEAL_MAP,
  exempt = [],
} = {}) {
  const exemptKeys = new Set(
    (exempt || []).map((e) => (typeof e === "string" ? e : e.key)),
  );
  const flagged = [];
  for (const [key, r] of Object.entries(remedies)) {
    if (key in healMap) continue; // auto-healed → honest
    if (r.script) continue; // auto-remediation wired → honest
    if (!isAgentRunnableRemedy(r.label, r.script)) continue; // genuinely no agent path
    if (exemptKeys.has(key)) continue; // justified human-only
    flagged.push({
      key,
      label: r.label,
      reason:
        "remediation routed as human (script:null) but names an agent-runnable command — auto-run it, or justify the human-exemption in PROBE_HONESTY_EXEMPT.json",
    });
  }
  return flagged;
}
