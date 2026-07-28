# Implementation Plan — Session 88

Source of truth: `docs/AUDIT_2026-07-28.json`

## Wave 1 — Truth and delivery

1. **96 · Worker quorum health authority** — require fresh, reasoned worker evidence for master readiness; keep liveness separate.
2. **97 · Release-validated public surface** — make deployment and release gates observe the same public artifact.
3. **98 · Schedule-free repository** — retire hosted cron and its stale operational contract.
4. **99 · Working project-domain contact action** — route the visible contact action through the verified project address.

## Wave 2 — Parser, player, and evidence

5. **100 · Canonical human-action parser** — converge aging and classification on one task parser.
6. **101 · Pressure-to-Breach First Extraction** — make the authoritative victory arc primary and demote auxiliary mastery.
7. **102 · Certified decisive-loop evidence** — measure Pressure, Breach, decisive delivery, and victory from certified results.

## Wave 3 — Surface and ecosystem

8. **103 · Production graph cleanup** — remove the tracked binary and unused production dependencies.
9. **104 · Source-tagged identity reconciliation** — ship Ark cargo reconciling app-versus-game identity without sibling-tree edits.

## Full verification

Run each command directly and preserve its exit code:

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run format:check
npm run verify:contracts
npm run balance:verify
npm run build-prod
npm run bundle:check
npm audit --omit=dev
node scripts/check-work-exhaustion.mjs
npm run e2e
node scripts/ops.mjs doctor --update-json
```

Finish only when every audit item is shipped or honestly deferred with evidence, all commands are green, and doctor reports `blockingFailing: 0`.
