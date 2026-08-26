# Mobile Parity Attestation

Status: shipped to stable staging for the exact candidate below. This receipt
does not claim production promotion, portable founder approval, or native-app
coverage.

## Exact candidate

- Git SHA: `7fbaedcdd83be3a58b4865c5ce863dff8d14d963`
- Image digest: `sha256:6c261f221b1cfb70c550844b781d5ebf3da9bbc1ecd18935b909b361e7e42470`
- Stable origin: `https://staging.vaultfront.io`
- Deploy: [GitHub Actions run 32943456027](https://github.com/VaultSparkStudios/vaultfront/actions/runs/32943456027)
- Signed observer: [GitHub Actions run 32943706016](https://github.com/VaultSparkStudios/vaultfront/actions/runs/32943706016)
- Observer artifact: `staging-observation-32943706016`
- Parity receipt digest: `sha256:a15715f5368c0033f3bfe6b6749699e7986d97122d9e807028128ef0632cac90`
- Signed evidence file digest: `sha256:b209387238f5daff0020d511417aaee813ed25d890019a705454ed545248edc0`

The repository verifier accepted all five `staging-v1` runtime claims for the
exact SHA, origin, environment, and image digest.

## Executable matrix

The signed exact-live observer passed all 27 required cells with zero findings:

| Surface   | Device widths and orientations               | Themes                         |  Cells |
| --------- | -------------------------------------------- | ------------------------------ | -----: |
| Phone     | 360, 390, and 414 px; portrait and landscape | VaultFront, light, competitive |     18 |
| Tablet    | 768 px; portrait and landscape               | VaultFront, light, competitive |      6 |
| Desktop   | 1440 px landscape                            | VaultFront, light, competitive |      3 |
| **Total** |                                              |                                | **27** |

Worst observed Core Web Vitals across the complete matrix were:

- Largest Contentful Paint: 1,224 ms (gate: less than 1,800 ms)
- Interaction to Next Paint: 152 ms (gate: at most 200 ms)
- Cumulative Layout Shift: 0.0151 (gate: at most 0.1)

Every applicable mobile cell proved:

- a contained, settled drawer using dynamic viewport height;
- a safe-area-aware internal scroll region;
- a reachable 44 px close control;
- active document scroll lock while open and released lock after close;
- synchronized closed `aria-hidden`, `aria-modal`, and trigger
  `aria-expanded` state;
- no horizontal overflow or undersized interactive target; and
- reduced-motion compliance.

Tablet landscape retains 44 px desktop-navigation targets. The language modal
also uses a readable theme-token palette, a 44 px back control, paint
containment, and cancellable text-first flag hydration: decorative flag
requests begin 250 ms after the first frame and are cancelled when the surface
closes before then.

## Rendered-pixel and security evidence

The source-bound local proof passed six desktop/mobile theme cells and retained
144 screenshots:

- Source digest: `sha256:9da3851790e17b437a273fa528017e036fb1c7374a3fe395613d9a345e22be3c`
- Receipt digest: `sha256:b07bfeaf183eabaeda8b59cd097c346aabf923a09502aa9db12d5ebec6b0170f`
- Claim boundary: local rendered evidence supports the exact checked source; it
  is not live staging parity or founder approval.

The exact-live matrix separately verified HTTP 200 responses, HSTS
`max-age=31536000; includeSubDomains`, the deployed Content Security Policy,
the exact `commit.txt` revision, the live footer manifest, and signed runtime
evidence. Representative desktop and mobile-landscape drawer captures were
visually inspected after download.

Native application parity is not applicable: VaultFront is a browser
application and has no native mobile surface in this release.
