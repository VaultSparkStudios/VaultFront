# Decisions

Public-safe decisions only. Detailed internal decision history is maintained privately.

## 2026-07-22 — Evidence trust boundaries require lifecycle and expansion budgets

**Decision:** Authenticated Alpha evidence has a 24-hour release cohort and a 30-day storage ceiling. Every mutation route must appear in a bidirectional machine catalog, and unauthenticated ingestion cannot exceed its explicitly reviewed 11-route budget without changing the rationale-bearing contract.

**Why:** Durability without retention turns release evidence into indefinite actor-linked accumulation. Complete route coverage without an expansion ceiling still permits security posture to weaken one apparently valid entry at a time. Lifecycle and risk budgets make both forms of drift executable failures.

## 2026-07-22 — Dependency automation executes only trusted-base policy

**Decision:** Dependabot convenience exemptions require exact bot identity, an ecosystem-derived branch, and ecosystem-specific changed-file scope. The validator is loaded from the pull request base commit with checkout credentials disabled.

**Why:** Pull request head content is attacker-controlled. An automation exemption is safe only when its decision logic comes from trusted repository state and cannot convert a dependency update into a mixed-scope change.

## 2026-07-19 — One certificate is the only match-outcome authority

**Decision:** Archive, progression, metrics, recap, and coaching consume one strict-majority, complete-roster, tamper-evident match result certificate. Client winner/stat payloads remain attestations and cannot independently mint downstream state.

**Why:** Multiple near-equivalent winner paths create irreconcilable truth. One certificate makes every downstream consumer idempotent, auditable, and resistant to incomplete rosters, duplicate network votes, and client-supplied artificial-intelligence context.

## 2026-07-19 — Reachability and release decisions are executable evidence graphs

**Decision:** Human/agent capability claims must name checked-in route/client/mount evidence and pass the capability reachability probe. Release decisions must carry an ordered SHA-256 lineage from source and individual gates to the final decision.

**Why:** A feature list or release report can drift while remaining persuasive prose. Exact source tokens, scoped availability, per-node receipts, and a root digest make omission and tamper visible without claiming a live deployment.

## 2026-07-19 — Meta surfaces load at intent time, not startup time

**Decision:** Command Center and its heavy progression surfaces load only after explicit navigation, and the production transfer ratchet remains authoritative over convenience imports.

**Why:** The initial implementation exceeded the Brotli budget by 2.6 kB. An awaited custom-element navigation boundary preserves immediate play startup while keeping every meta feature reachable and E2E-proven on desktop and mobile.

## 2026-07-16 — Semantic releases require an explicit launch switch

**Decision:** Verify the exact-pinned Semantic Release toolchain on every main push with read-only permissions. Run the write-capable release job only when the repository variable `SEMANTIC_RELEASE_ENABLED` is explicitly `true`.

**Why:** Repairing CI must not silently convert a FORGE/public-unlaunched implementation commit into a public GitHub release. The switch keeps release capability tested while preserving founder approval and launch-announcement gates.

## 2026-07-16 — Launch evidence is source-labeled and non-substitutable

**Decision:** Human, agent, and test Alpha Gate evidence are separate classes. Automated or synthetic events may verify behavior but cannot satisfy the distinct-human launch gate; event IDs are deduplicated and actor identifiers remain pseudonymous.

**Why:** A mechanically green path is not evidence that humans understood, completed, or wanted the loop. This preserves CANON-031 observability honesty and prevents test traffic from promoting the product.

## 2026-07-16 — Remote AI is optional, attributed, and hard-capped

**Decision:** Every remote Anthropic enhancement route is default-off, requires an explicit positive hourly cap, reserves budget before use, and records a feature attribution. Deterministic local coaching remains the free-tier baseline.

**Why:** Free gameplay must remain cost-neutral and useful even when remote AI is disabled or exhausted.

## 2026-07-16 — Vault Pressure is a reversible three-delivery breach state

**Decision:** Three successful deliveries open a 90-second breach window; the next delivery wins, while expiry returns pressure to two rather than zero. The state is server-authoritative and surfaced through HUD/telemetry.

