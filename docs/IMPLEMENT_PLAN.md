# Session 104 Implementation Plan

Source: `docs/AUDIT_2026-08-14.json`

1. **Canonical observation integrity** — #220 L1 first: require recomputed semantic digests for every gate, remove duplicated deployment secret derivation/transport, and prove forged generic provenance is rejected.
2. **Durable Alpha readiness authority** — #221 L2: feed the existing durable, privacy-safe playtest summary into Master readiness; preserve fail-closed behavior and add contract coverage.
3. **Checkout and receipt authority** — #223 L2: replace the SPA fallthrough and declarative revenue flag with a server-owned allowlisted checkout route plus signed, idempotent, durable payment receipts.
4. **Runtime evidence corridor** — #220 L2: add per-gate Ed25519 claims bound to authority, catalog, revision, image, origin, workflow lineage, and expiry; transport only verified staging claims through a read-only hot mount. The staging signer can never assert Alpha, Zoho, revenue, or founder approval.
5. **Receipt currency** — #222 L2: make the current exact staging run explicit in project status/handoff and harden startup receipt selection against stale predecessor runs.
6. **Verification and release rerun** — run focused tests after each item, then full type/lint/format/contracts/build/test/coverage/security gates, direct-main commit/push, exact staging deployment, release gate, and production promotion only if every non-waivable external gate is observed.

The release-readiness path is a measurement surface for the public-interest → authenticated First Extraction → certified feedback loop. No code path may synthesize human participation, mail identity, or revenue evidence.
