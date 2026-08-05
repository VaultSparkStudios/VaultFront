# Implementation Plan — Session 95

> Source: `docs/AUDIT_2026-08-04.json` · six pending premise-verified items · default rung L3 because the full arc is explicitly authorized.

## Wave A — Public and authentication trust

1. **#148 retire-public-obelisk-broker-copy** — remove the unused Studio Ops broker copy; add an executable public-boundary guard; prove canonical sanitization and secrets checks stay green.
2. **#149 bounded-identity-introspection** — deadline and abort remote `users/@me` admission; inject fetch; cover success, response, schema, network, and timeout behavior.
3. **#147 asset-aware-secret-signal** — suppress only low-confidence entropy inside verified asset payloads; deduplicate generated mirrors; preserve all semantic credential blocking.

## Wave B — Protocol and closeout idempotency

4. **#145 project-local-skill-bridge** — add allowlisted project-root wrappers for `skill-profile` and `sample-codebase`, plus provenance and denial tests.
5. **#146 idempotent-doctor-closeout-format** — make closeout own formatting for the doctor sidecar and prove content-digest and two-pass byte stability.

## Wave C — Build feedback ownership

6. **#150 single-owner-static-assets** — move resources from Vite `publicDir` to the existing static-copy pipeline, preserve dev/build URL reachability, and gate the retired warning class.

## Mandatory verification

- Focused tests after each item; no item marked shipped without behavior proof.
- Full 218-file Vitest suite with coverage; TypeScript; ESLint; Prettier ratchet; contracts; production build; Pages; bundle budgets; dependency/security scans.
- Browser proof recaptured after the Vite ownership change across all three themes, desktop and mobile; final CANON-053 receipt must bind final bytes.
- Release remains NO-GO unless external evidence is actually observed.