**Why:** This creates a legible, high-tension climax without making a single expired opportunity erase all strategic progress.

## 2026-07-16 — Generated Obelisk helpers remain quarantined until a native integration is ready

**Decision:** Remove all generated Obelisk helpers from deployable `src/` and untrack `obelisk-passport/` while retaining that reference cargo locally behind `.gitignore`.

**Why:** The committed React `.tsx` helper was unreferenced, introduced a missing `react` dependency, required JSX compiler settings the Lit project does not use, and broke `npm run build-prod`. The passport directory was also still tracked, so the prior local/ignored quarantine claim was not true in Git.

**Constraint:** Do not add a React dependency merely to preserve a generated stub. Implement Obelisk natively for the project Lit architecture only after production relying-party origin, callback contract, and server verification requirements are available and testable.

## 2026-07-16 — Keep rights provenance local/private while preserving AGPL obligations publicly

**Decision:** Untrack `docs/RIGHTS_PROVENANCE.md` from the public repository and keep it locally behind `.gitignore`. Retain the root AGPL-3.0 `LICENSE` and public source availability required by the OpenFrontIO fork obligation.

**Why:** The canonical sanitization scanner classifies the detailed rights ledger as a private Studio OS document. Removing it from the public index clears the private-document gate without weakening the actual copyleft notice or source-availability obligation.

## 2026-06-14 — Generated Obelisk passport stubs stay local until relying-party origin registration

**Decision:** `obelisk-passport/` is ignored in this repo until VaultFront has a registered production relying-party origin and a deliberate login/callback/server verification integration plan. The generated files can remain in the local workspace as reference cargo, but they are not deployable source yet.

**Rationale:** The generated passport itself says production origin is unknown. Committing or wiring it now would create an unfinished auth surface and a public promise before the Obelisk relying-party contract is ready.

---

## 2026-06-04 — Chain Guardian: threshold 3 consecutive captures, reset on site loss

**Decision:** Chain Guardian badge fires when any player makes 3 consecutive vault captures. The chain resets when the player's `passiveOwnerID` is overwritten by a different player capturing a site they previously owned. This is a session-scoped counter (not persisted); it resets implicitly at match end.

**Rationale:** Simplest implementation that still rewards the key skill expression without requiring cross-tick memory of complex defense sequences. The "consecutive" framing is player-intuitive and avoids confusion with the 3-step execution chain (capture → deliver → pulse-deny).

---

## 2026-06-04 — Narrator auto-blend: computed server-side from tickBucket only

**Decision:** `blendMode` is computed server-side in NarratorBus from the `tickBucket` field alone (early → tactical, mid → mixed, late → hype). Not from score differential (which would require additional state). Client cannot supply blendMode — it's injected at queue time.

**Rationale:** tickBucket is the single most reliable proxy for match drama without additional server-side tracking. Avoids adding a `scoreDelta` field to the context snapshot that would require Worker.ts to maintain cross-tick player score state.

---

## 2026-04-06 — CANON-008: All VaultSpark IP is proprietary by default

**Decision:** All code, content, assets, and designs created by VaultSpark Studios are proprietary and all rights are reserved by VaultSpark Studios LLC unless an open-source license is explicitly declared and approved by the Studio Owner. No agent may apply or imply an open-source license without Studio Owner direction.

**Applies to this project:** Yes — `docs/RIGHTS_PROVENANCE.md` reflects this project's specific license status.

**Rationale:** VaultSpark Studios LLC is a commercial entity building owned IP. Open-sourcing any project without deliberate strategy gives away commercial advantage and creates ownership ambiguity.

**Studio canon:** `vaultspark-studio-ops/docs/STUDIO_CANON.md` → CANON-008

---

## 2026-05-17 — Ghost route: shared-state deception via display-layer hiding

**Decision:** `ghost_route` hides opponent convoys from the opponent's HUD (skip rendering when `isGhost && !isOwnConvoy`) rather than per-player server filtering. Owner sees real ETA; opponents see nothing until delivery.

**Rationale:** Per-player update filtering would require major architecture changes. The display-layer approach is deterministic, server-authoritative (ghost flag lives in execution), and achieves the strategic deception goal.

