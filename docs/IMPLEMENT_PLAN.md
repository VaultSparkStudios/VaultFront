# Implementation Plan — Session 91

Source of truth: `docs/AUDIT_2026-08-02.json`

## Wave A — Shrink the trusted surface

1. **[shipped] 123 · Dead runtime dependency closure** — re-proved zero consumers, removed three declarations and their lock closure, and passed production/supply-chain scans.

## Wave B — Release topology and evidence truth

2. **[shipped] 120 · Single ingress container authority** — host-level Traefik is sole authority; the image has no tunnel/DNS mutation, starts Supervisor directly, exposes health, and passes executable topology contracts.
3. **[shipped] 124 · Complete launch evidence gates** — rollback and real-revenue observations are canonical, semantic-digest-bound, lineage-linked, and adversarially tested.

## Wave C — Certified post-match experience

4. **[shipped] 121 · Certified player feedback panel** — accessible independent ratings now await typed certified receipts with accepted, duplicate, retry, unavailable, stale-session, durability, and retention states.
5. **[shipped] 122 · Contextual post-match continuation** — one evidence-derived continuation card is dominant, utilities are secondary, the Season Pass arc renders, and WinModal composition pressure is lower.

## External honesty ledger

- **119 · Protocol propagation semantic admission** — local downgrade restored and 21/21 focused tests green; signed Ark cargo `01JV2L8M0KA270B3C3F70EFB49` requests the producer-side semantic gate. Durable source repair is externally owned under CANON-018.
- External staging, Zoho reply identity, native Obelisk, live-web/theme, three-human Alpha, revenue, rollback-drill, and founder observations remain NO-GO rather than inferred.

## Expansion gate

Completed: regenerated the innovation pack from 50/53 to 53/53 after shipping tamper-evident launch observations, a deployment-topology lineage fingerprint, and certified-feedback reachability/receipt transparency. Compound refinements added a standalone continuation card, a canonical 18-artifact post-match theme matrix, and 44px mobile controls with measured overflow protection.

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
