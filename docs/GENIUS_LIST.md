<!-- generated-by: scripts/generate-genius-list.mjs -->
<!-- generated-at: 2026-08-05T21:56:39.840Z -->

# Unified Genius List

Project: vaultfront
IGNIS source: latest-audit-sidecar

## 1. Make leaving a match end every match-owned execution surface

**Tier:** 🔥 · **Axis:** speed / organization / reliability / game loop · **Effort:** 6h · **Score:** 342

joinLobby drops currentGameRunner without calling stop. ClientGameRunner.stop omits renderer, input, touch, and EventBus teardown; GameRenderer owns an unbounded requestAnimationFrame loop and anonymous resize/context handlers; InputHandler owns a 1ms interval plus anonymous global listeners. A rematch can therefore retain workers, renders, keys, timers, and callbacks from prior play.

Status: done
Recommended model: sonnet

## 2. Turn two ratings into privacy-minimal causal playtest evidence

**Tier:** 🔥 · **Axis:** feedback loop / UX / feature depth / analytics · **Effort:** 5h · **Score:** 316

The certified feedback surface records only match and map scores. MatchFeedbackStore already retains an optional comment field, but the UI never sends it and summaries never expose it, so a low score cannot distinguish pacing, clarity, agency, comeback, map-flow, or technical friction.

Status: done
Recommended model: sonnet

## 3. Replace fabricated surveillance theater with a truthful local tab-collision receipt

**Tier:** 🔥 · **Axis:** security / UX / observability / soul fidelity · **Effort:** 3h · **Score:** 300

MultiTabModal generates a fake IP and fake fingerprint, labels the state RECORDING and Reported TRUE, and threatens suspension although MultiTabDetector only observes a same-origin localStorage lock. stopMonitoring removes different bound function objects, so its listeners survive teardown; repeated show calls can also stack countdown intervals.

Status: done
Recommended model: sonnet

## 4. Retire the unauthenticated browser-authored remote micro-coach path

**Tier:** 🔥 · **Axis:** AI / security / capital / token-API reduction · **Effort:** 4h · **Score:** 284

CoachHintEngine already renders an immediate deterministic local tactical hint, but an opt-in calls GET /api/vaultfront/micro-hint with browser-authored gold/sites. The provider route has no actor admission, no certified match evidence, no server cache, and is absent from the remote-reservation ordering contract, while every accepted call consumes metered provider capacity.

Status: done
Recommended model: sonnet

## 5. Make progression debrief repeatable and generation-safe across rematches

**Tier:** 🔥 · **Axis:** retention / reliability / UX / gamification · **Effort:** 4h · **Score:** 278

ProgressionDebrief is a singleton Layer whose requested flag never resets when createRenderer binds a new game. Its polling checks cancelled only before fetch, clears a wait timer without resolving the pending promise, and can apply a prior games receipt after a new match begins. The first post-match debrief can therefore suppress or overwrite later rematch progression.

Status: done
Recommended model: sonnet

## 6. Carry the active non-power Doctrine through debrief and the next rematch goal

**Tier:** ⚡ · **Axis:** gamification / retention / feature depth / soul fidelity · **Effort:** 4h · **Score:** 264

The Doctrine Vault persists a server-owned active coaching identity, but only GameRightSidebar renders it. ProgressionDebrief chooses a generic Convoy Mastery goal without loading the active Doctrine, and the rematch event carries only generic text/evidence, so the paid non-power choice disappears at the exact progression-to-next-input seam.

Status: done
Recommended model: sonnet

## 7. Make live narration inherit server-certified match authority

**Tier:** 🔥 · **Axis:** security / feedback loop / AI / observability · **Effort:** 5h · **Score:** 192

NarratorReporter lets any browser POST an arbitrary activity and label for any gameId into NarratorBus. The server validates shape and IP rate only; it does not verify actor membership, live game ownership, or that the event occurred. GameServer imports NarratorBus only to close it, so AI commentary can be driven by browser-authored fiction.

Status: done
Recommended model: sonnet

## 8. Make first contact begin inside the match fantasy and recover transfer headroom