---

## 2026-05-17 — Bot vault commands: simple pressure heuristic, not site queries

**Decision:** Bots use a local `hostile / total neighbors` pressure ratio to decide vault commands rather than querying vault site state directly. Site-targeting bias is added to `AiAttackBehavior` via the new `vaultSiteControllerIDs()` Game interface method.

**Rationale:** Keeps `BotExecution` lightweight; the `neighborPressure` heuristic matches NationExecution's proven pattern; vault-site bias in attack selection adds strategic depth without overcomplicating bot decision trees.

---

---

## 2026-07-16 — State mutation authority is explicit and claim-bound

**Decision:** Every HTTP route that changes player, match, clan, tutorial, prediction, season, lobby, or tournament state must authenticate a verified bearer actor and authorize the requested subject/role before touching a store. Client-supplied identifiers are routing inputs, never proof of identity.

**Why:** A broad collection of individually validated payloads still allowed identity substitution. One shared authorization contract is easier to audit, test, and extend than route-specific trust assumptions.

## 2026-07-16 — Runtime and release evidence are digest-bound, scoped, and fail-closed

**Decision:** Runtime health, experiment rejection posture, WebSocket budgets, mutation policy, and remote-AI scope are serialized into a canonical Runtime Integrity Passport. Production builds generate a separate Release Evidence Manifest binding Git state, launch mode, work exhaustion, and exact transfer budgets. Both expose honest process-local scope and fail when required evidence is unhealthy or incomplete.

**Why:** Operator surfaces should be independently recomputable and tamper-sensitive, not prose snapshots that drift from the systems they describe.

## 2026-07-16 — Exhaustion is a machine-checkable work state

**Decision:** A saturated arc is complete only when the latest audit sidecar and innovation pack contain no pending unblocked entries. Deferred live/external evidence remains explicit but does not masquerade as locally executable work.

**Why:** This separates genuine completion from stopping after one objective, while preserving honest deferral of evidence that cannot be created by code.

## 2026-07-20 — Generated observability must validate adjacent claims, not only render them

**Decision:** Startup and release surfaces recompute any claim that can be derived from values already present in the artifact. Context percentage comes only from used tokens and limit; SIL forecasts are absent without parsed category evidence; the release decision carries a canonical fingerprint over status identity, generated manifest posture, footer topology, and immutable deployment sources.

**Why:** A polished surface can still lie when each field is individually plausible but mutually inconsistent. Self-validation turns contradictions into failing evidence instead of founder-facing confidence.

## 2026-07-20 — Operator recovery is part of the immutable promotion contract

**Decision:** Production promotion and rollback require an exact image digest, its matching staging-evidence digest, dry-run-first execution, canonical /_health revision verification, and a retained receipt. Mutable image tags and undocumented workflow inputs are not acceptable recovery paths.

**Why:** A rollback instruction that cannot be executed against the live workflow is false safety. Binding documentation to checked inputs makes recovery rehearsable without weakening launch gates.

## 2026-07-21 — Certified convoy dominance resolves spectator predictions

**Decision:** Prediction League outcomes derive inside the idempotent certified progression spine: total deliveries greater than or equal to total intercepts resolve as `delivery`; intercepts strictly greater resolve as `intercept`. A tie therefore means the convoy survived at least as often as it was stopped. Resolution emits a typed count receipt and duplicate match envelopes cannot resolve twice.

**Why:** The prediction surface previously accepted picks without any caller that resolved them. Binding the rule to certified match evidence closes the loop without creating a second winner authority.

## 2026-07-21 — Local visual evidence is self-expiring and cannot claim staging

**Decision:** Theme proof is a six-cell local-only receipt covering three themes across desktop/mobile play and settings surfaces. The doctor verifies WCAG AA token contrast, surface completeness, a 30-day freshness ceiling, and the literal `local-only` claim boundary.

**Why:** Screenshot existence is weaker than a checked evidence contract, but local browser output still cannot prove live origin parity, headers, Core Web Vitals, or founder approval.

## 2026-07-21 — External blockers remain visible but do not defeat local exhaustion

