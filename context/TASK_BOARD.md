# Task Board

Public-safe roadmap only. Detailed backlog sequencing is maintained privately.

## Completed (2026-05-17 — Session 2 /implement pass)

All 24 Session-2 audit items shipped. Key wins: vault-heist, bounty-board, warchest-hunt, 5 AI narrative endpoints (prophecy/commentary/lore/mission/coach), 6 map events, economic warfare (sabotage/bribe/trade), adaptive bot personalities, dynasty-mode server logic, color-blind mode, play-style insight card, TouchHandler mobile gestures, anti-cheat admin endpoint, tile dedup encoding, clan ELO.

## Completed (2026-05-17 — Session 1 /implement pass)

All 19 items from `docs/AUDIT_2026-05-17.md` (Session 1) shipped.
Key wins: last-stand-event, convoy-intercept-predictor, ai-battle-narrative,
smart-spectator-camera, convoy-ghost-route, bot-vaultfront-awareness,
api-auth-security, context-token-ledger, all mutator expansions, Elo/rank system.

## Completed (2026-05-18 — Repair /implement pass)

All 6 items from `docs/AUDIT_2026-05-18.md` shipped: startup-brief-repair,
contract-hud-live-progress, coach-hint-site-signal, stream-overlay-reconnect-memory,
narrator-bus-token-guardrails, and anti-cheat-alert-cooldown.

## Completed (2026-05-18 — Session 5 /implement pass)

All 16 items from `docs/AUDIT_2026-05-18_S5.md` shipped:
vault-fortune-post-win (FortuneDeck + WinModal fortune card), play-style-career-arc
(styleHistory store + PlayStyleCareerArc component + postStyleHistory), achievement-chain-meta
(5 meta-chains: vault_sovereign/convoy_legend/surge_master/speed_demon/grand_architect),
ai-prematch-intelligence-brief (Haiku pre-match endpoint + LRU cache), clan-war-scheduler
(ClanWarStore + challenge/accept/decline/result endpoints), season-pass-track-ui
(SeasonMilestoneStore + SeasonPassTrack component), spectator-prediction-league
(PredictionLeagueStore + weekly leaderboard), post-match-ai-coach-debrief (WinModal
coach tab + fetchCoachDebrief), ai-narrative-game-recap (WinModal match story tab +
fetchMatchRecap), tournament-bracket-ui (TournamentBracketView SVG component),
achievement-profile-panel (AchievementsPanel + meta-chains display), advanced-tutorial-hints
(ADVANCED_HINTS + onFirstConvoyLaunched/onDynastySeasonStart methods), match-outcome-rating
(MatchRatingPrompt 5-star component + postMatchRating), replay-integrity-signature
(HMAC-SHA256 in ReplayStore), mobile-layout-optimization (scaleFactor helper in
VaultFrontLayer for narrow canvas banners), sil-score-pipeline-fix (rolling-status block
in SELF_IMPROVEMENT_LOOP.md).

## Completed (2026-05-18 — Session 4 /implement pass)

All 18 new items from `docs/AUDIT_2026-05-18.md` (Session 4) shipped:
master-ts-build-fix, global-lint-unblock, narrator-sentiment-persona (HYPE/TACTICAL/COMEDIC),
narrator-match-context, coach-hint-event-triggers (5 trigger types), play-style-mid-match (PlayStyleChip),
overlay-priority-queue, mutator-live-vote-banner, elo-winmodal-animation (rAF counter),
dynasty-story-winmodal (typewriter), post-match-share-card (OffscreenCanvas PNG),
seasonal-rank-decay (RankBadge orange pulse), elo-rank-sparkline (SVG hover),
spectator-crowd-prediction (NarratorBus crowd_vote SSE), replay-ai-highlight (autoHighlightTick),
daily-challenge-system (DailyChallengeStore + HUD card), vault-intelligence-market
(intel-purchase endpoint + canvas tooltip), token-oracle-cache (5-min LRU).

## Follow-ups

## Completed (2026-07-21 — Session 78 saturated product-truth arc)

