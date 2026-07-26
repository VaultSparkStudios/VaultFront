<!-- generated-by: scripts/generate-genius-list.mjs -->
<!-- generated-at: 2026-07-26T08:45:50.901Z -->

# Unified Genius List

Project: vaultfront
IGNIS source: latest-audit-sidecar

## 1. Turn rematch into a certified participant-bound continuation

**Tier:** 🔥 · **Axis:** security / retention / ux / organization · **Effort:** 6h · **Score:** 192

POST /api/rematch/:gameId verifies a play token but immediately joins an existing corridor or clones source configuration without proving that the actor participated in the source match. Knowledge of a game ID is therefore stronger than certified match membership.

Status: done
Recommended model: sonnet

## 2. Make every replay share a content-addressed projection of signed evidence

**Tier:** 🔥 · **Axis:** retention / security / feature depth / observability · **Effort:** 5h · **Score:** 184

ReplayHighlightStore and the custom clip route generate random nanoid identifiers. The same signed replay therefore produces different share URLs after restart, while custom clip ranges are checked only for ordering and can exceed the replay's signed duration.

Status: done
Recommended model: sonnet

## 3. Bind spectator predictions to an executable open-match lifecycle

**Tier:** ⚡ · **Axis:** engagement / security / feedback loop / observability · **Effort:** 4h · **Score:** 172

PredictionLeagueRouter authenticates the spectator but passes any syntactically valid gameId to the durable store. The store rejects duplicates and resolved games, yet it cannot distinguish a real open match from an invented ID or a match whose outcome is already visible but not yet resolved.

Status: done
Recommended model: sonnet