**Decision:** `externally-blocked` is non-actionable for the local work-exhaustion gate while remaining distinct from shipped, deferred, or human-blocked work in the audit and Genius surfaces.

**Why:** Cross-repo receipts and launch authorization cannot be completed by editing this repository. Treating them as locally pending made saturation impossible; treating them as done would hide material truth.

## 2026-07-21 — Canonical helper discovery must be side-effect-safe

**Decision:** Treat Studio Ops helper `--help` behavior as untrusted until inspected. After three discovery commands unexpectedly executed against the sibling default root, VaultFront made no direct sibling repair; it shipped signed Ark handoff `01JU3V1GUP49DF58394CEE8244` with the likely touched paths for the Studio Ops owner to reconcile, then reran the same helpers only with explicit `--project .` targeting VaultFront.

**Why:** A help probe that mutates default state violates least surprise. Directly reverting the sibling would compound the CANON-018 violation and risk overwriting unrelated concurrent work.

## 2026-07-22 — Daily rewards require certified evidence and explicit durability

**Decision:** Daily Mastery accepts only metrics from the server-certified match envelope. One player/game/UTC-day event is idempotent in PostgreSQL; completion credits a persistent Mastery wallet exactly once. When no database is configured, local development may use a process-local fallback only if every snapshot and receipt labels that scope. Authenticated reads fail closed when configured persistence is unavailable.

**Why:** The prior client narrator path could not prove identity or outcome, advertised unimplemented bonus gold, and lost state on restart. A retention promise is part of the trust boundary, not decorative HUD copy.

## 2026-07-22 — Verification owns both resource ceilings and production visibility

**Decision:** Vitest commands cap workers at four. Coverage explicitly enumerates production TypeScript, requires the 4,300-line Worker to remain visible even at zero coverage, and applies measured no-regression floors to ten critical server/client seams. Route logic should be extracted from the Worker when a trust boundary can be dependency-injected and tested directly.

**Why:** An unbounded verifier can become its own outage, while loaded-only coverage can look healthier by omitting the largest risks. Visibility and percentage are separate invariants; both must be honest.

## 2026-07-23 — Player progression and product analytics share one certified match authority

**Decision:** Seasonal contracts and core-loop evidence accept only the authoritative match envelope. Client mutation endpoints remain explicit `410 Gone` tombstones; PostgreSQL is authoritative when configured, and process-local fallback is allowed only in database-free development with its durability labeled in every receipt.

**Why:** A visible progression or analytics promise is false if a browser can inflate it, replay it, carry it across matches, or lose it on restart while the product calls it durable.

## 2026-07-23 — Prediction League is the only spectator prediction write path

**Decision:** One authenticated Prediction League contract owns spectator picks, durable history, certified match resolution, and privacy-minimal consensus. The anonymous narrator poll is retired; consensus broadcasts are derived from accepted ledger writes. Submission and resolution take the same per-game PostgreSQL advisory transaction lock.

**Why:** Parallel vote systems created two incompatible truths and let anonymous traffic look like persistent league participation. One authority closes replay and late-write races while preserving the live crowd moment.

## 2026-07-23 — Static capability and runtime observation are separate release facts

**Decision:** A source-declared health route is `healthRouteContract`, never a runtime pass. Release readiness requires a fresh provenance-bearing health observation with a matching digest, HTTP 200, and healthy payload.

**Why:** Source text can prove that code declares a route, but cannot prove reachability, deployment identity, or health.

## 2026-07-23 — Router extraction must immediately contract measurable risk budgets

**Decision:** Route inventory scans Worker and every extracted `*Router.ts`; three domain routers carry direct tests and bounded size. Removing the duplicate anonymous poll lowers the public-ingest ceiling from eleven to ten, and Worker growth fails above 4,040 physical lines or if extracted route literals return.

**Why:** Refactoring without a tighter invariant simply creates temporary cleanliness. The removed blast radius should become a lower machine-enforced ceiling in the same change.

## 2026-07-23 — Preserve and disclose the mismatched preexisting session commit