- [done] Closed certified Prediction League resolution with deterministic delivery/intercept/tie rules and typed receipts.
- [done] Converged onboarding onto one First Extraction vocabulary and removed two proven-unmounted tutorial paths.
- [done] Shipped cross-match Convoy Mastery prescriptions across recap, debrief, and HUD.
- [done] Root-fixed startup chronology, scoped the spawn-heavy test budget, and retained the global timeout tripwire.
- [done] Generated all ten public nav/footer shells from one manifest with drift/path/route safety checks.
- [done] Produced a local-only three-theme × desktop/mobile Playwright proof and a self-expiring doctor gate.
- [done] Exhausted `docs/AUDIT_2026-07-21.json` at 9/9 and `docs/INNOVATION_PACK.json` at 11/11; two external corridors remain non-actionable locally and visible.
- [ecosystem] Await Studio Ops reply to Ark cargo `01JU3RL522793F2F1D15EC71D6` before changing the canonical registry profile.
- [release-evidence] Establish an approved external staging origin, then collect exact-digest parity, Brevo, Obelisk, live web/theme, three-human Alpha, revenue, and founder-approval evidence in that order.

## Completed (2026-07-21 — Session 77 interrupted-start recovery)

- Reconstructed Session 77 as cut off during `/start`, not during implementation or closeout.
- Verified Session 76 product work is committed at `22c2b3a6`; separated it from Session 77's uncommitted protocol/Canon refresh.
- Proved structured/config integrity, classified the one timing timeout with isolated and full reruns, and restored a direct green suite plus doctor `blockingFailing: 0` without weakening a gate.

## Completed (2026-07-19 — Session 75 complete saturated arc)

All 14 newly premise-verified findings in `docs/AUDIT_2026-07-16.json` shipped, exhausting the cumulative audit at 37/37. The session then generated and shipped three new second-order candidates, bringing `docs/INNOVATION_PACK.json` to 6/6.

Key outcomes: quorum-attested match certificates; exact game-create authority and capacity; database/state-scope readiness; bounded server-sent events; certificate-grounded artificial intelligence inputs and response receipts; an accessible lazy-loaded Command Center with feature-liveness proof; privacy-safe notifications; digest-deduplicated status projection; an executable high-risk route policy manifest; coherent task/brief provenance; closed Windows spawn bypasses; immutable deployment contracts; a Human + Agent capability reachability manifest; and a self-verifying release-evidence lineage graph.

Verification: 134/134 main Vitest files and 814/814 tests plus an independent 31-file / 119-test server repeat; 24/24 desktop/mobile Playwright; lint; typecheck; production build; formatting, exact gzip/Brotli/media bundle budgets, deterministic performance benchmarks, Canon/startup protocol checks, and project doctor `blockingFailing: 0`. Audit 37/37 and innovations 6/6 are shipped.

- [release-evidence] Deploy the exact verified digest to a real staging origin and verify parity.
- [release-evidence] Collect authenticated evidence from at least three distinct human Alpha Gate sessions; test or agent events cannot substitute.
- [release-evidence] Configure and verify project-domain Brevo delivery to the studio inbox.
- [release-evidence] Wire and verify native Obelisk relying-party authentication.
- [release-evidence] Verify live Content Security Policy / HTTP Strict Transport Security, Core Web Vitals, and every theme with screenshots.
- [release-evidence] Observe a real checkout/supporter event before changing revenue status.
- [release-evidence] Obtain founder approval before any SPARKED transition or public announcement.

## Completed (2026-07-16 — Session 74 saturated integrity arc)

All 11 newly verified findings in `docs/AUDIT_2026-07-16.json` shipped; the complete audit is exhausted at 23/23, followed by all 3/3 second-order innovation candidates in `docs/INNOVATION_PACK.json`.

Key outcomes: server-authoritative mutation authorization, experiment-integrity enforcement, bounded WebSockets, process-local worker-health watermarks, truthful project doctor, audit-driven Genius List, release/security-header truth, warning-free cycle-free production chunks, transfer/cardinality budgets, provider-bound remote-AI reservations, Runtime Integrity Passport, Release Evidence Manifest, and machine-checked work exhaustion.

