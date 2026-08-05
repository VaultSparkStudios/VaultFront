import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  BountyBoardActivatedUpdate,
  GameUpdateType,
  LastStandActivatedUpdate,
  VaultFrontActivityUpdate,
  VaultFrontStatusUpdate,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import type { Layer } from "./Layer";
import { uiStateManager } from "./UIStateManager";

const HINT_TRIGGER_TICKS = 1200; // 2 min before first idle hint
const HINT_MIN_INTERVAL_TICKS = 1800; // 3 min between any hints
const ECONOMY_STALL_GOLD_THRESHOLD = 150_000;

// Per-trigger cooldowns (in ticks) — shorter because these are contextual
const TRIGGER_COOLDOWNS: Record<HintTrigger, number> = {
  idle: HINT_MIN_INTERVAL_TICKS,
  convoy_lost: 1800, // 3 min
  bounty_placed: 900, // 90s
  last_stand_nearby: 600, // 60s
  chain_broken: 900, // 90s
  convoy_danger: 1200, // 2 min — high intercept probability alert
  economy_stall: 2400, // 4 min — low gold + no convoys in flight
};

export type HintTrigger =
  | "idle"
  | "convoy_lost"
  | "bounty_placed"
  | "last_stand_nearby"
  | "chain_broken"
  | "convoy_danger"
  | "economy_stall";

export interface TacticalHintContext {
  gold: number;
  sites: number;
}

export function localTacticalHint(
  trigger: HintTrigger,
  context: TacticalHintContext,
): string {
  const siteRead =
    context.sites > 0
      ? `You hold ${context.sites} vault${context.sites === 1 ? "" : "s"}.`
      : "You do not hold a vault yet.";
  switch (trigger) {
    case "convoy_lost":
      return "Your route was read. Reroute Safest before launch, then Shield Nearest as the convoy enters contested tiles.";
    case "bounty_placed":
      return "A bounty makes direct lanes predictable. Use a safer reroute and keep Jam Breaker for the first coordinated interception.";
    case "last_stand_nearby":
      return "Last Stand is active. Deny the nearest controlled vault before committing to the convoy lane.";
    case "chain_broken":
      return "The execution chain reset. Recapture one open vault, then protect its delivery instead of splitting pressure.";
    case "convoy_danger":
      return "High interception risk: Shield Nearest now, then Reroute Safest only if the lane remains hostile.";
    case "economy_stall":
      return `${siteRead} Contest the nearest opening and preserve gold for one decisive escort or jam response.`;
    case "idle":
      return `${siteRead} Capture the nearest vault, set a safe convoy lane, and react only when its risk changes.`;
  }
}

@customElement("coach-hint-engine")
export class CoachHintEngine extends LitElement implements Layer {
  public game: GameView;

  @state() private hint: string | null = null;
  @state() private visible = false;

  private tickCount = 0;
  private hasIssuedVaultCommand = false;
  private latestStatus: VaultFrontStatusUpdate | null = null;
  private hintDismissTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last tick each trigger fired — avoids per-trigger cooldown collisions */
  private lastHintTickByTrigger = new Map<HintTrigger, number>();
  /** 5-min LRU hint cache keyed on {trigger}_{gold_bucket}_{sites} */
  private hintCache = new Map<string, { hint: string; expiresAt: number }>();
  private readonly HINT_CACHE_TTL_MS = 5 * 60 * 1000;

  createRenderRoot() {
    return this;
  }

