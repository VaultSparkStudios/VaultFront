# VaultFront release parity — 2026-08-16

## Exact staging implementation

- Origin: `https://staging.vaultfront.io`
- Runtime revision: `a1c861b0fb872d56859a67c3da7a8aa82f5f60ca`
- Provider CI: `31922598710`; E2E: `31922598682`; Release: `31922598764`
- Staging workflow: `31922760549`
- Immutable image: `sha256:b4aefb23f84e5d4b6bf3245224a1f54bdef4e4ac9ac15bada4c339afe1b224d6`
- Product smoke: nine checks, receipt `sha256:800a9e83640acc4cca812316423617d670a24a06913a2152ffe02bb37c6624cf`
- Staging attestation: `sha256:9b0ce97990bf619bb9bcdba77d3e8b630ed8f660e429ef55c2d90d8f296dc4bf`
- Live health after the final rollback drill: `ok`, master scope, 2/2 fresh workers

The public runtime remains exact at this implementation revision. Later main
commits are evidence/workflow-only and do not change the deployed product
image.

## Exact-live theme, responsive, and Core Web Vitals proof

**PASS.** Observation workflow `31922854694` completed the full nine-cell
matrix: three themes at 390, 768, and 1440 CSS pixels, with zero findings.
Worst observed metrics were LCP 1,424 ms, INP 152 ms, and CLS 0.0066. The
revision-bound parity report digest is
`sha256:4a29244512a4ddfaffbd88f00cc83a8322c2f625a0876b0e59998c73e9b98a4a`.

The same workflow admitted the tracked, clean-checkout CANON-053 proof: 138
hash-bound captures across three themes and desktop/mobile, source digest
`sha256:cb4326c2dc0f58f895a92fac31fce83733965da93a67fe5b6a60294940eb8413`.
It also checked the live footer on all 11 public routes; receipt digest
`sha256:9bb3ed408f4db3541686fe876ad421389889c061de60b446fd8416d25997f195`.

Runtime readiness admits signed, exact-image `staging`, `healthObservation`,
`stagingParity`, `obeliskIdentity`, `themeReadability`, and `footerManifest`
claims.

## Exact-image rollback proof

Workflow `31923970973` passed rollback to `bd0b6466`, exact restoration to
`a1c861b0`, receipt verification, claim signing, and atomic runtime
installation in 31,561 ms. Receipt digest:
`sha256:55662561d907a8b6b9ad7a886c828465fb8b9bfe5db55c3a6656183036571381`.
Public readiness admits the resulting exact-image `rollbackObservation` and
renewed `healthObservation` claims.

This evidence qualifies stable staging only. It does not authorize production
promotion while canonical mail, revenue, founder, and authenticated-human
Alpha gates remain blocked.
