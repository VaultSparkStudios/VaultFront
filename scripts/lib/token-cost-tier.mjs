// token-cost-tier.mjs — S178 (ITEM 11). Token-aware genius-list prioritization.
//
// THE IDEA (founder): a saturating session ships more VALUE before its budget
// runs out if it does the cheap-high-value items first. So tag every genius /
// TASK_BOARD item with an estimated token-cost tier and give the sequencer a
// value-per-token key — cheap hygiene before expensive feature work, ties broken
// by impact. Suggest/sequence-ONLY: this never blocks, drops, or reorders the
// canonical ranking destructively — it adds a `costTier` + `seqKey` and an
// optional cheap-first sort the caller may apply.
//
// Pure — no I/O. Unit-tested as the source of truth; generate-genius-list.mjs and
// session-floor.mjs both import it so the tiering can't drift between surfaces.

// Cost tiers, cheapest → most expensive. `weight` is a rough relative-token
// multiplier used only for sequencing (not a dollar figure — CANON-031: we don't
// pretend to know exact tokens, we estimate a tier).
export const COST_TIERS = {
  "haiku-hygiene": {
    rank: 0,
    weight: 1,
    label: "cheap · haiku-hygiene",
    model: "haiku",
  },
  "sonnet-standard": {
    rank: 1,
    weight: 4,
    label: "standard · sonnet",
    model: "sonnet",
  },
  "opus-feature": {
    rank: 2,
    weight: 12,
    label: "expensive · opus-feature",
    model: "opus",
  },
};
export const DEFAULT_TIER = "sonnet-standard";

// Signals that an item is cheap hygiene (lint/probe/doc/typo/rename/refresh/
// dedupe/format) vs an expensive feature (design/architect/build/migrate/refactor
// a system/implement/new subsystem). Keyword heuristics only — deterministic and
// explainable; never a hidden model call.
const CHEAP_RE =
  /\b(lint|typo|rename|doc|docs|comment|format|prettier|dedupe|de-dupe|refresh|stamp|bump|tidy|cleanup|clean up|sweep|probe|smoke|fixture|sentinel|wording|copy|whitespace|sort|index regen|regenerate index|one-?liner)\b/i;
const EXPENSIVE_RE =
  /\b(architect|design|build|migrate|migration|refactor|re-?write|rewrite|new (system|subsystem|engine|platform|pipeline|protocol)|implement .* (system|engine|platform)|overhaul|redesign|end-to-end|multi-repo|cross-portfolio|orchestrat)\b/i;

/**
 * Estimate the token-cost tier of a single item from its fields.
 * @param {object} item - { title, rationale, cat, effortMin, tier, command }
 * @returns {'haiku-hygiene'|'sonnet-standard'|'opus-feature'}
 */
export function estimateCostTier(item = {}) {
  const text = `${item.title || ""} ${item.rationale || ""} ${item.command || ""}`;
  // Explicit effort estimate wins when present (minutes).
  const eff = Number(item.effortMin);
  if (Number.isFinite(eff) && eff > 0) {
    if (eff <= 15) return "haiku-hygiene";
    if (eff >= 90) return "opus-feature";
  }
  if (EXPENSIVE_RE.test(text)) return "opus-feature";
  if (CHEAP_RE.test(text)) return "haiku-hygiene";
  // Category hints: pure hygiene categories lean cheap; intelligence/launch lean rich.
  const cat = (item.cat || "").toLowerCase();
  if (cat === "debt" || cat === "protocol") {
    // protocol doc tweaks are cheap unless the title says otherwise (handled above)
    return "haiku-hygiene";
  }
  if (cat === "intelligence" || cat === "launch") return "opus-feature";
  return DEFAULT_TIER;
}

/**
 * Value-per-token sequencing key. Higher = do sooner. value = the item's existing
 * impact score (finalScore | score | ignisScore); cost = the tier weight. Cheap
 * high-value items float to the top; expensive items sink unless their value is
 * proportionally higher. Returns a number; ties fall back to raw value.
 */
export function valuePerToken(item = {}) {
  const value =
    Number(item.finalScore ?? item.score ?? item.ignisScore ?? 0) || 0;
  const tierKey = item.costTier || estimateCostTier(item);
  const weight = COST_TIERS[tierKey]?.weight ?? COST_TIERS[DEFAULT_TIER].weight;
  return value / weight;
}

/**
 * Tag a list of items with `costTier` + `seqKey` (non-destructive — returns new
 * objects, preserves every existing field and the input order).
 */
export function tagItems(items = []) {
  return (items || []).map((it) => {
    const costTier = it.costTier || estimateCostTier(it);
    return {
      ...it,
      costTier,
      costTierLabel: COST_TIERS[costTier]?.label,
      seqKey: valuePerToken({ ...it, costTier }),
    };
  });
}

/**
 * Suggest a cheap-high-value-first ordering. Stable: items are tagged then sorted
 * by seqKey desc. Critical-tier items keep priority within their cost tier (we do
 * not let a cheap low-value item jump ahead of a cheap critical). Returns a new
 * array; never mutates the input.
 */
export function sequenceCheapFirst(items = []) {
  const tagged = tagItems(items);
  return tagged
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      // Critical urgency is never deprioritized by cost — but among equal urgency,
      // cheaper-high-value wins.
      const critA = a.it.tier === "critical" ? 1 : 0;
      const critB = b.it.tier === "critical" ? 1 : 0;
      if (critA !== critB) return critB - critA;
      if (b.it.seqKey !== a.it.seqKey) return b.it.seqKey - a.it.seqKey;
      return a.i - b.i; // stable
    })
    .map(({ it }) => it);
}

export default {
  COST_TIERS,
  DEFAULT_TIER,
  estimateCostTier,
  valuePerToken,
  tagItems,
  sequenceCheapFirst,
};
