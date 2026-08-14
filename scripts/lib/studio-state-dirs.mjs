// studio-state-dirs.mjs — S263.
//
// The four top-level directories that hold this repo's durable, agent-authored
// state. Two independent surfaces had grown their own copy of this list:
//
//   scripts/context-meter.mjs        hot-file byte accounting
//   scripts/lib/context-wipe-guard.mjs  reactive wipe scope
//
// They agreed only by coincidence, and they had NOT agreed: the wipe guard
// omitted `portfolio`, which is why portfolio/SKILL_CATALOG.json was outside
// every wipe check while a scheduled cloud lane overwrote it nightly (S263).
// A divergent-observability-policy pair like that is exactly what
// lint-policy-drift.mjs exists to catch — it flagged the duplication the moment
// the two lists were made identical, so the list lives here now and both read it.
//
// Adding a directory here widens BOTH the wipe guard's scope and the context
// meter's accounting. That coupling is intentional: a directory worth measuring
// is a directory worth protecting.
export const STUDIO_STATE_DIRS = ["context", "docs", "logs", "portfolio"];

export default { STUDIO_STATE_DIRS };