Verification: 122 files / 762 unique Vitest tests plus an independent 25-file / 90-test server pass; 22/22 desktop/mobile Playwright; lint; typecheck; production build; formatting and bundle ratchets; sitemap 10/10; Canon zero gaps; doctor `blockingFailing: 0`; audit 23/23 and innovations 3/3 shipped.

- [release-evidence] Collect authenticated evidence from at least three distinct human staging sessions; test or agent events cannot substitute.
- [release-evidence] Configure and verify project-domain Brevo delivery to the studio inbox.
- [release-evidence] Wire and verify native Obelisk relying-party authentication.
- [release-evidence] Verify live CSP/HSTS, Core Web Vitals, and every theme with screenshots after a real staging origin exists.
- [release-evidence] Observe a real checkout/supporter event before changing revenue status.
- [release-evidence] Obtain founder approval before any SPARKED transition or public announcement.

## Completed (2026-07-16 — Session 73 full arc)

All 12 items from `docs/AUDIT_2026-07-16.json` shipped, followed by all 3 evidence-detected second-order innovation candidates. The arc added authenticated Alpha Gate evidence, signed replay enforcement, real private-lobby rematches, Vault Pressure, deterministic coaching, a remote-AI cost firewall, readiness truth, authoritative progression, CI/coverage/format/bundle ratchets, protocol recovery guards, a hardened public surface, and a zero-vulnerability dependency train.

Verification: 107/107 files and 697/697 tests; 22/22 Playwright tests under the exact CI profile; production build/typecheck; lint; coverage, formatting, and bundle ratchets; `npm audit` zero; Studio supply-chain scan zero matches; sitemap 10/10; Canon conformance zero gaps; Studio doctor `overallPass: true` and `blockingFailing: 0`.

- [done] [SIL] Reconcile registry/local project profile — local truth is now `game/public-unlaunched`; signed Ark correction cargo `01JTM66B6TEE83C483CEB936FA` requests registry `app → game` without weakening the launch posture.
- [done] [SIL] Add recovery-provenance classification — deterministic classifier and protocol tests distinguish backup residue, propagation, and current-session artifacts.
- [release-evidence] Run the authenticated Alpha Gate on staging with at least three distinct human sessions; automated/test evidence cannot satisfy it.
- [release-evidence] Observe a real checkout/supporter event before changing the revenue signal from unverified.
- [SIL] Replace the remaining Rollup circular-chunk warning and mixed JSON import-attribute warnings with a cycle-free lazy boundary while preserving per-chunk budgets.
- [SIL] Execute the staging launch-evidence corridor: Brevo delivery, native Obelisk relying-party auth, strict live headers/Core Web Vitals, and multi-theme screenshot verification.

## Completed (2026-07-16 — Session 72 recovery closeout)

Recovered and verified the interrupted post-S71 tree: retained the validated Studio protocol/Canon/Dependabot propagation, removed incompatible/unreferenced Obelisk helpers from deployable `src/`, untracked the local ignored passport cargo so quarantine is real, preserved the rights ledger locally while removing it from the public index, and proved the boundary with 94 files / 655 tests plus 10 server files / 30 tests and Studio doctor `blockingFailing: 0`.

- [SIL] Reconcile registry `app/public-unlaunched` metadata with local `game/internal` project truth so audit and release gates consume one intentional profile.
- [SIL] Add a recovery-provenance check that distinguishes `lint-staged` backup residue, propagated protocol files, and current-session generated artifacts.

## Completed (2026-06-14 — Session 71 /audit + /implement pass)

All 3 items from `docs/AUDIT_2026-06-14_S71.md` shipped: `obelisk-passport-quarantine`, `protocol-helper-regression-harness`, and `s71-truth-sync`. Verification passed with focused Studio helper Vitest, startup brief render/validation, compact handoff, secrets audit, blocker preflight, PROJECT_STATUS invariant check, broad `npm test` (94 files / 655 tests plus 10 server files / 30 tests), and `npm run build-prod`.

