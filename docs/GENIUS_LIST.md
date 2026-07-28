<!-- generated-by: scripts/generate-genius-list.mjs -->
<!-- generated-at: 2026-07-27T23:48:24.580Z -->

# Unified Genius List

Project: vaultfront
IGNIS source: latest-audit-sidecar

## 1. Turn Dynasty Story into a certificate-bound clan chronicle

**Tier:** 🔥 · **Axis:** security / artificial intelligence / token reduction / retention · **Effort:** 8h · **Score:** 54

POST /api/vaultfront/dynasty-story accepts clanId, clanName, outcomes, and moments from any resolved identity, then appends generated text to that clan. It does not prove clan membership or match participation, consumes no result certificate, and has no client caller. A durable public history can therefore be fabricated or poisoned.

Status: done
Recommended model: sonnet

## 2. Make Rival Challenge a signed revenge projection from deterministic simulation

**Tier:** ⚡ · **Axis:** gamification / retention / security / feedback loop · **Effort:** 7h · **Score:** 49

ControlPanel stores rivalry revenge in localStorage after client-observed activity updates, and WinModal trusts that value to render and instrument the retention challenge. The browser can fabricate, lose, or replay progress independently of the attested match result.

Status: done
Recommended model: sonnet

## 3. Make every tournament advancement consume a certified match result

**Tier:** 🔥 · **Axis:** security / gamification / feature depth / organization · **Effort:** 12h · **Score:** 47

Tournament report accepts creator-entered winnerId. TournamentMatch.gameId is initialized null and never assigned, so bracket advancement, completion, and downstream competitive meaning are not tied to an actual match or its certificate.

Status: done
Recommended model: sonnet

## 4. Remove table-wide leaderboard work from the certified match transaction

**Tier:** 🔥 · **Axis:** speed / organization / reliability / observability · **Effort:** 6h · **Score:** 42

PlayerStatsStore.pgRecordMatch truncates leaderboard_cache and inserts up to 1,000 ranked rows before COMMIT for every certified game. Concurrent matches serialize behind table-wide writes, while a cache failure can roll back otherwise valid progression.

Status: done
Recommended model: sonnet
