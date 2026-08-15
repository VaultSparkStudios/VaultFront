# Session 105 Implementation Plan

Source: \`docs/AUDIT_2026-08-14.json\`

1. **Preserve release truth** — #224 L1: replace the false no-report wording
   with the complete exact-candidate failure, including receipt digest and all
   four measured findings.
2. **Instrument without weakening the gate** — #224 L2: retain the existing
   LCP/INP/CLS thresholds while adding bounded LCP-element, navigation, and
   layout-shift-source diagnostics to the receipt.
3. **Repair measured causes** — reproduce the first-navigation 390 px delay
   and the theme-independent 768 px shift in a real browser, then change only
   the runtime or layout sources supported by those diagnostics.
4. **Verify rendered behavior** — run focused parity contract tests, local
   browser diagnostics, the required desktop/mobile/three-theme rendered-pixel
   workflow, and the changed-file visual receipt checker.
5. **Prove exact staging** — commit and push the bounded fix, wait for provider
   CI, deploy the immutable candidate to stable staging, and rerun the complete
   nine-cell matrix. A passing exact-revision receipt is required; cold start,
   near-threshold CLS, and rounded values are not waivers.
6. **Attach authorized evidence** — only after the live pass, install the
   parity/theme/footer/rollback/renewed-health claims through purpose-scoped
   signed authorities. No code path may synthesize Alpha, Zoho, revenue, or
   founder evidence.

This item touches the public-entry corridor into the game loop. Its loop
measurement is the exact-live LCP/CLS/INP matrix and the preserved Alpha action
reachability contract; no synthetic player event is emitted.
