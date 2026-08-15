# VaultFront release parity — 2026-08-15

## Exact staging candidate

- Origin: `https://staging.vaultfront.io`
- Runtime revision: `10c831f46d878ff7c099f104fecac7cbf9f753be`
- Provider CI: `31914372704`; E2E: `31914372741`; Release: `31914372698`
- Staging workflow: `31914559095`
- Immutable image: `sha256:e0542ed665dbc62127f793b9550e74e7cb27ce92b1a9be759618ac28892013dd`
- Product smoke receipt: `sha256:9c4fe1a097819c76e6a97efb506daa20af99cff32d2452780a5416a38648080f`
- Staging attestation: `sha256:cfa256c518522f4a8cfad52610fe798d0f0c211c1f4c448222848623143170aa`
- Health at deployment: `ok`, master scope, 2/2 fresh workers

The deployment passed nine product contracts and installed independently
signed, exact-runtime `staging`, `healthObservation`, and `obeliskIdentity`
claims. The public readiness route admitted all three immediately after the
deployment.

## Theme, responsive, and Core Web Vitals status

**FAIL — one cold-path finding.** The exact-candidate Playwright parity matrix
completed all nine cells for the three themes at 390, 768, and 1440 CSS
pixels. Its report was observed at `2026-08-15T23:37:58.012Z` and is bound by
digest
`sha256:a311c3da8930c47cbdbebd653d5d042b42896dc05e6070cf13f76f75b631ee22`.

The landing-layout repair is measured green: worst Cumulative Layout Shift
(CLS) fell from 0.1023 to 0.0066. Interaction to Next Paint (INP) remained at
or below 160 ms. Eight cells recorded Largest Contentful Paint (LCP) from
584–1,040 ms.

The first `vaultfront` 390 px navigation still recorded LCP 10,636 ms. Its
navigation trace places 9,831 ms before the first HTML byte; page rendering
then completed in about 805 ms. The master currently defers filesystem read
and Embedded JavaScript (EJS) rendering of the immutable shell until the first
visitor. A local candidate now coalesces and completes that render before
`server.listen`; this remains unverified until provider CI and a fresh
exact-revision staging matrix pass.

CANON-053 source-change validation passes with 138 hash-bound captures across
three themes and desktop/mobile. Receipt digest:
`sha256:4ad5376f8e7cba1f41d282f133f9fd84a3dfb61aeb34bbbcfab4f7a27726763f`.
This local rendered-pixel evidence does not substitute for exact-live parity.

## Rollback observation

Workflow `31787212414` remains valid historical evidence for revision
`715a223d`, with a 30,140 ms observed rollback/restoration and receipt
`sha256:50cae6b736c7bc48b830801ef3079aae33ce1d3bc0c62b515b40c2a0186327c8`.
It does not bind the current `10c831f4` image. A fresh drill is required after
the final candidate passes exact-live parity.

This evidence is staging-only. It does not authorize production promotion.
