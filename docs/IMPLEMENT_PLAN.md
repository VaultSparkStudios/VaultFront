# Implementation Plan — Session 87

Source: `docs/AUDIT_2026-07-27.json`

## Wave A — Certified authority and durable competition

1. `archive-certificate-roster-closure` — cross-bind archived and certified rosters, reject duplicate persistent identities, and fail closed on incomplete winner projection.
2. `fail-closed-tournament-durability` — make certified bracket advancement transactional, rollback memory on persistence failure, and preserve idempotent replay.

## Wave B — Regeneration and delivery truth

3. `regeneration-safe-innovation-ledger` — teach the canonical generator the shared certified-game authority and ratchet regeneration at 37 source-backed candidates.
4. `production-scoped-ci-vulnerability-gate` — gate deployable dependency risk while retaining honest, non-blocking visibility into known development-tool aliases.

## Wave C — Player-facing semantic parity

5. `placement-rating-store-parity` — pass memory match count through the same placement K-factor calculation used by PostgreSQL.
6. `canonical-player-facing-victory-loop` — teach one exact capture-to-convoy-to-Breach victory loop and align First Extraction completion language.

## Verification cadence

- Focused tests after each audit item.
- TypeScript and lint after each wave.
- Regenerate derived innovation evidence after the generator regression is green.
- Run contract verification after production policy or authority changes.
- Full suite, production build, balance envelope, budgets, and E2E during canonical closeout.
