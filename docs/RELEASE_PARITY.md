# VaultFront release parity — 2026-08-13

## Observed candidate

- Origin: `https://staging.vaultfront.io`
- Runtime revision: `0a9149c8bc0e466b27954f7b789e4c83e93ffb1c`
- Staging workflow: `31750089197`
- Health: `ok`, master scope, 2/2 fresh workers
- Live observation time: 2026-08-13 22:31 UTC
- Release-parity digest: `sha256:bd24e68dfe0197240715c4604e281eb46d2f6ecad08871045b24b1117b878059`

The automated live matrix exercised VaultFront, Light, and Competitive themes
at 390, 768, and 1440 CSS pixels. All 9 cells passed. Every response carried
HTTP Strict Transport Security and Content Security Policy headers; every cell
had reachable navigation and no horizontal overflow. The 390-pixel cells had
zero visible controls below the 44-pixel touch floor.

| Metric                                           | Observed worst |       Gate |
| ------------------------------------------------ | -------------: | ---------: |
| Largest Contentful Paint (LCP)                   |       1,072 ms | < 1,800 ms |
| Interaction to Next Paint (INP), lab interaction |         112 ms |   ≤ 200 ms |
| Cumulative Layout Shift (CLS)                    |         0.0763 |      ≤ 0.1 |

The independent canonical responsive audit also passed at 390, 768, and 1440
pixels with zero findings. Desktop browser and mobile browser are therefore at
parity for the public play shell, navigation, theme selection, legal/footer
surfaces, and measured performance. Native/mobile app parity is not applicable:
VaultFront has no native client or installable app-store surface; its mobile
product is the responsive browser/PWA surface measured above.

The evidence is staging-only. It is not production parity evidence and does not
authorize production promotion by itself.

## Rollback observation

Workflow `31750318879` admitted both immutable staging attestations, switched
stable staging from `0a9149c8` to prior known-good `0682e90f`, observed that
revision healthy, restored `0a9149c8`, and observed it healthy again. The drill
took 34,191 ms and self-verified receipt
`sha256:93f5b979edbe990b7fb7bed16d385264b9f242ad63506ed4bdfc29338e9562eb`.
