# VaultFront production release gate — 2026-08-13

**Verdict: NO-GO.** Production promotion remains blocked. The deployable
candidate, staging, identity redirect, responsive/theme parity, Core Web
Vitals, cost posture, branding, and rollback mechanism are green; three
independent external observations are still red and cannot be fabricated.

## Gate results

| Gate                                    | Result             | Evidence                                                                                                                                                                            |
| --------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact-revision provider CI              | PASS               | CI `31749815432`, E2E `31749815413`, Release `31749815412` all succeeded for `0a9149c8`.                                                                                            |
| Stable staging                          | PASS               | Deploy `31750089197`; health `ok`, 2/2 workers, exact `/commit.txt`.                                                                                                                |
| Product smoke                           | PASS               | Run-bound staging attestation completed all 8 product checks.                                                                                                                       |
| Obelisk identity                        | PASS (staging)     | `/auth/login` returns 302 to `obeliskgate.com/auth/authorize` with PKCE S256, secure state cookie, and staging callback.                                                            |
| Replay integrity                        | PASS               | Live readiness reports a configured HMAC key; deployment derives a domain-separated key from gateway-managed material.                                                              |
| Theme/readability and responsive parity | PASS               | 9/9 live theme×viewport cells plus canonical 390/768/1440 audit; see `docs/RELEASE_PARITY.md`.                                                                                      |
| Core Web Vitals                         | PASS (staging lab) | Worst LCP 1.072s, INP 112ms, CLS 0.0763.                                                                                                                                            |
| Rollback mechanism                      | PASS               | Observed rollback and restoration run `31750318879`; receipt digest `sha256:93f5b979edbe990b7fb7bed16d385264b9f242ad63506ed4bdfc29338e9562eb`.                                      |
| Free-tier cost                          | PASS               | Cost-neutral posture and both canonical cost gates pass.                                                                                                                            |
| Branding/legal/footer                   | PASS               | VaultSpark branding, proprietary notice, copyright, legal links, and footer manifest are present.                                                                                   |
| Founder authorization                   | PASS               | The founder explicitly authorized direct commit, push, and full deployment in this session.                                                                                         |
| Project-domain Zoho identity            | **BLOCK**          | Public source uses only `contact@vaultfront.io`, but DNS has no MX/SPF/DMARC and `zoho.mail.admin` is missing all four required credentials; no receive/send/reply-as proof exists. |
| Authenticated human Alpha               | **BLOCK**          | Live readiness reports no authenticated human pulse; the gate requires at least three distinct real humans.                                                                         |
| Real revenue                            | **BLOCK**          | Checkout exists, but live readiness reports no observed checkout/supporter revenue event.                                                                                           |
| Production availability                 | **BLOCK**          | `/`, `/_health`, `/commit.txt`, `/auth/login`, `/agents.json`, and `/.well-known/llms.txt` return HTTP 503 because no production promotion was admitted.                            |

## Required next evidence

1. Supply the Zoho Mail Admin capability, create `contact@vaultfront.io`, publish
   the provider-issued MX/SPF/DKIM/DMARC records, and prove receive, send, and
   reply-as the same address.
2. Run the authenticated Alpha cohort until at least three distinct real-human
   evidence sessions satisfy the Alpha gate.
3. Record one genuine checkout or supporter revenue event through the existing
   live observer.

After those observations are attached and fresh, rerun this gate, promote the
already validated immutable staging digest, then measure production parity and
Core Web Vitals before declaring the launch complete.
