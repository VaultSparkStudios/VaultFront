# Brain

Public-safe architecture notes only. Detailed implementation and operator reasoning are maintained privately.

## Durable VaultFront invariants

- Launch evidence is source-labeled: test/agent traffic proves paths but never substitutes for distinct human Alpha Gate sessions.
- Replays are signature-verified by every consumer and fail closed outside development/test.
- Match progression is server-authoritative and idempotent; clients render outcomes but do not mint them.
- Remote AI is optional, default-off, feature-attributed, and bounded by an explicit positive hourly cap; deterministic local behavior remains the baseline.
- Registry changes travel through signed Studio Ark cargo; local public-unlaunched truth remains authoritative until the control plane accepts a correction.
- Release readiness distinguishes declared configuration from verified external evidence.
- Every state-changing route must cross the shared verified-actor boundary; a client-supplied subject identifier never proves identity.
- Runtime health is process-local and source-derived: HTTP, IPC freshness, game-loop freshness, transport budgets, and provider-bound AI reservations must expose scope explicitly.
- A saturated arc is complete only when executable exhaustion proves no pending unblocked audit or innovation item remains; live-only deferrals stay visible.
- Runtime Integrity Passport and Release Evidence Manifest digests are the durable operator proof surfaces; prose summaries are secondary.
- Client winner/stat reports are attestations only; one quorum-backed Match Result Certificate is the sole archive, progression, metrics, and post-match AI authority.
- Canonical AI evidence continues through the validated output: every remote answer carries a provider/model/output receipt, and cached responses preserve the same receipt.
- High-risk routes are executable policy entries, not documentation; exact method/path/auth/evidence bindings must fail startup or tests on drift.
- Human + Agent capability claims remain `implemented-local-unlaunched` until a live runtime exists and must pass source-digested reachability checks.
- Release evidence is an ordered provenance DAG whose decision root binds source, external gates, local gates, exhaustion, and transfer budgets.
- Heavy meta surfaces belong behind intent-time lazy boundaries; exact gzip/Brotli budgets decide whether an import may remain initial.
- Staging admission binds product semantics, not just health: exact revision, JSON API ingress, privacy, identity redirect/cookies, and agent surfaces must live inside the run-bound attestation.
- The supported Node floor is the intersection of every locked dependency engine; provider evidence may raise it beyond the first dependency that reports an incompatibility.