- Keep generated `obelisk-passport/` local until the relying-party production origin is registered and the login/callback/server verify path is intentionally wired.
- Keep the HUMAN PRESSURE startup block as a recommended future renderer improvement; current validation remains conformant without it.

## Unified Genius List (2026-06-13 — Session 70 /go)

- [done] 🔥 feedback_loop / automation · 20m · Alpha Gate Passport verification smoke — **DONE S70**: focused pulse/readiness/sidebar Vitest passed 14 tests after protocol repair.
- [done] ⚡ process / truth · 20m · Document next alpha-gate operator action — **DONE S70**: task board synced append-only, startup brief regenerated, and `validate-task-ids` passed.
- [done] ⚡ capital_efficiency / truth · 20m · Keep revenue warning honest — **DONE S70**: startup brief still reports revenue signal as blocked/unverified and broad `npm test` passed.
- [done] ⚡ dev_health / automation · 20m · Production build regression gate — **DONE S70**: `npm run build-prod` passed after `/go` helper repair.
- [release-evidence] 🔥 feedback_loop / launch · 1h · Manual rivalry/rematch alpha playtest — requires real tester/manual playtest evidence.
- [release-evidence] ⚠ capital_efficiency / revenue · manual · Observe live checkout/supporter event — requires real checkout/supporter telemetry.

## Completed (2026-06-14 — Session 70 /audit + /implement pass)

All 3 items from `docs/AUDIT_2026-06-14.md` shipped: `alpha-gate-operator-runbook`, `go-helper-regression-smoke`, and `readiness-alpha-evidence-copy`. Verification passed with focused Vitest, `npx tsc --noEmit`, production build, and broad `npm test` (93 files / 652 tests plus 10 server files / 30 tests).

- Use the KPI Alpha Gate strip during the next rivalry/rematch alpha gate; do not mark the live playtest complete until all five `alphaGate.checks` are green from real tester evidence.

- ~~Run a focused internal rivalry/rematch playtest and inspect the new pulse fields: `retentionChallengeShown`, `retentionRequeued`, `retentionRematchRequested`, and `rates.retentionAction`.~~ ✅ Instrumented for the next playtest (Session 68 adds `operatorNext`, KPI Rival action %, and latest signal age).
- ~~Fix unrelated global lint blockers in e2e/project-service config and Studio script lint debt.~~ ✅ Done
- ~~Fix pre-existing `src/server/Master.ts(166,30)` type error~~ ✅ Done
- ~~Run `npm run build-prod` and `npm run e2e` after this readiness pass to promote tournament playtest confidence.~~ ✅ Done (`build-prod` green; CI-style serial E2E green with one flaky retry)
- Wire a live revenue signal into the startup brief once checkout or supporter telemetry is observable.
- ~~Repair broad `npm test` residuals: `VaultFrontExecution` mock/BigInt failures and `CoachHintEngine` trigger-field assertion.~~ ✅ Done (Session 64 — all 90 test files / 637 tests green)
- ~~Consider a compact/mobile tutorial pattern that teaches VaultFront mechanics without a modal overlay.~~ ✅ Done (Session 65 — first-run mobile strip with tutorial pulse telemetry)
- ~~Run a mobile tutorial smoke in browser to verify strip placement against the live control panel.~~ ✅ Automated compact-width component smoke added in Session 66; manual browser playtest still useful before a public flip.
- Use the `operatorNext` script in `/api/vaultfront/playtest-pulse/summary` during the next internal rivalry/rematch alpha gate.
- Use the KPI Playtest Pulse tile to inspect Rival action %, latest signal age, and the next operator action after the next internal playtest.
- Use readiness `playtest-pulse` action insights as the next alpha gate; stale evidence, tutorial, feedback, and retention warnings should name the next action directly.
- Keep startup helper-chain drift on the next closeout radar; compact handoff and startup render are green after S66 helper restores.
- Observe a real checkout/supporter event and set `VAULTFRONT_REVENUE_OBSERVED=1` only after evidence exists.

## Deferred to Project Agents

- cross-repo item owned by another repo agent:

## Completed (2026-07-20 — Session 76 truth-contract arc)

