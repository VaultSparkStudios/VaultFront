# VaultFront release parity — 2026-08-14

## Exact staging candidate

- Origin: \`https://staging.vaultfront.io\`
- Runtime revision: \`715a223ddb9620cd370614b676705a2c39762359\`
- Staging workflow: \`31783247576\`
- Immutable image: \`sha256:7b74f276479500fcecf168e297426b3380b08d27043019fe70e846d01fd585fc\`
- Product smoke receipt: \`sha256:0d28e601612c52191bcf6b09c23d4e0274f591846799694b9ba06218df2d00ff\`
- Staging attestation: \`sha256:4b28de65cacc55988ea5b5439eb44e10c96d70fb71717df183b46936459dd9cd\`
- Health at deployment: \`ok\`, master scope, 2/2 fresh workers

The deployment observed nine product contracts and installed independently
signed, exact-runtime claims. Public readiness admitted \`staging\`,
\`healthObservation\`, and \`obeliskIdentity\` as verified immediately after
deployment. The 15-minute health claim later expired as designed; staging and
Obelisk remained admitted.

## Theme, responsive, and Core Web Vitals status

**FAIL.** The exact-candidate Playwright parity matrix completed all nine cells
for the three themes at 390, 768, and 1440 CSS pixels. Its report was observed
at \`2026-08-14T09:12:58.075Z\` and is bound by digest
\`sha256:c1f36f8aa99643308bf1d54155ff6fd07ed1ccb05205b8bdfcfdfd4d584b372e\`.
Four findings block parity:

- \`vaultfront\` at 390 px: Largest Contentful Paint (LCP) 10,724 ms
- \`vaultfront\` at 768 px: Cumulative Layout Shift (CLS) 0.1012
- \`light\` at 768 px: CLS 0.1012
- \`competitive\` at 768 px: CLS 0.1023

The other eight cells recorded LCP from 596–1,072 ms; Interaction to Next Paint
(INP) remained at or below 184 ms across the matrix. The isolated first-cell
LCP suggests a cold-start hypothesis, while the repeated 768 px result suggests
a breakpoint-specific shift. Neither is waived: both require bounded diagnosis
and a fresh exact-revision passing receipt. The prior green matrix for revision
\`0a9149c8\` remains historical evidence only and is not reused for \`715a223d\`.

CANON-053 source-change validation still passes: the current hash-bound visual
receipt covers 138 captures across three themes and desktop/mobile, and no UI
file changed after that receipt. This does not substitute for exact-live parity
or production Core Web Vitals.

## Rollback observation

Workflow \`31787212414\` admitted the previous and current staging attestations,
used validation workflow \`31787165044\`, switched stable staging from
\`715a223d\` to known-good \`f78385cb\`, observed the target healthy, restored
\`715a223d\`, and observed it healthy again. The drill took 30,140 ms and retained
self-verifying receipt
\`sha256:50cae6b736c7bc48b830801ef3079aae33ce1d3bc0c62b515b40c2a0186327c8\`.
The restored public origin reports exact revision \`715a223d\` and 2/2 healthy
workers.

This evidence is staging-only. It does not authorize production promotion.
