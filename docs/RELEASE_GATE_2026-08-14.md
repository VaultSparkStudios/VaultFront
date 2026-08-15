# VaultFront production release gate — 2026-08-14

**Verdict: NO-GO.** The exact software candidate, stable staging, signed runtime
evidence transfer, identity redirect, checkout route, and observed rollback are
green. Production remains blocked by independent mail, human, revenue, and
exact-live parity observations.

## Gate results

| Gate                                  | Result                         | Evidence                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact-revision provider CI            | PASS                           | CI \`31782855756\`, E2E \`31782855605\`, and Release \`31782855608\` succeeded for \`715a223d\`.                                                                                                                             |
| Stable staging                        | PASS                           | Deploy \`31783247576\`; exact \`/commit.txt\`, master health \`ok\`, 2/2 workers, immutable image \`sha256:7b74f276479500fcecf168e297426b3380b08d27043019fe70e846d01fd585fc\`.                                               |
| Product smoke                         | PASS                           | Nine run-bound checks; receipt \`sha256:0d28e601612c52191bcf6b09c23d4e0274f591846799694b9ba06218df2d00ff\`.                                                                                                                  |
| Runtime evidence transfer             | PASS (three authorized claims) | Public readiness admitted exact signed \`staging\`, \`healthObservation\`, and \`obeliskIdentity\` claims from deploy run \`31783247576\`; health expired after its 15-minute freshness window as designed.                  |
| Obelisk identity                      | PASS (staging)                 | Product smoke observed unauthenticated JSON plus PKCE redirect to \`obeliskgate.com\` with Secure/HttpOnly/SameSite=Lax state cookie.                                                                                        |
| Supporter checkout API                | PASS (route)                   | Staging GET returns JSON HTTP 405 rather than SPA HTML; authenticated POST and signed webhook are server-owned. No payment is inferred.                                                                                      |
| Rollback mechanism                    | PASS                           | Validation \`31787165044\`; observed rollback/restoration \`31787212414\`; 30.14 seconds; receipt \`sha256:50cae6b736c7bc48b830801ef3079aae33ce1d3bc0c62b515b40c2a0186327c8\`.                                               |
| Visual source receipt                 | PASS                           | CANON-053 checker accepts 138 source-bound desktop/mobile/theme captures; no later UI source change.                                                                                                                         |
| Exact-live parity and Core Web Vitals | **BLOCK**                      | Nine-cell exact-candidate report \`sha256:c1f36f8aa99643308bf1d54155ff6fd07ed1ccb05205b8bdfcfdfd4d584b372e\` completed with four findings: 390 px LCP 10,724 ms and 768 px CLS 0.1012/0.1012/0.1023 across the three themes. |
| Free-tier cost                        | PASS                           | Fixed $5 supporter offer is optional; free gameplay remains cost-neutral.                                                                                                                                                    |
| Branding/legal/footer                 | PASS                           | Required branding, proprietary notice, copyright, and legal links remain present.                                                                                                                                            |
| Founder authorization                 | PASS                           | Founder explicitly authorized direct commit, push, and full deployment; authorization does not replace independent evidence.                                                                                                 |
| Project-domain Zoho identity          | **BLOCK**                      | \`zoho.mail.admin\` is missing four keys; DNS exposes no MX, SPF, or DMARC records; receive/send/reply-as is unproved.                                                                                                       |
| Authenticated human Alpha             | **BLOCK**                      | Live public pulse reports \`no-signal\`, score 0, zero events, and no qualifying cohort; at least three distinct real humans are required.                                                                                   |
| Real revenue                          | **BLOCK**                      | No positive live Stripe payment receipt exists. Route availability and an environment flag cannot satisfy this gate.                                                                                                         |
| Production availability               | **BLOCK**                      | \`/\`, \`/play\`, \`/contact\`, \`/privacy\`, \`/terms\`, and \`/_health\` all return HTTP 503 because production was not promoted.                                                                                          |

## Required next evidence

1. Provide the Zoho Mail Admin capability, attach \`contact@vaultfront.io\`, publish
   MX/SPF/DKIM/DMARC, and prove receive, send, and reply-as.
2. Run at least three authenticated fresh-player sessions through the certified
   Capture → Convoy → Pressure → Breach → decisive-delivery loop.
3. Complete one genuine live $5 supporter payment and admit its signed webhook
   receipt.
4. Diagnose and fix the first-navigation LCP and breakpoint-specific CLS, then
   re-run the exact-live three-theme parity/Core Web Vitals capture.

Only after every gate is green may the immutable staging digest be promoted.
