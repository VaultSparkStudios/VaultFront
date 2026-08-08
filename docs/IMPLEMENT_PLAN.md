# Implementation Plan — Session 99

Source: `docs/AUDIT_2026-08-08.json` (fifteen new verified items; items 171–185)

## Efficiency order (by priority)

1. `clan-identity-profanity-and-prompt-boundary` (171→174, P28) — close the AI prompt-injection surface before any other clan work touches Dynasty Story.
2. `bound-game-websocket-payload` (P26.5) — bound the highest-frequency unbounded socket first.
3. `constant-time-admin-token-compare` (P19.9) — apply the established in-house timing-safe pattern to the one place it was missed.
4. `namelayer-textcontent-not-innerhtml` (P18.9) — small, isolated, zero-risk hardening.
5. `live-gameplay-e2e-coverage` (P18.7) — establishes the real-match harness the remaining accessibility/haptics items can build proof on top of.
6. `client-crash-telemetry` (P15.1) — shares the bounded-executor/rate-limit pattern with item 2's rate-limit work.
7. `fortune-deck-collection-closure` (P14) — decide retire-vs-build first; scope depends on that decision.
8. `radial-menu-keyboard-accessibility` (P12.8) — benefits from item 5's live-match harness for keyboard-only proof.
9. `public-api-spec-coverage` (P11.6) — documentation-only, no runtime risk.
10. `translate-critical-combat-alerts` (P10.5) — locale-file addition plus three call-site changes.
11. `reduced-motion-explosion-effects` (P10) — reuses an existing pattern from VaultFrontLayer.ts.
12. `mobile-haptic-impact-feedback` (P10) — new capability, ship default-off pending real playtest signal.
13. `critical-module-coverage-lift` (P8.4) — largest single effort; schedule after the smaller wins land.
14. `experiment-router-rate-limits` (P7.6) — mechanical, reuses the existing rate-limit pattern.
15. `extract-control-panel-god-object` (P6) — pure refactor; do last so it doesn't conflict with items 7/8 touching the same file.

## Parallel lanes

- Security: items 171, 172, 173, 174, 184 (Worker.ts-adjacent; sequence to avoid overlapping edits in the same file).
- Accessibility: items 176, 178, 179.
- Observability: items 175, 177, 183.
- Game loop / dual audience: items 180, 181, 182.
- Organization: item 185 (last, touches ControlPanel.ts which item 178/180 also reference).

## Mandatory gates

- Every recommendation names its affected core-loop step where one applies (game medium successBar).
- No provider, launch, retention, balance, or human-preference claim is inferred from local code.
- Every UI-visible change receives real browser proof across VaultFront, light, and competitive themes at desktop and mobile before closeout.
- Audit rows move to `shipped` only after focused behavior verification.
- Security items ship with an adversarial test proving the specific attack path is closed, not just a happy-path test.
- `extract-control-panel-god-object` must not change any rendered behavior — verify via the existing rendered-proof matrix before/after.
