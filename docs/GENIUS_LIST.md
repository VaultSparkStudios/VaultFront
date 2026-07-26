<!-- generated-by: scripts/generate-genius-list.mjs -->
<!-- generated-at: 2026-07-25T21:07:02.768Z -->

# Unified Genius List

Project: vaultfront
IGNIS source: latest-audit-sidecar

## 1. Turn certified progression into a replay-safe recoverable fan-out

**Tier:** 🔥 · **Axis:** gamification / retention / security / infrastructure · **Effort:** 8h · **Score:** 192

MatchProgression inserts gameId into processedGameIds before its first asynchronous leg. A thrown leg leaves the ID claimed and every retry returns duplicate, while PlayerStatsStore can increment Elo and match counters again after restart because match_history has no (persistent_id, game_id) uniqueness. The visible progression stack is individually durable but its orchestration is not recoverable.

Status: done
Recommended model: sonnet

## 2. Turn match ratings into certified, replay-safe feedback evidence

**Tier:** 🔥 · **Axis:** feedback loop / security / observability / organization · **Effort:** 7h · **Score:** 190

GET /api/admin/match-ratings returns the full rating/comment corpus without an admin check. POST /api/vaultfront/match-rating authenticates an actor but trusts browser-supplied gameId and mapName, allows unlimited duplicate ratings, and stores only process-local arrays. A caller can pollute map feedback and a public reader can retrieve it.

Status: done
Recommended model: sonnet

## 3. Make outcome and career style one certified match projection

**Tier:** 🔥 · **Axis:** gamification / analytics / security / feedback loop · **Effort:** 10h · **Score:** 188

ExperimentRouter records won, behind-at-minute-eight, duration, and engagement from a browser POST; Worker also accepts browser-authored style-history mutations and exposes arbitrary player style reads. The certified match envelope already contains authoritative result and VaultFront metrics, but these analytics bypass it.

Status: done
Recommended model: sonnet

## 4. Complete the executable gameplay-balance authority

**Tier:** 🔥 · **Axis:** feature depth / artificial intelligence / speed / release truth · **Effort:** 12h · **Score:** 180

config/vaultfront-balance.v1.json owns convoy rewards and pressure, but VaultFrontExecution still embeds dozens of capture, defense, command, comeback, event, intelligence, and economic values. Jam Breaker cost is separately duplicated in VaultFrontExecution, BotExecution, NationExecution, tests, and ControlPanel. Runtime, artificial intelligence, UI, and release evidence can silently disagree.

Status: done
Recommended model: sonnet

## 5. Make persistence readiness derive from executable store capabilities

**Tier:** ⚡ · **Axis:** feedback loop / observability / release truth · **Effort:** 4h · **Score:** 176

StateScopeLedger declares playtest-pulse as process-only and release-critical even though Worker writes authenticated events through PlaytestEvidenceStore, which uses PostgreSQL when configured and labels process-local fallback honestly. Readiness can therefore emit a false volatility warning from stale handwritten metadata.

Status: done
Recommended model: sonnet

## 6. Make the post-match experience shell-first and session-scoped

**Tier:** ⚡ · **Axis:** ux / engagement / reliability / organization · **Effort:** 8h · **Score:** 172

WinModal.show awaits pattern loading and recap assignment before setting isVisible. Optional network latency can leave the decisive post-match moment blank. Multiple unmanaged timeouts, animation frames, and promise callbacks continue after hide/reopen, while Elo animation uses one browser-global lastElo value despite an actor-bound certified history already being returned.

Status: done
Recommended model: sonnet

## 7. Make achievement progression an actor-bound profile contract

**Tier:** 🔥 · **Axis:** security / ux / organization · **Effort:** 5h · **Score:** 168

GET /api/vaultfront/achievements/:persistentId and the meta-chain variant accept any caller-supplied persistent ID and expose progress without a play token. Newer season and contract reads authenticate the actor and reject cross-player claims. Achievement progress is private player progression and should share that boundary.

Status: done
Recommended model: sonnet

## 8. Extract the Vault Pressure climax into a deterministic domain kernel

**Tier:** ⚡ · **Axis:** feature depth / game loop / speed / testability · **Effort:** 6h · **Score:** 160

VaultFrontExecution is roughly 2,900 lines and directly owns the three-delivery breach threshold, 90-second expiry, win trigger, and fallback-to-two behavior inside mutable maps. That flagship climax has no pure transition contract or file-size ratchet, making balance-preserving changes harder to prove than the newer reward planner.

Status: done
Recommended model: sonnet
