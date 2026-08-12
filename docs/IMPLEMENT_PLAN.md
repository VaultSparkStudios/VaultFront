# Session 101 Implementation Plan

Source: `docs/AUDIT_2026-08-12.json`

1. **Runtime foundation** — #196 same-origin worker API plane and #197 privacy-safe single-flight pulse. These share the Master/Worker boundary and land first.
2. **Deterministic game services** — #198 reproducible playlist entropy, then #199 certified local coach baseline. Both strengthen the core loop without adding paid dependencies.
3. **Player-facing polish** — #200 mobile action floor, with rendered desktop/mobile proof in every theme.
4. **Release proof** — #201 product-contract smoke and hash-bound staging receipt, after the runtime behavior exists.
5. **Saturation** — refresh the Unified Genius List, generate second-order candidates, implement every unblocked candidate, then run the full verification and closeout gates.

Every core-loop change requires direct tests plus a loop-tightness measurement note in `context/DECISIONS.md`.