**Decision:** Keep local commit `6328f044` intact even though its `feat(auth)` message does not describe its public-playlist changes. Do not reset, rewrite, or force-push; record the mismatch and include the remaining Session 81 work in a truthful follow-up closeout commit.

**Why:** The content is valid and verified, but rewriting an unexpected shared-worktree commit would be destructive and could erase unknown provenance. Disclosure is safer than history surgery.

## 2026-07-23 — Visible progression promises require certified events and durable entitlements

**Decision:** Season Pass progress accepts one certified player/season/game result, aggregates transactionally in PostgreSQL, and claims materialize title/badge entitlement rows under the authenticated actor. A configured-but-unavailable database fails closed; database-free development is explicitly process-local.

**Why:** A restart-volatile counter and claimed boolean cannot truthfully support a visible earned-reward promise. Game idempotency, actor ownership, durable reward identity, UI projection, and persistence scope must agree.

## 2026-07-23 — Gameplay balance is an executable release input

**Decision:** Convoy tuning lives in one versioned JSON authority and reward math in one pure planner shared by runtime and verification. Production builds publish a byte-stable deterministic envelope, reject counterexamples, and bind both artifact and source digests into release lineage. Experiment aggregates separately declare that they reset at worker restart.

**Why:** Hand-copied constants, random property samples, and unlabeled process-local summaries can all look plausible while describing different systems. Reproducible bounds and explicit storage scope make balance and observability independently auditable.

## 2026-07-24 — Certified progression completion means every leg completed exactly once

**Decision:** One player/game progression attempt is serialized at the stats store, coalesced while in flight, released on failure, and complete only after every fan-out leg succeeds. Its completion receipt is digest-bound and independently verifiable; duplicate references are not represented as fresh proof.

**Why:** Pre-claiming an event before asynchronous work finishes converts a recoverable dependency failure into silent permanent data loss, while retrying without store idempotency can inflate player state. Completion, replay protection, and receipt semantics must describe the same boundary.

## 2026-07-24 — Vault Pressure rules are versioned balance authority

**Decision:** The breach threshold and window duration live in `config/vaultfront-balance.v1.json`, flow through one typed balance projection, and drive both runtime transitions and the deterministic public envelope. `VaultFrontExecution` composes the pure pressure kernel and may not re-embed its state machine.

**Why:** Vault Pressure is the match climax. Its transition semantics and release evidence must derive from one reviewable authority rather than matching constants by convention.

## 2026-07-24 — Match feedback inherits match-certificate authority and a 30-day privacy ceiling

**Decision:** Feedback writes accept only the authenticated actor and map bound into a certified match result, deduplicate replay in memory and PostgreSQL, retain raw evidence for at most 30 days, and expose aggregates only through certified outcome, match-path, play-style, and confidence cohorts.

**Why:** A rating is useful only when its match context cannot be spoofed or counted twice. Privacy-safe cohorts preserve design signal without turning open-text feedback into an indefinite identity trail.

## 2026-07-24 — Runtime, release envelopes, and signed replays share exact balance identity

**Decision:** All fifteen existing gameplay domains project from `config/vaultfront-balance.v1.json`. Its canonical SHA-256 identity is embedded in HMAC-covered replay configuration and must match the current runtime; legacy absence is labeled, while a signed incompatible identity is rejected.

**Why:** A valid signature proves bytes were not altered, not that the current engine interprets them under the same rules. Compatibility must be independently explicit and fail closed.

## 2026-07-24 — Post-match health is a session-scoped task receipt, not optimistic UI completion

**Decision:** The win shell renders immediately, optional enrichments run in parallel behind deadlines and cancellation, stale completions cannot mutate a newer session, and one receipt classifies every task as completed, timed out, failed, or cancelled before deriving a healthy/degraded pulse.

**Why:** UI responsiveness and observability truth are compatible only when optional work is bounded and every lifecycle outcome is recorded exactly once.

## 2026-07-24 — Production dependency closure outranks a dishonest force-fix

