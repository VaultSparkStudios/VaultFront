# Implementation Plan — Session 86

Source: `docs/AUDIT_2026-07-26.json`

## Wave A — Deterministic foundations

1. `certified-rivalry-revenge-projection` — extend deterministic simulation stats and signed result evidence; remove browser authority.
2. `transaction-decoupled-leaderboard-projection` — remove table-wide work from the certified progression transaction and make ranked reads deterministic.

## Wave B — Shared certified context

3. Extract a reusable archived-game/certificate/participant resolver from the existing AI-only helper. This is shared implementation infrastructure for the two remaining audit items, not a separate audit claim.

## Wave C — Certificate-bound mutations

4. `certificate-bound-dynasty-chronicle` — accept only `gameId`, derive clan and narrative inputs from certified evidence, deduplicate durable chapters, emit AI provenance.
5. `certified-tournament-result-spine` — accept only `gameId`, derive participants and winner from certified evidence, bind the bracket atomically, and extract the router.

## Verification cadence

- Focused unit tests after each item.
- `npm run verify:contracts` after each composition or policy change.
- TypeScript and lint after each wave.
- Full suite, production build, budgets, and E2E during canonical closeout.
