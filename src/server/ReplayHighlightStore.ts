/**
 * ReplayHighlightStore — identifies the peak 30-second window of a recorded
 * game and produces a shareable highlight URL.
 *
 * Scoring heuristic per turn:
 *   - Turns with many intents → high activity window
 *   - Intent types weighted by excitement:
 *       execution_chain > surge > vault_capture > convoy_deliver > generic
 *
 * The clip window is centred on the highest-scoring turn within a 30s window
 * (assuming 2 turns/s, that's ~60 turns).
 *
 * Storage: in-memory map keyed by gameId. Highlights are computed once and
 * cached for the lifetime of the process. Stale entries are evicted after 2 h.
 */

import { createReplayShareProjection } from "./ReplayShareContract";
import type { ReplayManifest, ReplayTurn } from "./ReplayStore";

const CLIP_TURNS = 60; // ~30 s at 2 turns/s
const CACHE_TTL_MS = 2 * 60 * 60 * 1_000;
const PLAY_BASE =
  process.env.PLAY_BASE_URL ?? "https://play-vaultfront.vaultsparkstudios.com";

export interface ReplayHighlight {
  gameId: string;
  highlightId: string;
  topMoment: string;
  clipStartTurn: number;
  clipEndTurn: number;
  /** Tick number of the most exciting 30s window — for "Best Moment" seek. */
  autoHighlightTick: number;
  shareUrl: string;
  ogTitle: string;
}

interface CachedHighlight {
  highlight: ReplayHighlight;
  cachedAt: number;
}

/** Intent-type excitement weights used in turn scoring */
const INTENT_WEIGHTS: Record<string, number> = {
  intercept: 10,
  execution_chain: 10,
  last_stand: 8,
  surge: 8,
  heist: 7,
  vault_capture: 6,
  bounty_collected: 5,
  surge_entry: 4,
  convoy_deliver: 4,
  beacon_charge: 3,
};

function scoreTurn(turn: ReplayTurn): number {
  let score = turn.intents.length; // base: activity volume
  for (const intent of turn.intents) {
    const type = (intent as { type?: string }).type ?? "";
    score += INTENT_WEIGHTS[type] ?? 1;
  }
  return score;
}

function identifyMoment(turns: ReplayTurn[], peakIdx: number): string {
  const window = turns.slice(
    Math.max(0, peakIdx - 5),
    Math.min(turns.length, peakIdx + 6),
  );
  let bestType = "generic";
  let bestWeight = 0;
  for (const turn of window) {
    for (const intent of turn.intents) {
      const type = (intent as { type?: string }).type ?? "";
      const w = INTENT_WEIGHTS[type] ?? 0;
      if (w > bestWeight) {
        bestWeight = w;
        bestType = type;
      }
    }
  }
  const labels: Record<string, string> = {
    execution_chain: "Execution Chain Combo",
    surge: "Surge Activated",
    vault_capture: "Vault Captured",
    convoy_deliver: "Convoy Delivered",
    beacon_charge: "Beacon Charged",
    generic: "Peak Action",
  };
  return labels[bestType] ?? "Peak Action";
}

export class ReplayHighlightStore {
  private cache = new Map<string, CachedHighlight>();

  constructor() {
    const timer = setInterval(() => this.evict(), 10 * 60_000);
    timer.unref?.();
  }

  getOrCreate(gameId: string, manifest: ReplayManifest): ReplayHighlight {
    const cacheKey = `${gameId}:${manifest.signature ?? "unsigned"}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.highlight;
    }

    const highlight = this.compute(manifest);
    this.cache.set(cacheKey, { highlight, cachedAt: Date.now() });
    return highlight;
  }

  private compute(manifest: ReplayManifest): ReplayHighlight {
    const { gameId, mapName } = manifest;
    const turns = manifest.turns ?? [];
    if (turns.length === 0) {
      return this.fallback(manifest);
    }

    // Sliding-window sum over CLIP_TURNS turns
    const scores = turns.map(scoreTurn);
    let windowSum = scores.slice(0, CLIP_TURNS).reduce((a, b) => a + b, 0);
    let bestWindowStart = 0;
    let bestWindowSum = windowSum;

    for (let i = CLIP_TURNS; i < turns.length; i++) {
      windowSum += scores[i] - scores[i - CLIP_TURNS];
      if (windowSum > bestWindowSum) {
        bestWindowSum = windowSum;
        bestWindowStart = i - CLIP_TURNS + 1;
      }
    }

    const clipStartTurn = turns[bestWindowStart]?.turnNumber ?? 0;
    const clipEndIdx = Math.min(
      bestWindowStart + CLIP_TURNS - 1,
      turns.length - 1,
    );
    const clipEndTurn =
      turns[clipEndIdx]?.turnNumber ?? clipStartTurn + CLIP_TURNS;

    // Find peak turn within the window for moment identification
    const peakIdx =
      bestWindowStart +
      scores
        .slice(bestWindowStart, bestWindowStart + CLIP_TURNS)
        .reduce((bestI, s, i, arr) => (s > arr[bestI] ? i : bestI), 0);

    const topMoment = identifyMoment(turns, peakIdx);
    const share = createReplayShareProjection(
      manifest,
      {
        kind: "highlight",
        startTurn: clipStartTurn,
        endTurn: clipEndTurn,
      },
      PLAY_BASE,
    );

    return {
      gameId,
      highlightId: share.shareId,
      topMoment,
      clipStartTurn,
      clipEndTurn,
      autoHighlightTick: clipStartTurn,
      shareUrl: share.shareUrl,
      ogTitle: `VaultFront Highlight — ${topMoment} on ${mapName || "Unknown Map"}`,
    };
  }

  private fallback(manifest: ReplayManifest): ReplayHighlight {
    const { gameId, mapName } = manifest;
    const share = createReplayShareProjection(
      manifest,
      { kind: "highlight", startTurn: 0, endTurn: 0 },
      PLAY_BASE,
    );
    return {
      gameId,
      highlightId: share.shareId,
      topMoment: "Full Match",
      clipStartTurn: 0,
      clipEndTurn: 0,
      autoHighlightTick: 0,
      shareUrl: share.shareUrl,
      ogTitle: `VaultFront Replay — ${mapName || "Unknown Map"}`,
    };
  }

  private evict(): void {
    const now = Date.now();
    for (const [gameId, cached] of this.cache) {
      if (now - cached.cachedAt > CACHE_TTL_MS) this.cache.delete(gameId);
    }
  }
}

export const replayHighlightStore = new ReplayHighlightStore();
