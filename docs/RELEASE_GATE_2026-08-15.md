# VaultFront production release gate — 2026-08-15

**Verdict: NO-GO.** Stable staging is healthy and exact, the 768 px layout
shift is repaired, and the signed staging/health/identity evidence corridor is
working. Production remains blocked by one measured cold-path LCP failure,
missing current-image rollback/parity/theme/footer/founder claims, and
independent mail, human, and revenue observations.

## Gate results

| Gate                                 | Result              | Evidence                                                                                                                                                     |
| ------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact-revision provider CI           | PASS                | CI `31914372704`, E2E `31914372741`, and Release `31914372698` succeeded for `10c831f4`.                                                                     |
| Stable staging                       | PASS                | Deploy `31914559095`; exact `/commit.txt`, master health `ok`, 2/2 workers, image `sha256:e0542ed665dbc62127f793b9550e74e7cb27ce92b1a9be759618ac28892013dd`. |
| Product smoke                        | PASS                | Nine run-bound checks; receipt `sha256:9c4fe1a097819c76e6a97efb506daa20af99cff32d2452780a5416a38648080f`.                                                    |
| Runtime evidence transfer            | PASS (three claims) | Public readiness admits exact signed `staging`, `healthObservation`, and `obeliskIdentity` claims from run `31914559095`.                                    |
| Supporter checkout API               | PASS (route)        | Staging GET returns JSON HTTP 405 rather than Single-Page Application HTML. No payment is inferred.                                                          |
| Visual source receipt                | PASS                | CANON-053 accepts 138 source-bound captures; receipt `sha256:4ad5376f8e7cba1f41d282f133f9fd84a3dfb61aeb34bbbcfab4f7a27726763f`.                              |
| Exact-live layout stability          | PASS                | Worst CLS is 0.0066 across the nine exact-live cells, down from 0.1023.                                                                                      |
| Exact-live LCP                       | **BLOCK**           | Report `sha256:a311c3da8930c47cbdbebd653d5d042b42896dc05e6070cf13f76f75b631ee22`: first 390 px LCP 10,636 ms; 9,831 ms elapsed before the first HTML byte.   |
| Current-image rollback               | **BLOCK**           | The observed drill binds historical image `715a223d`, not current image `10c831f4`.                                                                          |
| Canonical parity/theme/footer claims | **BLOCK**           | The runtime claim pipeline does not yet install these purpose-scoped observations.                                                                           |
| Founder authorization                | PARTIAL             | Direct commit/push/deploy authorization is captured in-session; no portable purpose-scoped runtime founder claim is installed.                               |
| Project-domain Zoho identity         | **BLOCK**           | `zoho.mail.admin` lacks four keys; MX/SPF/DKIM/DMARC and receive/send/reply-as remain unproved.                                                              |
| Authenticated human Alpha            | **BLOCK**           | Live pulse remains `no-signal`, with zero events, sessions, actors, and 0/12 checks.                                                                         |
| Real revenue                         | **BLOCK**           | No positive live Stripe payment receipt exists. Route availability cannot satisfy the gate.                                                                  |
| Production availability              | **BLOCK**           | Production remains intentionally unavailable and returns HTTP 503.                                                                                           |

## Required next evidence

1. Provider-qualify and deploy the startup-render candidate, then require a
   fresh passing nine-cell exact-staging report.
2. Attach only purpose-scoped signed parity, theme, footer, rollback, renewed
   health, and founder observations; generic or unsigned evidence is invalid.
3. Provision Zoho and prove receive/send/reply-as on the project domain.
4. Complete at least three authenticated fresh-player certified loops.
5. Complete one genuine positive live Stripe payment.
6. Run a current-image rollback drill and production relying-party checks
   before any promotion.

Only after every gate is green may the immutable staging digest be promoted.