**Tier:** 🔥 · **Axis:** UX / gamification / performance / feedback loop · **Effort:** 5h · **Score:** 188

Main.ts statically imports and mounts VaultFrontTutorial during lobby bootstrap. Its 800ms timer opens instructions for an in-match tracker that does not exist yet, and dismissing it permanently consumes the versioned seen state. The lobby hero simultaneously exposes internal visual-pass/changelog language. The same eager surface contributes to a current-main CI failure: initial Brotli entry is 594,207 bytes against a 592,619-byte ceiling.

Status: done
Recommended model: sonnet

## 9. Remove the orphaned Studio Ops secret broker from the public repo

**Tier:** 🔥 · **Axis:** security / coherence / public boundary · **Effort:** 1h · **Score:** 182

scripts/lib/obelisk-broker.mjs is tracked, unused, and copied from Studio Ops. It references private portfolio policy, receipt paths, grant issuer keys, and operator trust semantics that do not belong in this public deployable repository; the canonical filename sanitizer does not currently recognize this code-level boundary leak.

Status: done
Recommended model: sonnet

## 10. Replace blocking account-recovery alerts with bounded accessible state

**Tier:** ⚡ · **Axis:** UX / accessibility / security / conversion · **Effort:** 3h · **Score:** 182

AccountModal magic-link recovery uses three window.alert calls, has no pending guard, and leaves the button active during the request. Keyboard and screen-reader users lose modal context, rapid activation can duplicate requests, and success/error truth is detached from the themed account surface.

Status: done
Recommended model: sonnet

## 11. Give First Extraction a server-derived personal agency ledger

**Tier:** 🔥 · **Axis:** game loop / observability / UX / correctness · **Effort:** 5h · **Score:** 180

Vault Pressure is player-or-team scoped and already projects contributors by actor, but ControlPanel passes the shared pressure state into advanceFirstExtractionProgress. That projector promotes pressureStarted into vaultCaptured and convoyAction and promotes team victory into decisiveDelivery, so a teammate can complete the learner's personal capture, convoy, and winning-delivery steps.

Status: done
Recommended model: sonnet

## 12. Make required Studio skills executable from the project root

**Tier:** 🔥 · **Axis:** speed / organization / token reduction · **Effort:** 2h · **Score:** 168

Both studio-start and audit required project-local skill-profile and sample-codebase commands, but each failed with MODULE_NOT_FOUND in the fresh Session 95 preflight even though the canonical implementations exist in Studio Ops. The missing bridge forces manual fallbacks and silently drops medium-specific success bars.

Status: done
Recommended model: sonnet

## 13. Preserve secret blocking while eliminating asset entropy noise

**Tier:** 🔥 · **Axis:** security / speed / observability · **Effort:** 3h · **Score:** 166

The canonical full-tree scan emits 1,974 findings, all low-confidence matches inside existing base64 SVG, flag, cosmetic, and copied static assets, with zero medium/high findings. A signal this noisy is unusable for sanitization review and can hide the one real credential that matters.

Status: done
Recommended model: sonnet

## 14. Give every runtime feature authority a reachable consumer or retire it

**Tier:** 🔥 · **Axis:** security / speed / organization / token reduction · **Effort:** 6h · **Score:** 164

Worker exposes multiple feature surfaces with no client, agent, or operator consumer: match-mission, match-commentary, bot-lore, match-coach, clan-war, and parallel Intel market routes. The Intel routes accept caller identities, keep unbounded game maps, return random fallback risk, advertise a 2,000-gold cost, and never mutate the certified economy. Unused Api helpers also preserve phantom battle-narrative and bot-persona authority.

Status: done
Recommended model: sonnet

## 15. Turn certified Mastery into a player-chosen non-power Doctrine Vault

**Tier:** 🔥 · **Axis:** feature depth / retention / gamification / security · **Effort:** 7h · **Score:** 164

