# VaultFront release parity — 2026-08-16

## Exact staging implementation

- Origin: `https://staging.vaultfront.io`
- Runtime revision: `6398ff2abce57deced8ddd78e0b4e784514518a9`
- Provider CI: `31932241126`; E2E: `31932241144`; Release: `31932241143`
- Staging workflow: `31932526593`
- Immutable image: `sha256:6c0cd340a8f9ee464b09a1326826c55b0b7d8c897e610a89898a3891985fa937`
- Product smoke: receipt `sha256:fa863aea6429c5ac945d82a26690b94ac67ddd183f1d39d15ada0171576dcc16`
- Staging attestation: `sha256:562f3a4c10f98a218362cd1825de582db0986c3cc634a89e4485cede08e6a4f0`
- Live health after the final rollback drill: `ok`, master scope, 2/2 fresh workers

The public staging runtime remains exact at this implementation revision. Later
`main` commits are evidence/closeout-only and do not change the deployed product
image.

## Exact-live theme, responsive, and Core Web Vitals proof

**PASS.** Observation workflow `31932651393` completed the full nine-cell
matrix: VaultFront, Light, and Competitive themes at 390, 768, and 1440 CSS
pixels, with zero findings. Worst observed metrics were Largest Contentful Paint
(LCP) 1,208 ms, Interaction to Next Paint (INP) 160 ms, and Cumulative Layout
Shift (CLS) 0.0067. The revision-bound parity report digest is
`sha256:b16329285b8bdfff59fecc2a1f44076ae0c3c55551ffc08cd912d1b4844507da`.

The same workflow admitted the tracked CANON-053 proof: 138 hash-bound captures
across three themes and desktop/mobile, source digest
`sha256:62810b38c7403b097e4f9a25845fd9e29d0689e84bbb8b6363f469083cd31b2f`.
It also checked the live footer on all 11 public routes; receipt digest
`sha256:81fa48f5914f58d96fe3ebecbafbd1230035ae01df703f31c5d29f45fe8daf7c`.

Runtime readiness admits signed exact-image `staging`, `healthObservation`,
`stagingParity`, `themeReadability`, and `footerManifest` claims. It deliberately
does not treat the unauthenticated Obelisk redirect/401 corridor as verified
identity.

## Exact-image rollback proof

Workflow `31932798320` passed rollback to `ecd3b57fac71e84b52b55d83c62bae58b7c38f5d`,
exact restoration to `6398ff2abce57deced8ddd78e0b4e784514518a9`, receipt
verification, claim signing, and atomic runtime installation in 28,634 ms.
Rollback receipt evidence digest:
`sha256:30c9f542bf088927fe9972f213f26f2f568d7bbe04fbbcd44d2997b8e3cd7f1b`.
The resulting signed `rollbackObservation` gate-claim digest is
`sha256:b0db86daa646b1b8c2114002d9219a15b25dcc7eb2ceb9017424b41921502d79`.

Public readiness admits the exact-image `rollbackObservation` and renewed
`healthObservation` claims.

## Production boundary

This evidence qualifies stable staging only. Production remains HTTP 503 and
canonical admission is blocked on project-domain Zoho reply identity, a complete
authenticated Obelisk relying-party journey, genuine authenticated human Alpha
evidence, one positive live revenue receipt, and portable purpose-scoped founder
approval bound to the exact artifact.