**Decision:** Upgrade to trusted ESLint 10, compatibility 2, and EJS 6; replace `vite-plugin-html` with the repository's six-line deterministic development HTML transform; mark the proprietary package private; explicitly exclude npm publishing from semantic-release; and pin patched transitive packages where npm honors overrides. Do not run `npm audit fix --force` while it proposes downgrading semantic-release to 15.9.3.

**Why:** Production now audits at zero vulnerabilities and obsolete HTML tooling is removed. The remaining audit aliases are inside npm 11 bundled by semantic-release, which is development-only and not in the explicit release plugin path. npm 12 is the first patched bundle but requires Node 22.22.2 or 24.15 while this project's verified matrix includes Node 20 and 24.14; pretending that breaking the release/runtime matrix is a security fix would exchange an unreachable toolchain advisory for a live delivery failure.

## 2026-07-26 — Post-match continuations inherit certified source authority

**Decision:** Rematch join/create requires verified source-game participation; archived participation must bind the actor's client identity through a valid result certificate. Prediction writes require a real started and still-open GameServer. Replay shares are versioned content-addressed projections of a verified signed manifest and an exact in-range turn window.

**Why:** Authentication proves who is asking, not that a caller belongs to a match, that a game identity is real and open, or that a random share token names immutable evidence. The post-match retention loop must inherit the same authority that certified the match rather than treating possession of a game ID as permission.

## 2026-07-26 — Risk equivalence must be symmetric and deterministic

**Decision:** Convoy rerouting treats risks within `0.0001` as equivalent in both directions and breaks that equivalence by distance. Property evidence uses a seeded sequence plus an explicit near-equal adversarial case, never uncontrolled randomness.

**Why:** The former comparator let an infinitesimally lower risk bypass its own epsilon tie-break, while random test inputs only exposed the contradiction intermittently. A mathematical ordering contract and its gate must be reproducible.

## 2026-07-27 — Session 86 certified authority decisions

- Caller-authored competitive outcomes are rejected even for tournament creators; archived majority-certified results are the only advancement authority.
- Dynasty prose may be generative, but its clan, actor, outcome, and deduplication key must be derived from the certified game record.
- Leaderboard state is an indexed projection over `player_stats`; no table-wide cache rebuild belongs inside the certified match transaction.
- Browser storage may render hints but cannot own rivalry progress. Rival revenge is recorded in deterministic simulation stats and travels through the existing certified result spine.
- Registry type drift (`app` externally vs `game` locally) is not repaired by editing a sibling repository; correction travels through Studio Ark.

## 2026-07-27 — Session 87 authority, parity, and monotonic-truth decisions

### Archived certificates close over exact roster identity

**Decision:** A certified archive is admissible only when GameRecord client IDs are unique and exactly equal the certificate statistics roster, and persistent identities are non-duplicated. Winner projection returns no identities if any winning client is missing or repeated.

**Why:** Signature validity cannot make an independently mutable roster authoritative, and partial projection can turn a malformed team result into a plausible winner.

### Tournament advancement is contingent on durable persistence

**Decision:** Certified result mutation is snapshot/rollback protected; persistence failure is typed and prevents advancement, while successful replay remains idempotent.

**Why:** A caller must never receive certified advancement for state that a restart can erase.

### Player rating semantics are store-independent

**Decision:** Memory and PostgreSQL both pass the player's current match count into Elo calculation, preserving placement K=64 through five matches and established K=32 afterward.

**Why:** Development and production must not teach different progression behavior.

### Victory guidance has one player-facing authority

**Decision:** Orientation, action completion, and gameplay documentation reuse one exact four-delivery convoy-to-Breach explanation.

**Why:** The core loop cannot be learned reliably when visible instructions disagree with executable victory rules.

### Continuous integration blocks deployable dependency risk

**Decision:** The release gate blocks `npm audit --omit=dev --audit-level=moderate`; full-tree advisories remain visible without treating known dev-only aliases as production exposure.

**Why:** Security evidence must be strict about shipped risk and honest about tooling debt.

### Innovation regeneration is monotonic

**Decision:** Every source-backed shipped candidate, including rank 38, belongs to canonical generation and regeneration may not shrink or forget the ledger.

**Why:** A generator that deletes checked-in evidence is not an authority.