  tick(): void {
    if (!this.game) return;
    this.tickCount++;

    if (localStorage.getItem("coachHintsDisabled") === "true") return;

    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    // Track latest vault-site state
    const statusUpdates = updates[GameUpdateType.VaultFrontStatus] as
      VaultFrontStatusUpdate[] | undefined;
    if (statusUpdates && statusUpdates.length > 0) {
      this.latestStatus = statusUpdates[statusUpdates.length - 1];
    }

    // Track whether player has issued vault commands (idle hint guard)
    const activityUpdates = updates[
      GameUpdateType.VaultFrontActivity
    ] as VaultFrontActivityUpdate[];
    if (
      activityUpdates?.some((a) =>
        [
          "convoy_launched",
          "convoy_rerouted",
          "convoy_escorted",
          "jam_breaker",
          "ghost_reveal",
        ].includes(a.activity),
      )
    ) {
      this.hasIssuedVaultCommand = true;
    }

    // Evaluate event triggers (ordered by priority)
    const trigger = this.detectTrigger(updates);
    if (trigger) this.showTacticalHint(trigger);
  }

  private detectTrigger(
    updates: ReturnType<GameView["updatesSinceLastTick"]>,
  ): HintTrigger | null {
    const mySmallId = this.game.myPlayer()?.smallID();

    // convoy_lost: one of my convoys was intercepted
    const activities = updates?.[GameUpdateType.VaultFrontActivity] as
      VaultFrontActivityUpdate[] | undefined;
    if (
      mySmallId !== undefined &&
      activities?.some(
        (a) =>
          a.activity === "convoy_intercepted" && a.targetPlayerID === mySmallId,
      ) &&
      this.canTrigger("convoy_lost")
    ) {
      return "convoy_lost";
    }

    // bounty_placed: a bounty was placed on me
    const bountyUpdates = updates?.[GameUpdateType.BountyBoardActivated] as
      BountyBoardActivatedUpdate[] | undefined;
    if (
      mySmallId !== undefined &&
      bountyUpdates?.some((b) => b.targetPlayerID === mySmallId) &&
      this.canTrigger("bounty_placed")
    ) {
      return "bounty_placed";
    }

    // last_stand_nearby: last-stand activated near my sites
    const lastStandUpdates = updates?.[GameUpdateType.LastStandActivated] as
      LastStandActivatedUpdate[] | undefined;
    if (
      lastStandUpdates &&
      lastStandUpdates.length > 0 &&
      this.canTrigger("last_stand_nearby")
    ) {
      return "last_stand_nearby";
    }

    // chain_broken: comeback_surge ending can indicate chain pressure reset
    if (
      activities?.some((a) => a.activity === "comeback_surge") &&
      this.canTrigger("chain_broken")
    ) {
      return "chain_broken";
    }

    // convoy_danger: any of my convoys has intercept probability > 70%
    if (mySmallId !== undefined && this.latestStatus) {
      const hasDangerConvoy = this.latestStatus.convoys.some(
        (c) => c.ownerID === mySmallId && (c.interceptProbability ?? 0) > 70,
      );
      if (hasDangerConvoy && this.canTrigger("convoy_danger")) {
        return "convoy_danger";
      }
    }

    // economy_stall: low gold, no active convoys, past hint threshold
    if (
      mySmallId !== undefined &&
      this.latestStatus &&
      this.tickCount >= HINT_TRIGGER_TICKS
    ) {
      const gold = Number(uiStateManager.get().playerGold ?? 0);
      const hasActiveConvoy = this.latestStatus.convoys.some(
        (c) => c.ownerID === mySmallId,
      );
      if (
        gold < ECONOMY_STALL_GOLD_THRESHOLD &&
        !hasActiveConvoy &&
        this.canTrigger("economy_stall")
      ) {
        return "economy_stall";
      }
    }

    // idle: 2 min elapsed, player hasn't issued a vault command
    if (
      this.tickCount >= HINT_TRIGGER_TICKS &&
      !this.hasIssuedVaultCommand &&
      this.canTrigger("idle")
    ) {
      return "idle";
    }

    return null;
  }

  private canTrigger(trigger: HintTrigger): boolean {
    const lastTick = this.lastHintTickByTrigger.get(trigger) ?? -Infinity;
    return this.tickCount - lastTick >= TRIGGER_COOLDOWNS[trigger];
  }

