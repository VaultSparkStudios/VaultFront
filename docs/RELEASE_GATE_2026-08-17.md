# VaultFront production release gate — 2026-08-17

**Verdict: PRODUCTION NO-GO; STAGING GO.** Project-domain inbound and outbound
transport are now independently observed. Human reply identity and four other
canonical observations remain red.

## Gate results

| Gate                          | Result    | Evidence                                                                                                                                                                                                                                                      |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brevo transactional domain    | PASS      | DNS/authentication apply `31971429976`; `contact@vaultfront.io` is active; provider-delivered outbound probe message-ID SHA-256 `f82213b1e24c61ceb757c2c4d725b702bedced82e204cb6bb2ad5df75cb26f79`.                                                           |
| Cloudflare inbound route      | PASS      | Plan `31993805142`; apply `31993840009`; verified founder destination, exact contact rule, three Cloudflare MX records, no foreign MX, and no conflicts.                                                                                                      |
| Inbound delivery              | PASS      | The tagged message matched the exact rule and Cloudflare recorded `action=forward`, `status=delivered`, SPF pass, DKIM pass, and no delivery error. The temporary analytics token used for evidence was revoked immediately.                                  |
| Human reply identity          | **BLOCK** | Zoho External From is not configured and no real reply has proven `From: contact@vaultfront.io` without an on-behalf-of identity. `zoho.mail.admin` is missing all four required credentials, and the signed-in browser session is unavailable to this agent. |
| Authenticated Obelisk journey | **BLOCK** | A complete callback/session/identity/logout observation remains absent.                                                                                                                                                                                       |
| Authenticated human Alpha     | **BLOCK** | At least three distinct authenticated fresh-player sessions remain unobserved.                                                                                                                                                                                |
| Genuine revenue               | **BLOCK** | No positive live Stripe payment receipt exists.                                                                                                                                                                                                               |
| Portable founder approval     | **BLOCK** | Session authorization exists, but no purpose-scoped runtime founder claim is installed.                                                                                                                                                                       |
| Production availability       | **BLOCK** | Production remains intentionally unavailable; no promotion was attempted.                                                                                                                                                                                     |

## Approved project architecture

The founder approved Cloudflare inbound → founder Zoho mailbox plus Zoho
External From → Brevo SMTP for VaultFront. This is a project decision, not a
Studio Canon amendment. Ark question `01K0727C6507498BE8FC927A64` requests the
fleet-level ruling.

## Promotion condition

Configure the Zoho External From entry with Brevo SMTP and observe a real reply
with the correct project-domain identity. Then satisfy the independent Obelisk,
human Alpha, revenue, and portable-founder observations on the exact candidate
before production promotion.
