# VaultFront Game Loop

This is a public-safe, code-derived contract for the experience that ships in
this repository. It describes implemented behavior; it does not replace private
creative direction or claim unobserved player outcomes.

## Core loop

1. **Input — Capture.** Secure one Vault while the First Extraction tracker
   remains reachable.
2. **Fantasy — Escort or disrupt.** Deliver, shield, or intercept a Vault
   Convoy. Personal progress advances only from server-certified activity.
3. **Pressure — Coordinate.** Contribute a convoy delivery toward the team
   threshold of three.
4. **Climax — Breach.** Three deliveries open a 90-second Breach Window.
5. **Reward — Decide.** Land one more convoy during the window for the decisive
   result, then receive a certified match dividend.
6. **Progression — Continue deliberately.** Rating, achievements, season
   milestones, daily mastery, Fortune rewards, and the recommended continuation
   are derived from the authoritative match result.

The player-facing source is
`src/client/FirstExtractionQuest.ts`. Balance authority for the three-delivery
threshold and 900-tick window is
`config/vaultfront-balance.v1.json`. Match-result fan-out is owned by
`src/server/MatchProgression.ts`.

## Authority boundaries

- Personal steps never advance from team state alone.
- The tracker may collapse, but it remains reachable until every certified
  stage is complete.
- Remote artificial intelligence may enrich coaching; the useful certified
  baseline is local and deterministic.
- Rewards are result-derived. Browser prose, synthetic events, and agent/test
  traffic do not count as human Alpha evidence.

## Measurement contract

The live Alpha Gate measures fresh authenticated-human evidence for tutorial
advance/completion, feedback, rival exposure/action, each certified core-loop
stage, and an ordered Capture-to-decisive-delivery timeline. As observed on
2026-08-13, staging reported `0/12` checks, zero accepted human events, and
zero unique human actors. The loop is implemented; its engagement and
retention outcomes are not yet empirically validated.

Timing, dropout, and continuation decisions must be tuned from anonymized human
playtest evidence, never from synthetic traffic or an agent-authored narrative.

## Soul evidence boundary

**Soul fidelity: N/A.** The public `context/SOUL.md` intentionally contains no
founder-owned creative pillars. No numeric Soul-fidelity score is valid until
the Studio Owner supplies public-safe criteria and evidence can trace the
shipped loop or human playtests to those criteria.

## Known next evidence

- At least three distinct authenticated humans complete fresh sessions.
- Stage timing and dropout are captured for Capture → Convoy → Pressure →
  Breach → decisive delivery.
- Post-match feedback and continuation behavior are observed with the shipped
  progressive decision hierarchy.
