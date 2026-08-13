/**
 * NarratorBus — streams AI-generated match commentary to spectators.
 *
 * Architecture:
 * - Subscribes to game activity events batched per game
 * - Calls Claude Haiku every 15s max per game to generate 1-sentence commentary
 * - Broadcasts SSE lines to subscribed HTTP clients (spectators)
 * - Clients connect via GET /api/vaultfront/narrator/:gameId?persona=hype|tactical|comedic
 * - Each spectator can choose their own commentary persona; commentary is per-group
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";
import { BoundedSseTransport, type SseAdmission } from "./BoundedSseTransport";
import type { CertifiedNarrationEvent } from "./CertifiedNarrationProjection";
import { logger as Logger } from "./Logger";
import {
  canAttemptRemoteAi,
  executeReservedRemoteAiCall,
  reserveRemoteAiCall,
} from "./RemoteAiPolicy";

let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  anthropic ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    dangerouslyAllowBrowser: process.env.NODE_ENV === "test",
  });
  return anthropic;
}

export type NarratorPersona = "hype" | "tactical" | "comedic";

const PERSONA_PROMPTS: Record<NarratorPersona, string> = {
  hype: "You are a hype live sports commentator for VaultFront, a real-time strategy game. Generate ONE sentence of exciting broadcast commentary (max 100 characters). Tone: energetic, present-tense, exclamation-heavy, crowd-pumping. No emojis, no quotes.",
  tactical:
    "You are a tactical analyst commentating VaultFront, a real-time strategy game. Generate ONE sentence of incisive strategic commentary (max 100 characters). Tone: precise, observational, focused on decision-making and implications. No emojis, no quotes.",
  comedic:
    "You are a comedic color commentator for VaultFront, a real-time strategy game. Generate ONE sentence of witty commentary (max 100 characters). Tone: dry, playful, finds the absurd angle in every event. No emojis, no quotes.",
};

const RATE_LIMIT_MS = 15_000; // 15s minimum between calls per game
const MAX_PENDING_EVENTS = 12;
const MAX_COMMENTARY_CHARS = 140;
export const NARRATOR_SSE_POLICY = {
  maxSubscribersPerGame: 48,
  maxSubscribersPerWorker: 384,
  maxSubscribersPerIp: 8,
  maxQueuedEventsPerClient: 16,
  maxQueuedBytesPerClient: 32 * 1024,
  drainTimeoutMs: 5_000,
} as const;

function computeBlendMode(
  ctx: NarratorContextSnapshot,
): "tactical" | "mixed" | "hype" {
  if (ctx.tickBucket === "late") return "hype";
  if (ctx.tickBucket === "mid") return "mixed";
  return "tactical";
}

function blendedPersonaPrompt(
  persona: NarratorPersona,
  blendMode: "tactical" | "mixed" | "hype" | undefined,
): string {
  const base = PERSONA_PROMPTS[persona];
  if (!blendMode || blendMode === "tactical") return base;
  if (blendMode === "hype") {
    // Endgame: intensify all personas toward hype energy
    return `${base} The match is in its final decisive phase — amplify the drama and urgency in your commentary.`;
  }
  // Mixed: mid-game, add situational awareness note
  return `${base} The match is at a critical midpoint — balance analysis with rising tension.`;
}

interface GameNarratorState {
  clients: Map<Response, NarratorPersona>;
  lastCallMs: number;
  lastCommentaryByPersona: Map<NarratorPersona, string>;
  pendingEvents: string[];
  timer: ReturnType<typeof setTimeout> | null;
  /** NarratorContextSnapshot — injected by Worker.ts for contextual commentary */
  context: NarratorContextSnapshot | null;
  lastCertifiedLabel: string | null;
}

export interface NarratorContextSnapshot {
  tickBucket: "early" | "mid" | "late";
  leadingPlayer: string;
  siteBalance: string;
  mutator: string;
  /** Auto-blend mode derived from match phase + score differential */
  blendMode?: "tactical" | "mixed" | "hype";
}

export class NarratorBus {
  private games = new Map<string, GameNarratorState>();
  private readonly transport = new BoundedSseTransport(NARRATOR_SSE_POLICY);

  private getOrCreate(gameId: string): GameNarratorState {
    if (!this.games.has(gameId)) {
      this.games.set(gameId, {
        clients: new Map(),
        lastCallMs: 0,
        lastCommentaryByPersona: new Map(),
        pendingEvents: [],
        timer: null,
        context: null,
        lastCertifiedLabel: null,
      });
    }
    return this.games.get(gameId)!;
  }

  admit(gameId: string, clientKey: string): SseAdmission {
    return this.transport.admit(gameId, clientKey);
  }

  subscribe(
    gameId: string,
    res: Response,
    clientKey: string,
    persona: NarratorPersona = "hype",
  ): SseAdmission {
    const state = this.getOrCreate(gameId);
    const admission = this.transport.subscribe(gameId, clientKey, res, () => {
      state.clients.delete(res);
      if (state.clients.size === 0) this.cleanup(gameId);
    });
    if (!admission.accepted) {
      if (state.clients.size === 0) this.cleanup(gameId);
      return admission;
    }
    state.clients.set(res, persona);

    this.transport.write(
      res,
      `data: ${JSON.stringify({ type: "connected", persona })}\n\n`,
    );
    const lastCommentary = state.lastCommentaryByPersona.get(persona);
    if (lastCommentary) {
      this.transport.write(
        res,
        `data: ${JSON.stringify({ type: "commentary", text: lastCommentary, persona, replay: true })}\n\n`,
      );
    }
    Logger.info(`NarratorBus: client subscribed to ${gameId}`, {
      count: state.clients.size,
      persona,
    });
    return admission;
  }

