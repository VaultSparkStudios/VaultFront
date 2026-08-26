# VaultFront production release gate — 2026-08-26

**Verdict: STAGING GO; PRODUCTION NO-GO.** Candidate
`7fbaedcdd83be3a58b4865c5ce863dff8d14d963` is fully verified on stable
staging, but five independent canonical observations remain absent. Production
was not promoted and `https://vaultfront.io/_health` continues to return HTTP 503.

## Exact candidate

- Git SHA: `7fbaedcdd83be3a58b4865c5ce863dff8d14d963`
- Image digest: `sha256:6c261f221b1cfb70c550844b781d5ebf3da9bbc1ecd18935b909b361e7e42470`
- Stable staging deploy: [32943456027](https://github.com/VaultSparkStudios/vaultfront/actions/runs/32943456027)
- Signed 27-cell observation: [32943706016](https://github.com/VaultSparkStudios/vaultfront/actions/runs/32943706016)

## Passing gates

| Gate                        | Result | Evidence                                                                                                                   |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| Exact provider verification | PASS   | CI `32943036547`, End-to-End `32943036503`, and Release `32943036515` passed on the exact SHA.                             |
| Stable staging              | PASS   | Deploy `32943456027` verified the exact revision, product contracts, image digest, signed runtime claims, and attestation. |
| Health observation          | PASS   | Rollback drill `32944435452` restored exact `7fbaedcd` and installed fresh signed health evidence.                         |
| Mobile/staging parity       | PASS   | Observer `32943706016` passed 27/27 cells with zero findings; worst LCP 1,224 ms, INP 152 ms, and CLS 0.0151.              |
| Theme readability           | PASS   | Six source-bound desktop/mobile theme cells and 144 retained artifacts; exact staging observation admitted the receipt.    |
| Footer manifest             | PASS   | Exact-live footer observation is signed and revision-bound.                                                                |
| Rollback                    | PASS   | Promotion rollback dry-run `32944355303` and two-image staging rollback/restoration `32944435452` passed.                  |
| Promotion contract          | PASS   | Production promotion dry-run `32944257053` admitted the immutable candidate without mutating production.                   |

## Blocking gates

| Gate                          | Result    | Evidence                                                                                                                                                                                                            |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoho reply identity           | **BLOCK** | `zoho.mail.admin` is missing `ZOHO_MAIL_CLIENT_ID`, `ZOHO_MAIL_CLIENT_SECRET`, and the two remaining required provider values. No real reply proves `From: contact@vaultfront.io` without an on-behalf-of identity. |
| Authenticated Obelisk journey | **BLOCK** | `obelisk.identity.verify` is missing `OBELISK_RP_ID`, `OBELISK_RP_NAME`, and `OBELISK_RP_ORIGIN`. No authenticated callback/session/identity/logout observation exists.                                             |
| Authenticated human Alpha     | **BLOCK** | Live readiness reports zero accepted human events, sessions, and actors; the Alpha Gate is `not-started` at 0/12 checks.                                                                                            |
| Genuine revenue               | **BLOCK** | `stripe.checkout` is ready and uses a live credential, but a read-only Stripe query found zero positive live payment intents in the latest ten; runtime readiness has no signed positive webhook receipt.           |
| Portable founder approval     | **BLOCK** | Thread authorization permits commit, push, and deployment work, but no non-self-approved purpose-scoped claim binds founder identity to this exact SHA and image digest.                                            |

## Founder-action discipline

CANON-019 checks were completed before assigning blockers:

- `check-secrets --for zoho.mail.admin`: missing four required values.
- `check-secrets --for obelisk.identity.verify`: missing all three relying-party values.
- `check-secrets --for stripe.checkout`: ready; the safe live read found no positive payment.
- `ops.mjs blocker-preflight`: completed; no additional agent-capable path satisfies these five non-substitutable observations.

No human session, payment, reply identity, authenticated identity journey, or
approval claim was synthesized.

## Promotion condition

Configure and prove the Zoho reply-as identity; configure the Obelisk relying
party and retain an authenticated journey; complete the genuine authenticated
human Alpha cohort; ingest one positive live Stripe webhook receipt; and install
a non-self-approved exact-artifact founder claim. Then rerun the live canonical
readiness endpoint and promote only if every gate is `pass`.