All 5 premise-verified infrastructure findings in docs/AUDIT_2026-07-20.json shipped, followed by 3 new second-order candidates; docs/INNOVATION_PACK.json is now 9/9 shipped.

- [done] Context-meter arithmetic derives from used tokens / limit and the brief rejects contradictory percentages.
- [done] SIL parsing covers current and legacy formats, orders by session recency, and refuses numeric forecasts without evidence.
- [done] Project/status/manifest truth is fail-closed and bound into release evidence through a deterministic fingerprint.
- [done] All 10 public leaves pass the non-vacuous scoped 4-header / 7-footer route contract.
- [done] Deploy, promotion, and rollback documentation passes a 25-check immutable workflow contract.
- [done] Signed Ark correction and pattern cargos shipped without editing a sibling implementation tree.
- [done] Full proof: 134 files / 822 tests, 31-file / 121-test server repeat, lint, build, 24/24 E2E, and doctor blockingFailing 0.

## Now

- [ ] [ecosystem] Await the applied acknowledgement for source-tagged registry-delta Ark cargo `01JUJNSAUUE4626BC279319392`; keep local project-truth validation fail-closed until then.
- [ ] [release-evidence] Deliberately establish the approved staging contract, deploy the exact verified immutable digest, and produce a fresh parity observation bundle.
- [ ] [release-evidence] Verify project-domain Brevo delivery and native Obelisk relying-party authentication from staging before collecting human/business evidence.

## Next

- [ ] [release-evidence] Collect three distinct authenticated human Alpha sessions and a real revenue observation; obtain founder approval only after every prior gate passes.
- [ ] [ecosystem] Confirm Studio Ops receipt of Ark cargo 01JU1AEATS46E1C7F5DD9AE41C and verify the canonical registry/release-checker/startup-regex/signature fixes propagate back through Ark.

- [ ] [SIL:1] Generate the public nav/footer route graph from one source, preserve the scoped checker as the invariant, and attach desktop/mobile theme screenshots once staging exists.
- [ ] [SIL:2] Verify Ark cargo 01JU1AEATS46E1C7F5DD9AE41C is accepted and the canonical release admission consumes the same complete project-truth fingerprint rather than private/public heuristics.
- [ ] [SIL:3] Once an approved staging origin exists, capture one exact-digest observation bundle spanning parity, delivery, identity, and live-web evidence.
- [ ] [SIL:4] After the first external observation lands, rerun release admission and preserve each remaining gate as an independently attributable receipt.

## Completed (2026-07-28 — Session 88 runtime-truth and decisive-loop arc)

Audit items 96–103 shipped; item 104 is externally blocked on a Studio Ops applied acknowledgement. The innovation ledger is exhausted at 41/41 with no pending unblocked local work.

- [done] Fresh worker-internal quorum now owns production health evidence.
- [done] Pages deploys the exact deterministic artifact validated by release contracts; hosted workflow cron is zero.
- [done] Project-domain contact actions and human-action aging are executable, generated, and parser-converged.
- [done] First Extraction teaches Capture → outcome → Pressure → Breach → decisive delivery; certified evidence records privacy-minimal conversion and timing.
- [done] Removed the tracked generator binary and unused runtime dependency weight; production audit remains zero.
- [done] Generated and shipped three second-order invariants, taking `docs/INNOVATION_PACK.json` to 41/41.
- [done] Direct proof: 184 files / 1,013 tests; TypeScript, lint, format, contracts, production build, Pages, bundle, and production audit green.
- [deferred] Full Playwright was 25/26 after one reload timeout; the exact isolated failed theme test passed. Release remains NO-GO on external evidence.
- [externally-blocked] Registry correction cargo `01JUJNSAUUE4626BC279319392` shipped through Ark; closure awaits applied acknowledgement.

## Completed (2026-07-27 — Session 87 fail-closed authority and player-truth parity arc)

All six items in `docs/AUDIT_2026-07-27.json` shipped and the innovation ledger advanced monotonically to 38/38. No pending unblocked local work remains.

