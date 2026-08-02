# Implementation Plan — Session 90

Source of truth: `docs/AUDIT_2026-08-01.json`

## Wave A — Closeout and truth foundations

1. **111 · Protocol command-surface parity** — restore every canonical local command/adaptor and contract-test protocol references so closeout is executable before relying on it.
2. **116 · Task-board parser convergence** — replace the vacuous zero-row integrity pass with a shared, section-aware parser and explicit exhaustion semantics.
3. **118 · Dead type-stub removal** — remove the proven unused deprecated dependency and verify the graph/lock/supply-chain boundary.
4. **114 · Isolated map-capacity authority** — remove ambient localhost from playlist policy, restore deterministic tests, and attach capacity provenance.

## Wave B — Release and visual provenance

5. **112 · Exact-revision release admission** — add the CI lineage parent and align Zoho/Obelisk project truth with live Canon.
6. **109 · Hash-bound theme evidence** — bind visual proof to Git/source/artifact digests and a canonical latest receipt.

## Wave C — Causal game/runtime systems

7. **117 · Worker route registrar extraction** — create typed headroom for the season/progression routes without raising the composition ceiling.
8. **110 · Causal community mutator election** — actor-bind, deduplicate, persist, reload, and execute the elected next-week mutator.
9. **113 · Team-scoped Vault Pressure** — make competitive-side progression and actor contribution agree with team victory.
10. **115 · Certified match dividend** — persist and expose actor/game progression receipts; replace delayed cumulative snapshots with exact causal deltas and honest lifecycle states.

## Expansion gate

Completed: all 10/10 primary items passed focused and broad verification. Five live-premise innovations (ranks 46–50) were generated and shipped at L3; the monotonic ledger is 50/50 and work exhaustion reports zero pending unblocked items.

## Closeout result

All three waves are complete. Full-suite and visual-review reds were root-fixed: Pressure scope moved into a bounded authority without raising the execution ceiling; theme proof now excludes onboarding, proves palette divergence, ships portable artifacts, and verifies settled mobile drawer state. External release remains an honest NO-GO and is not local implementation work.

## Direct verification

Run focused tests after each item. At the phase gate, run every command directly and preserve its exit code:

```powershell
npx tsc --noEmit
npm run lint
npm run format:check
npm run verify:contracts
npm test
npm run balance:verify
npm run build-prod
npm run verify:pages
npm run bundle:check
npm audit --omit=dev
npm run e2e
node scripts/check-work-exhaustion.mjs --root . --json
node scripts/ops.mjs doctor --update-json
```

Finish only when every primary and generated innovation item is shipped or honestly deferred with evidence, all applicable direct commands are green, and doctor reports `blockingFailing: 0`.
