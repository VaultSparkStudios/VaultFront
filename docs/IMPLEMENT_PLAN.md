# Session 106 Implementation Plan

Source: `docs/AUDIT_2026-08-16.json`

1. Close the certified-reward security boundary (#225): require an archived
   result certificate, authenticated participant, and winning identity; await
   PostgreSQL idempotency and retain a certificate-bound receipt.
2. Make production promotion fail closed (#226–227, #231–232): admit a fresh
   all-green readiness snapshot bound to the exact staging attestation, stop
   minting Obelisk identity from corridor smoke, align health evidence to the
   release window, and reject unsigned static observations as authority.
3. Reduce artificial-intelligence cost without weakening authorization (#228):
   authorize each participant first, then use one requester-neutral certified
   recap identity and waiter-aware singleflight.
4. Repair player-facing contract truth (#229–230): share the whole-match
   Prediction League rule with the server resolver, state the delivery tie
   break, and add Fortune to bidirectional liveness proof.
5. Verify locally: focused tests, contracts, typecheck/build, format/lint,
   security scans, and rendered desktop/mobile/three-theme prediction proof.
6. Commit and push directly to `main`, wait for exact-SHA provider checks,
   migrate if required, deploy the immutable candidate to stable staging, and
   verify live revision, health, routes, and readiness.
7. Run the app release gate. Production promotion is permitted only if the
   external items #233–237 are genuine and canonical readiness is all green;
   otherwise retain a precise no-go receipt and never synthesize observations.

Core-loop measurement: certified win → durable Fortune reward; certified match
→ one shared recap → continuation; spectator prediction → trustworthy result;
and exact staging → release admission. Human Alpha remains a real cohort, not
an automated substitute.