- [done] Made certified tournament persistence truthful, rollback-safe, typed, and advancement-gating.
- [done] Bound archived GameRecord and certificate rosters exactly; rejected duplicate persistent identities and partial/duplicate winner projection.
- [done] Made memory Elo placement/established K-factor semantics match PostgreSQL across the five-match boundary.
- [done] Preserved every source-backed innovation across regeneration, including rank 38.
- [done] Centralized the four-delivery convoy-to-Breach victory copy and aligned player-facing completion semantics.
- [done] Scoped blocking dependency audit to production while retaining non-blocking full-tree advisory visibility and an executable workflow contract.
- [done] Full proof: 181 files / 990 tests; 33.08% lines / 32.71% statements; TypeScript; ESLint; Prettier ratchet; 41/41 mutation policies; 10/10 public ingest; 41 deploy checks; production build; 28,125 balance scenarios; bundle/media/performance budgets; production audit zero; 26/26 Playwright.
- [deferred] Release remains NO-GO on external evidence. The dirty-source observation resolves after commit; approved staging/parity, project-domain delivery, native Obelisk, live-web, human Alpha, revenue, rollback, and founder approval still require observation.

## Completed (2026-07-23 — Session 82 certified-entitlement and balance-authority arc)

All four new live-code findings in `docs/AUDIT_2026-07-23.json` shipped at L3, bringing the cumulative audit to 10/10. Five new evidence-derived second-order candidates shipped, taking `docs/INNOVATION_PACK.json` to 25/25 with zero pending unblocked work.

- [done] Patched protobufjs to the trusted fixed version, lowered the continuous-integration audit threshold to moderate, and pinned version/integrity/threshold evidence.
- [done] Extracted the complete experiment control plane, preserved deterministic bucketing semantics, labeled process-local reset scope, and contracted Worker to 3,108/3,130 lines.
- [done] Rebuilt Season Pass as a certified per-game PostgreSQL event/progress/entitlement ledger with actor-bound routes, restart restoration, honest fallback scope, and visible cosmetic identity.
- [done] Created one versioned convoy balance authority and pure planner; production builds verify 28,125 deterministic scenarios and bind stable source/artifact digests into release lineage.
- [done] Generated and shipped five second-order invariants: visible entitlement projection, experiment reset scope, byte-stable balance evidence, tamper-failing lineage, and fresh-store entitlement proof.
- [done] Full proof: 160 files / 923 tests and production coverage, TypeScript, lint, build, formatting, bundle budgets, 26/26 E2E, 42/42 mutation policies, 10/10 public ingest, zero npm vulnerabilities, audit 10/10, innovations 25/25.

## Completed (2026-07-23 — Session 81 certified-loop and spectator-trust arc)

All six items in `docs/AUDIT_2026-07-23.json` shipped at L3. Three new second-order candidates shipped, taking `docs/INNOVATION_PACK.json` to 20/20 with zero pending unblocked work.

- [done] Public playlist contract enables VaultFront execution across free-for-all, team, special, and ranked paths while preserving private opt-in behavior.
- [done] Certified seasonal contract ledger with PostgreSQL replay safety, bounded server derivation, evidence/durability receipts, and read-only client state.
- [done] Certified privacy-minimal loop evidence from first-transition ticks and server intent funnels; browser-authored telemetry retired.
- [done] Static health-route declarations separated from fresh provenance-bearing HTTP health observations.
- [done] Reachable durable Prediction League with authenticated picks, advisory-lock resolution, private stats, live consensus, and legacy anonymous poll retirement.
- [done] Season, loop, and prediction router seams plus route-policy inventory and a 4,040-line Worker composition ratchet.
- [done] Full proof: 155 files / 904 tests and coverage, TypeScript, lint, build, formatting, bundle budgets, 26/26 E2E, 41 deploy checks, audit 6/6, innovations 20/20.

## Completed (2026-07-22 — Session 79 certified-mastery arc)

All six local items in `docs/AUDIT_2026-07-22.json` shipped at L3; two external corridors remain evidenced and non-actionable locally. Three new second-order candidates shipped, taking `docs/INNOVATION_PACK.json` to 14/14.

