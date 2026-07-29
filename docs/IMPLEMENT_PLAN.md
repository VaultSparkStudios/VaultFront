# Implementation Plan — Session 89

Source of truth: `docs/AUDIT_2026-07-29.json`

## Wave 1 — Founder-facing truth authority

1. **106 · Startup-brief epistemic integrity** — eliminate confident unknowns, placeholders, provenance conflation, and missing pressure state; verify the freshly rendered canonical brief before any other generated surface depends on it.

## Wave 2 — Runtime-certified authorities

2. **105 · Certified funnel chronology** — reject contradictory Pressure → Breach → decisive delivery → victory timelines before either process-local or PostgreSQL persistence.
3. **107 · Worker-routed game identity** — extract one eight-character routing preimage authority shared by rematch and matchmaking, with collision/exhaustion tests.

## Wave 3 — Deployment and offline ownership

4. **108 · Release-bound service-worker cache** — scope cache identity, deletion, pre-cache roots, and immutable asset ownership to the exact deployed worker release; bind the policy into Pages verification.

## Expansion gate

After 4/4 primary items pass focused and full verification, run the canonical innovation pack, admit only second-order candidates proven by the shipped diffs, implement them at the same L3 bar, and require monotonic ledger/work-exhaustion proof.

## Implementation outcome

- Primary audit: **4/4 shipped**.
- Second-order innovation ledger: **45/45 shipped**, including all four Session 89 compounds.
- Complete-all gate: **0 pending unblocked** across the canonical audit and innovation sidecars.
- External registry-type correction remains explicitly external and evidenced; it did not become fabricated local work.

## Direct verification

Run each command directly and preserve its exit code:

```powershell
npx vitest run tests/scripts/BriefBlocks.test.ts tests/server/CertifiedLoopEvidenceStore.test.ts tests/server/WorkerGameId.test.ts tests/client/ServiceWorkerCachePolicy.test.ts tests/scripts/ReleaseSurfaceContracts.test.ts
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

Finish only when every audit and generated innovation item is shipped or honestly deferred with evidence, all applicable direct commands are green, and doctor reports `blockingFailing: 0`.
