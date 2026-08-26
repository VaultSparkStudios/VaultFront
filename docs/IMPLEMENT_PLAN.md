# Session 111 Implementation Plan

Source: `docs/AUDIT_2026-08-25.json`

1. Own CANON-041 as one executable 27-cell matrix (#248): 360/390/414/768
   device widths in portrait and landscape across VaultFront, light, and
   competitive themes, plus desktop in every theme.
2. Make the mobile drawer use dynamic viewport height, safe-area-aware scrolling,
   an explicit 44px close control, settled open-state geometry, synchronized
   ARIA, and released document scroll lock. Enforce 44px desktop-nav targets on
   touch-sized tablet landscape.
3. Capture and visually inspect real rendered pixels. Fail signed evidence on
   missing cells, partial off-canvas animation state, overflow, undersized
   targets, missing reduced-motion behavior, or an incomplete drawer lifecycle.
4. Commit and push the exact S111 implementation candidate directly to `main`,
   then require provider CI, End-to-End, Release, and brief-validation checks to
   pass for that SHA.
5. Deploy the exact revision to stable staging, verify `commit.txt`, run the
   signed 27-cell observer, inspect its screenshots, refresh the hash-bound
   visual receipt, and write `context/MOBILE_PARITY.md` only after the live
   matrix passes.
6. Re-run promotion admission and the release gate. Production may mutate only
   when every mandatory gate is green; missing Zoho reply identity,
   authenticated Obelisk, genuine three-human Alpha, live positive revenue, or
   portable exact-artifact founder approval remain fail-closed (#233–237).
7. Complete the Session 111 write-back, secret scan, doctor/security checks,
   direct-to-`main` commits, exact-SHA provider checks, Ark impact summary, and
   session-lock cleanup.

Core-loop measurement note: this session changes public navigation and release
proof, not Capture → Convoy → Pressure → Breach → decisive delivery behavior.
Gameplay and balance scores therefore remain unchanged pending genuine
authenticated human traces.