- [done] Certified Daily Mastery: authoritative match evidence, exactly-once daily progress, Postgres wallet, typed receipts, authenticated router, and honest local fallback.
- [done] Atomic project-status mutation path with repository bypass scanner and doctor enforcement.
- [done] Typed session-ledger parsing shared across startup, freshness, forecasting, and closeout.
- [done] Production client reachability graph; eleven proven orphans removed and capability source map corrected.
- [done] Deterministic E2E native bootstrap and canonical `/_health` workflow contract.
- [done] Bounded non-duplicated tests plus production-inclusive coverage, Worker visibility, and ten critical floors.
- [done] Full proof: 143 files / 856 tests, TypeScript, lint, build, 26/26 E2E, audit 8/8, innovations 14/14, doctor 10/10 with `blockingFailing: 0`.

## Completed (2026-07-22 — Session 80 durable-evidence arc)

All three new local items in `docs/AUDIT_2026-07-22.json` shipped; the two existing external corridors remain evidenced and non-actionable locally. Three generated second-order candidates shipped, taking `docs/INNOVATION_PACK.json` to 17/17.

- [done] Durable privacy-minimal Alpha evidence: PostgreSQL persistence, actor/session binding, event idempotency, 24-hour summaries, fail-closed configured-database posture, 30-day retention, and honest process-local parity.
- [done] Complete mutation-route policy coverage: 42/42 bidirectional abstract-syntax-tree inventory with auth, rate, evidence, source binding, public-ingest rationale, and an 11-route risk ceiling.
- [done] Dependency automation contract: exact Dependabot identity, ecosystem-specific changed-file allowlists, hostile fixture coverage, and trusted-base validator checkout without retained credentials.
- [done] Full proof: 147 files / 873 tests, production coverage, TypeScript, lint, build, formatting, bundle budgets, 26/26 E2E, 41 deploy checks, audit 11/11, innovations 17/17, doctor 11/11 with `blockingFailing: 0`.

## Completed (2026-07-24 — Session 83 replay-safe progression and pressure-authority arc)

All four premise-verified findings in `docs/AUDIT_2026-07-24.json` shipped at L3. Three generated second-order candidates shipped, taking `docs/INNOVATION_PACK.json` to 28/28 with zero pending unblocked work.

- [done] Certified progression coalesces concurrent calls, releases failed attempts, deduplicates each player/game across memory and PostgreSQL, and emits a verifiable SHA-256 completion receipt.
- [done] Achievement profile reads are actor-bound through an injected, rate-limited router with direct missing/mismatch/valid authorization tests.
- [done] Runtime state-scope truth distinguishes declared store capability from effective scope and blocks contradictory catalog metadata.
- [done] Vault Pressure is a pure typed kernel with threshold, expiry, final-tick, normalization, victory, and sequence coverage; the composition root is ratcheted at 2,917 lines.
- [done] Three second-order invariants shipped: progression receipt verification, state-scope catalog fingerprinting, and release-bound pressure rules sourced from the versioned balance authority.
- [done] Full proof: 165 files / 935 tests and coverage, TypeScript, lint, build, formatting, exact bundles/media, 26/26 E2E, 42/42 mutation policies, 10/10 public ingest, 41 deploy checks, audit 4/4, innovations 28/28.

## Unified Genius List (2026-07-24 — Session 84 /arc)

- [done] 🔥 feedback_loop / security / observability · 7h · `certified-match-feedback-plane` — Turn match ratings into certified, replay-safe feedback evidence.
- [done] 🔥 gamification / analytics / security · 10h · `certified-outcome-style-authority` — Make outcome and career style one certified match projection.
- [done] 🔥 feature_depth / artificial_intelligence / release_truth · 12h · `complete-gameplay-balance-authority` — Complete the executable gameplay-balance authority without changing values.
- [done] ⚡ ux / engagement / reliability · 8h · `postmatch-session-orchestrator` — Make the post-match experience shell-first and session-scoped.

## Completed (2026-07-24 — Session 84 certified feedback and balance-identity arc)

All four premise-verified L3 findings and four generated second-order innovations shipped. `docs/AUDIT_2026-07-24.json` is 8/8, `docs/INNOVATION_PACK.json` is 32/32, and work exhaustion reports zero pending unblocked items.

