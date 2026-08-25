# Session 110 Implementation Plan

Source: `docs/AUDIT_2026-08-25.json`

1. Restore the startup brief's required source-closure manifest and add a
   producer-consumer regression (#245). Verify a real S110 render passes the
   live source-freshness checker immediately.
2. Keep gitignored ephemeral checkout mirrors outside direct Vitest and
   Prettier discovery (#247), then prove both canonical verification surfaces
   remain bounded to the live repository.
3. Commit and push the exact S110 implementation candidate directly to `main`,
   then require its provider CI, End-to-End, Release, and brief-validation
   checks to pass.
4. Complete the immutable release chain for that final SHA (#246): deploy it to
   stable staging, verify exact `commit.txt` and product contracts, observe all
   nine theme/viewport cells, validate promotion, and retain a two-image
   rollback/restoration receipt against the S109 anchor.
5. Run the full verification and release-gate surface. Production may mutate
   only when canonical admission is all green; missing Zoho reply identity,
   authenticated Obelisk, genuine three-human Alpha, live positive revenue, or
   exact-artifact founder approval remain fail-closed (#233–237).
6. Complete the Session 110 write-back, secret scan, doctor/security checks,
   direct-to-`main` commits, exact-SHA provider checks, final staging proof, Ark
   impact summary, and session-lock cleanup.

Core-loop measurement note: this session changes release trust and availability,
not Capture → Convoy → Pressure → Breach → decisive delivery behavior. Gameplay,
reward, and balance changes remain inadmissible until genuine authenticated human
evidence identifies a concrete loop defect.