Certified Daily Mastery awards durable currency and the live sidebar displays only '<balance> M total'. There is no catalog, entitlement threshold, selection, spend path, or downstream consumer, so the retention hook accumulates obligation without aspiration. The wallet already has transactional PostgreSQL and process-local parity, making a bounded non-power choice layer feasible without retuning gameplay.

Status: done
Recommended model: sonnet

## 16. Bound remote identity introspection during game admission

**Tier:** 🔥 · **Axis:** security / reliability / coverage · **Effort:** 3h · **Score:** 162

getUserMe directly awaits the issuer users/@me fetch with no deadline, abort signal, or focused test coverage. A slow or wedged identity provider can hold WebSocket admission indefinitely even though every subsequent authorization branch waits on this result.

Status: done
Recommended model: sonnet

## 17. Make doctor sidecar closeout byte-idempotent

**Tier:** ⚡ · **Axis:** speed / organization / observability · **Effort:** 2h · **Score:** 144

project-doctor writes audits/doctor-latest.json with JSON.stringify formatting, while closeout-autopilot formats only STARTUP_BRIEF and PROJECT_STATUS before staging. The pre-commit hook then rewrites the sidecar, so every closeout starts with avoidable byte churn and the closeout runner violates the Session 92 decision that it formats every generated truth surface itself.

Status: done
Recommended model: sonnet

## 18. Make pre-match intelligence bounded, abortable, and stale-session-proof

**Tier:** 🔥 · **Axis:** UX / AI / reliability / accessibility · **Effort:** 4h · **Score:** 144

GameStartingModal launches three provider-backed requests with Promise.all and owns neither an AbortController nor a session generation. hide() leaves requests and two timeouts alive; an earlier match can overwrite a later modal, and the fixed 300px surface can overflow when all three cards arrive on mobile. There is no focused lifecycle test.

Status: done
Recommended model: sonnet

## 19. Turn transport recovery evidence into calm player-visible state

**Tier:** 🔥 · **Axis:** UX / reliability / feedback loop / accessibility · **Effort:** 4h · **Score:** 144

Transport now emits exact connection state, retry attempt, outbox depth, and overflow events, but only tests consume them. Players see no waiting/recovering/synchronized feedback, queued actions are invisible, and protocol refusal still uses blocking alert(), bypassing the app's accessible modal and theme system.

Status: done
Recommended model: sonnet

## 20. Make the startup hit list distinguish actionable work from shipped history

**Tier:** ⚡ · **Axis:** observability / organization / token reduction · **Effort:** 2h · **Score:** 132

generate-genius-list maps shipped audit items to done, but renderBrief prints the first entries regardless of status. The S94 startup brief therefore announces Unblocked 0 while presenting five checked completed items under GENIUS HIT LIST, and /start surfaces a completed item as the top action.

Status: done
Recommended model: sonnet

## 21. Separate compact project health from full doctor evidence

**Tier:** ⚡ · **Axis:** observability / speed / token reduction / organization · **Effort:** 3h · **Score:** 124

PROJECT_STATUS.json embeds all thirteen doctor checks including duplicated child-process commands, stdout payloads, timestamps, and parsed data. Every startup/status consumer pays for the full transcript even though normal rendering uses only aggregate counts; warning ownership is the only path that needs check detail.

Status: done
Recommended model: sonnet

## 22. Generate static and in-app public navigation from one route graph

**Tier:** ⚡ · **Axis:** UX / organization / release / accessibility · **Effort:** 3h · **Score:** 110

public/footer-manifest.json generates and validates ten static pages, but the Lit application footer repeats routes, copyright, brand, and attribution by hand. It omits the required Play destination and adds Wiki/Source links outside the checked graph, so the green footer gate does not cover the actual app footer.

Status: done
Recommended model: sonnet

## 23. Give static assets one Vite ownership path

**Tier:** ⚡ · **Axis:** speed / organization / developer experience · **Effort:** 4h · **Score:** 98

The production and browser-proof builds emit thousands of warnings because resources is simultaneously Vite publicDir and an import source. The config comment claims public assets may be imported, but Vite explicitly rejects that ownership model; real warnings are buried under repeated path guidance.

Status: done
Recommended model: sonnet