- [done] Certified match feedback is actor/map/certificate bound, replay-safe in memory and PostgreSQL, 30-day retained, and cohort-safe.
- [done] Outcome, duration, match history, and play style share one server-certified projection; retired browser-authored result/style writes are gone.
- [done] Fifteen gameplay domains share one versioned runtime authority and deterministic 28,125-scenario release envelope.
- [done] Signed replay configuration carries exact balance identity and rejects validly signed but incompatible rulesets.
- [done] Post-match UI is shell-first with bounded parallel hydration, cancellation, stale-result rejection, and exactly-once lifecycle receipts.
- [done] Isolated E2E fixture eliminates false failures from unrelated local services without killing or mutating sibling work.
- [done] Full proof: 173 files / 960 tests and coverage, TypeScript, lint, build, format, exact bundles/media, performance, 26/26 E2E, 41/41 mutation policies, 10/10 public ingest, 41 deploy checks, audit 8/8, innovations 32/32.

### EVIDENCED UPSTREAM DEFERRAL — semantic-release bundled npm 11

- [deferred] Production dependency audit is zero. The remaining all-dependency audit aliases (1 high, 8 moderate) exist only in npm 11 bundled by development-only semantic-release and are outside the explicit release plugin path. Re-evaluate when `@semantic-release/npm` supports a patched npm release compatible with the repository's Node 20 / 24.14 matrix; never apply the registry's semantic-release 15 force-downgrade.

## Completed (2026-07-26 — Session 85 participant-bound continuation and replay-evidence arc)

All three premise-verified L3 findings in `docs/AUDIT_2026-07-25.json` shipped. Four new evidence-derived second-order invariants shipped, taking `docs/INNOVATION_PACK.json` from 32/32 to 36/36 with zero pending unblocked work.

- [done] Extracted a rematch router that requires live or result-certificate-bound source participation before join or private-lobby creation.
- [done] Built one signed, content-addressed replay-share authority for automatic highlights and custom clips, with exact-range bounds, stable URLs, independent verification, and evidence-keyed caching.
- [done] Bound Prediction League writes to a pure real-game open-window admission signal while retaining durable duplicate/resolution race protection.
- [done] Promoted rematch, prediction, and replay-share evidence classes into executable route policy and ratcheted the new router into Worker composition.
- [done] Root-fixed asymmetric safest-route epsilon ordering and replaced stochastic property inputs with deterministic seeded and adversarial coverage.
- [done] Full proof: 176 files / 972 tests, TypeScript, lint, production build, formatting, exact bundles/media, performance, 26/26 E2E, 41/41 mutation policies, 10/10 public ingest, 41 deploy checks, audit 3/3, innovations 36/36, sitemap 10/10, and cost gates green.

### External release evidence boundary

- [deferred] Release remains NO-GO until an explicitly approved staging origin/callback contract exists and exact-digest parity, project-domain delivery, native Obelisk, live headers/Core Web Vitals/themes, three-human Alpha, revenue, rollback, and founder approval are observed. READY credentials and local E2E do not satisfy those gates.

## Unified Genius List (2026-07-26 — Session 86 /arc)

- [done] ✨ second-order security / organization · `unified-certified-game-authority` — One archive/signature/roster/identity kernel now governs dynasty, tournament, and remote-AI consumers.

- [done] 🔥 security / artificial intelligence / token reduction / retention · 8h · `certificate-bound-dynasty-chronicle` — Turn Dynasty Story into a certificate-bound clan chronicle.
- [done] 🔥 security / gamification / feature depth / organization · 12h · `certified-tournament-result-spine` — Make every tournament advancement consume a certified match result.
- [done] 🔥 speed / organization / reliability / observability · 6h · `transaction-decoupled-leaderboard-projection` — Remove table-wide leaderboard work from the certified match transaction.
- [done] ⚡ gamification / retention / security / feedback loop · 7h · `certified-rivalry-revenge-projection` — Make Rival Challenge a signed revenge projection from deterministic simulation.