  /** Queue a privacy-minimal event projected from an accepted game intent. */
  queueCertifiedEvent(
    gameId: string,
    event: CertifiedNarrationEvent,
    context?: NarratorContextSnapshot,
  ): void {
    const state = this.games.get(gameId);
    if (!state || state.clients.size === 0) return;
    if (state.lastCertifiedLabel === event.label) return;
    state.lastCertifiedLabel = event.label;
    this.broadcastRaw(gameId, {
      type: "commentary",
      text: event.label,
      persona: "certified",
      authority: event.authority,
      baseline: true,
    });

    // The certified deterministic line is the product baseline. Remote AI is
    // an optional enrichment and never controls whether narration exists.
    if (!canAttemptRemoteAi()) return;

    if (context) {
      // Auto-compute blendMode from match phase + site balance
      const blendMode = computeBlendMode(context);
      state.context = { ...context, blendMode };
    }

    state.pendingEvents.push(event.label);
    if (state.pendingEvents.length > MAX_PENDING_EVENTS) {
      state.pendingEvents.splice(
        0,
        state.pendingEvents.length - MAX_PENDING_EVENTS,
      );
    }

    if (state.timer) return; // already scheduled
    const delay = Math.max(0, RATE_LIMIT_MS - (Date.now() - state.lastCallMs));
    state.timer = setTimeout(() => void this.flush(gameId), delay);
    state.timer.unref?.();
  }

  private async flush(gameId: string): Promise<void> {
    const state = this.games.get(gameId);
    if (!state) return;
    state.timer = null;

    const events = [...new Set(state.pendingEvents.splice(0, 3))];
    if (events.length === 0) return;
    state.lastCallMs = Date.now();

    // Determine which personas have active subscribers
    const activePersonas = new Set(state.clients.values());
    if (activePersonas.size === 0) return;

    // Build context suffix for the user message
    const ctx = state.context;
    const contextSuffix = ctx
      ? ` [Phase: ${ctx.tickBucket}; Leader: ${ctx.leadingPlayer}; Sites: ${ctx.siteBalance}; Mutator: ${ctx.mutator}]`
      : "";
    const userContent = `Events: ${events.join("; ")}${contextSuffix}`;

    await Promise.allSettled(
      [...activePersonas].map((persona) =>
        this.flushForPersona(gameId, state, persona, userContent),
      ),
    );
  }

  private async flushForPersona(
    gameId: string,
    state: GameNarratorState,
    persona: NarratorPersona,
    userContent: string,
  ): Promise<void> {
    const reservation = await reserveRemoteAiCall("narrator");
    if (!reservation.allowed) {
      Logger.info("NarratorBus: remote AI cost firewall denied generation", {
        gameId,
        persona,
        reason: reservation.posture.reason,
      });
      return;
    }
    try {
      const systemPrompt = blendedPersonaPrompt(
        persona,
        state.context?.blendMode,
      );
      const msg = await executeReservedRemoteAiCall(
        (signal) =>
          getAnthropicClient().messages.create(
            {
              model: "claude-haiku-4-5-20251001",
              max_tokens: 60,
              system: [
                {
                  type: "text",
                  text: systemPrompt,
                  cache_control: { type: "ephemeral" },
                },
              ],
              messages: [{ role: "user", content: userContent }],
            },
            { signal },
          ),
        8_000,
      );
      const commentary =
        (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
      if (commentary) {
        const safeCommentary = commentary
          .replace(/\s+/g, " ")
          .slice(0, MAX_COMMENTARY_CHARS);
        state.lastCommentaryByPersona.set(persona, safeCommentary);
        this.broadcastToPersona(gameId, state, persona, {
          type: "commentary",
          text: safeCommentary,
          persona,
        });
      }
    } catch (err) {
      Logger.warn("NarratorBus: generation failed", { gameId, persona, err });
    }
  }

  private broadcastToPersona(
    gameId: string,
    state: GameNarratorState,
    persona: NarratorPersona,
    payload: object,
  ): void {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const [res, clientPersona] of state.clients) {
      if (clientPersona !== persona) continue;
      this.transport.write(res, line);
    }
  }

  /** Broadcast a raw payload to ALL subscribers for a game (any persona). */
  broadcastRaw(gameId: string, payload: object): void {
    const state = this.games.get(gameId);
    if (!state) return;
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const [res] of state.clients) {
      this.transport.write(res, line);
    }
  }

  closeGame(gameId: string): void {
    const state = this.games.get(gameId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    const end = `data: ${JSON.stringify({ type: "game_over" })}\n\n`;
    for (const [res] of state.clients) this.transport.write(res, end);
    this.transport.closeGame(gameId);
    this.games.delete(gameId);
  }

  private cleanup(gameId: string): void {
    const state = this.games.get(gameId);
    if (state?.timer) clearTimeout(state.timer);
    this.games.delete(gameId);
  }

  debugState(gameId: string): {
    subscribers: number;
    pendingEvents: number;
    hasLastCommentary: boolean;
  } {
    const state = this.games.get(gameId);
    return {
      subscribers: state?.clients.size ?? 0,
      pendingEvents: state?.pendingEvents.length ?? 0,
      hasLastCommentary: state?.lastCommentaryByPersona.size !== 0,
    };
  }

  integritySnapshot() {
    return this.transport.snapshot();
  }
}

export const narratorBus = new NarratorBus();