  private localVaultSiteCount(): number {
    const myPlayerId = this.game.myPlayer()?.smallID();
    if (myPlayerId === undefined || !this.latestStatus) return 0;
    return this.latestStatus.sites.filter(
      (site) =>
        site.controllerID === myPlayerId || site.passiveOwnerID === myPlayerId,
    ).length;
  }

  private hintCacheKey(
    trigger: HintTrigger,
    gold: number,
    sites: number,
  ): string {
    return `${trigger}_${Math.floor(gold / 50_000)}_${sites}`;
  }

  private incrementTelemetry(key: string): void {
    try {
      const storageKey = `vaultfront.kpi.coach.${key}`;
      const current = Number(localStorage.getItem(storageKey) ?? "0");
      localStorage.setItem(storageKey, String(current + 1));
    } catch {
      // Storage is optional (private mode / embedded hosts may reject writes).
    }
  }

  private showHint(hint: string): void {
    this.hint = hint;
    this.visible = true;
    if (this.hintDismissTimer) clearTimeout(this.hintDismissTimer);
    this.hintDismissTimer = setTimeout(() => {
      this.visible = false;
      this.hint = null;
    }, 12_000);
  }

  private showTacticalHint(trigger: HintTrigger): void {
    this.lastHintTickByTrigger.set(trigger, this.tickCount);
    const state = uiStateManager.get();
    const gold = Number(state.playerGold ?? 0);
    const sites = this.localVaultSiteCount();

    const cacheKey = this.hintCacheKey(trigger, gold, sites);
    const cached = this.hintCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.showHint(cached.hint);
      return;
    }

    const localHint = localTacticalHint(trigger, { gold, sites });
    this.hintCache.set(cacheKey, {
      hint: localHint,
      expiresAt: Date.now() + this.HINT_CACHE_TTL_MS,
    });
    this.showHint(localHint);
    this.incrementTelemetry("localHints");
    this.incrementTelemetry("providerCallsAvoided");
  }
  private dismiss(): void {
    this.visible = false;
    this.hint = null;
    if (this.hintDismissTimer) clearTimeout(this.hintDismissTimer);
    this.hintDismissTimer = null;
  }

  public dispose(): void {
    this.dismiss();
    this.hintCache.clear();
    this.lastHintTickByTrigger.clear();
  }

  private disableHints(): void {
    localStorage.setItem("coachHintsDisabled", "true");
    this.dismiss();
  }

  render() {
    if (!this.visible || !this.hint) return html``;
    return html`
      <style>
        .coach-hint {
          position: fixed;
          bottom: 80px;
          right: 16px;
          z-index: 850;
          max-width: 260px;
          background: rgba(15, 23, 42, 0.88);
          border: 1px solid rgba(59, 130, 246, 0.4);
          border-radius: 8px;
          padding: 8px 12px;
          backdrop-filter: blur(6px);
          animation: hint-slide-in 0.3s ease-out;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .coach-hint-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .coach-hint-label {
          font-size: 0.6rem;
          color: #60a5fa;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-weight: 600;
        }
        .coach-hint-controls {
          display: flex;
          gap: 4px;
        }
        .coach-hint-btn {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          font-size: 0.65rem;
          padding: 1px 4px;
          border-radius: 3px;
          line-height: 1;
        }
        .coach-hint-btn:hover {
          color: #94a3b8;
          background: rgba(255, 255, 255, 0.06);
        }
        .coach-hint-text {
          font-size: 0.72rem;
          color: #e2e8f0;
          line-height: 1.4;
        }
        @keyframes hint-slide-in {
          from {
            opacity: 0;
            transform: translateX(12px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      </style>
      <div class="coach-hint">
        <div class="coach-hint-header">
          <span class="coach-hint-label">💡 Coach</span>
          <div class="coach-hint-controls">
            <button
              class="coach-hint-btn"
              @click=${this.disableHints}
              title="Turn off hints"
            >
              off
            </button>
            <button class="coach-hint-btn" @click=${this.dismiss}>✕</button>
          </div>
        </div>
        <div class="coach-hint-text">${this.hint}</div>
      </div>
    `;
  }
}
