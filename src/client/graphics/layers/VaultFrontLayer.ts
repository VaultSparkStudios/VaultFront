import { Cell } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import {
  BountyBoardActivatedUpdate,
  BountyCollectedUpdate,
  GameUpdateType,
  HeistExecutedUpdate,
  LastStandActivatedUpdate,
  MapEventExpiredUpdate,
  MapEventFiredUpdate,
  MapEventType,
  VaultFrontActivityUpdate,
  VaultFrontStatusUpdate,
  WarchestHuntStartedUpdate,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

interface ActiveVaultFrontPing extends VaultFrontActivityUpdate {
  createdAtTick: number;
  expiresAtTick: number;
}

export interface ExecutionChainHudProjection {
  step: 1 | 2;
  remainingTicks: number;
  durationTicks: number;
  progressRatio: number;
  rewardMultiplier: number;
  nextAction: string;
  accessibleText: string;
}

export function projectExecutionChainHud(
  status: VaultFrontStatusUpdate,
  playerID: number,
  currentTick: number,
): ExecutionChainHudProjection | null {
  const chain = status.executionChains[playerID];
  if (!chain || chain.step === 0) return null;
  const remainingTicks = chain.expiresAtTick - currentTick;
  if (remainingTicks <= 0) return null;

  const durationTicks = Math.max(1, status.executionChainWindowTicks);
  const progressRatio = Math.max(
    0,
    Math.min(1, remainingTicks / durationTicks),
  );
  const nextAction =
    chain.step === 1
      ? "Deliver the captured Vault Convoy"
      : "Deny an enemy pulse with Jam Breaker";
  const secondsRemaining = Math.ceil(remainingTicks / 10);
  const reward = formatExecutionChainMultiplier(
    status.executionChainRewardMultiplier,
  );
  return {
    step: chain.step,
    remainingTicks,
    durationTicks,
    progressRatio,
    rewardMultiplier: status.executionChainRewardMultiplier,
    nextAction,
    accessibleText:
      `Clean execution chain: ${chain.step} of 3 actions complete. ` +
      `Next: ${nextAction}. ${secondsRemaining} seconds remaining. ` +
      `Next convoy reward ×${reward}.`,
  };
}

export function surgeOverlayPulse(
  currentTick: number,
  reducedMotion: boolean,
): number {
  return reducedMotion
    ? 0.45
    : 0.45 + 0.25 * Math.sin((currentTick / 4) * Math.PI);
}

export function hudTransitionAlpha(
  elapsedTicks: number,
  durationTicks: number,
  reducedMotion: boolean,
): number {
  return reducedMotion
    ? 1
    : Math.max(0, 1 - elapsedTicks / Math.max(1, durationTicks));
}

export function executionCompletionPalette(theme: string | null | undefined) {
  return theme === "light"
    ? {
        foreground: "#065f46",
        shadow: "rgba(5, 150, 105, 0.35)",
      }
    : {
        foreground: "#6ee7b7",
        shadow: "rgba(52, 211, 153, 0.9)",
      };
}

function formatExecutionChainMultiplier(multiplier: number): string {
  return multiplier.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export class VaultFrontLayer implements Layer {
  private status: VaultFrontStatusUpdate | null = null;
  private activePings: ActiveVaultFrontPing[] = [];
  /** Tick at which the mutator banner was first shown (0 = not yet shown) */
  private mutatorBannerShownAtTick = 0;
  /** Duration in ticks for the mutator banner to display */
  private readonly mutatorBannerDurationTicks = 60; // ~6 seconds

  // Surge Chronicle — track entry events for cinematic flash
  private surgeWasActive = false;
  private surgeChronicleEntryTick = -1;
  private readonly surgeChronicleFlashTicks = 35; // 3.5s flash window

  // Combo meter — track chain completion and break events
  private prevChainStep: 0 | 1 | 2 = 0;
  private prevChainExpiresAtTick = 0;
  private chainCompletedAtTick = -1;
  private chainBrokAtTick = -1;
  private readonly comboBannerTicks = 30; // 3s banner

  // Last Stand — full-screen alert when a player holds 5+ vault sites
  private lastStandActivatedAtTick = -1;
  private lastStandData: LastStandActivatedUpdate | null = null;
  private readonly lastStandBannerTicks = 50; // 5s banner

  // World Events — global map event HUD banner
  private activeWorldEvent: MapEventFiredUpdate | null = null;
  private worldEventShownAtTick = -1;
  private readonly worldEventBannerInTicks = 80; // 8s entry banner

  // Vault Heist — flash alert when a heist executes
  private heistAlert: HeistExecutedUpdate | null = null;
  private heistAlertTick = -1;
  private readonly heistAlertTicks = 60; // 6s

  // Bounty Board — persistent overlay showing active bounty on a player
  private activeBounty: BountyBoardActivatedUpdate | null = null;
  private bountyCollectedTick = -1;
  private bountyCollectedData: BountyCollectedUpdate | null = null;
  private readonly bountyCollectedAlertTicks = 50;

  // Warchest Hunt — mark/crosshair overlay
  private warchestHunt: WarchestHuntStartedUpdate | null = null;
  private warchestShownAtTick = -1;
  private readonly warchestBannerTicks = 80;

  // Mutator Vote Banner — shown once at tick 3000 for 30 ticks when vote is open
  private readonly VOTE_BANNER_START_TICK = 3000;
  private readonly VOTE_BANNER_DURATION_TICKS = 40;
  private voteBannerShownAtTick = -1;
  private voteBannerStandings: Array<{ name: string; votes: number }> = [];

  // Intel Market tooltip — shown after buy_intel activity event
  private intelTooltip: {
    routeRisk: number;
    interceptProbability: number;
    shownAtTick: number;
  } | null = null;
  private readonly INTEL_TOOLTIP_TICKS = 120; // 12s
  private accessibleChainStatus: HTMLElement | null = null;
  private accessibleChainStatusKey = "";

  constructor(
    private game: GameView,
    private transform: TransformHandler,
  ) {}

  getTickIntervalMs(): number {
    return 100;
  }

  shouldTransform(): boolean {
    return false;
  }

  init(): void {
    const selector = "[data-vaultfront-execution-chain-status]";
    const existing = document.querySelector<HTMLElement>(selector);
    this.accessibleChainStatus = existing ?? document.createElement("div");
    this.accessibleChainStatusKey = "__initial__";
    if (!existing) {
      this.accessibleChainStatus.dataset.vaultfrontExecutionChainStatus = "";
      this.accessibleChainStatus.setAttribute("role", "status");
      this.accessibleChainStatus.setAttribute("aria-live", "polite");
      this.accessibleChainStatus.setAttribute("aria-atomic", "true");
      this.accessibleChainStatus.style.cssText =
        "position:fixed;width:1px;height:1px;padding:0;margin:-1px;" +
        "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
      document.body.appendChild(this.accessibleChainStatus);
    }
  }

  tick(): void {
    const updates = this.game.updatesSinceLastTick();
    const now = this.game.ticks();
    if (!updates) {
      this.updateAccessibleChainStatus(now);
      return;
    }

    const statusUpdates = updates[
      GameUpdateType.VaultFrontStatus
    ] as VaultFrontStatusUpdate[];
    if (statusUpdates.length > 0) {
      this.status = statusUpdates[statusUpdates.length - 1];
    }

    const activityUpdates = updates[
      GameUpdateType.VaultFrontActivity
    ] as VaultFrontActivityUpdate[];
    for (const ping of activityUpdates) {
      this.activePings.push({
        ...ping,
        createdAtTick: now,
        expiresAtTick: now + ping.durationTicks,
      });
    }

    this.activePings = this.activePings
      .filter((ping) => ping.expiresAtTick >= now)
      .slice(-24);

    // Last Stand: display global alert banner
    const lastStandUpdates = updates[
      GameUpdateType.LastStandActivated
    ] as LastStandActivatedUpdate[];
    if (lastStandUpdates && lastStandUpdates.length > 0) {
      this.lastStandData = lastStandUpdates[lastStandUpdates.length - 1];
      this.lastStandActivatedAtTick = now;
    }

    // Vault Heist flash alert
    const heistUpdates = updates[
      GameUpdateType.HeistExecuted
    ] as HeistExecutedUpdate[];
    if (heistUpdates && heistUpdates.length > 0) {
      this.heistAlert = heistUpdates[heistUpdates.length - 1];
      this.heistAlertTick = now;
    }

    // Bounty Board
    const bountyActivated = updates[
      GameUpdateType.BountyBoardActivated
    ] as BountyBoardActivatedUpdate[];
    if (bountyActivated && bountyActivated.length > 0) {
      this.activeBounty = bountyActivated[bountyActivated.length - 1];
    }
    const bountyCollected = updates[
      GameUpdateType.BountyCollected
    ] as BountyCollectedUpdate[];
    if (bountyCollected && bountyCollected.length > 0) {
      this.bountyCollectedData = bountyCollected[bountyCollected.length - 1];
      this.bountyCollectedTick = now;
      if (this.activeBounty && this.bountyCollectedData.chargesLeft <= 0) {
        this.activeBounty = null;
      }
    }

    // Warchest Hunt
    const warchestUpdates = updates[
      GameUpdateType.WarchestHuntStarted
    ] as WarchestHuntStartedUpdate[];
    if (warchestUpdates && warchestUpdates.length > 0) {
      this.warchestHunt = warchestUpdates[warchestUpdates.length - 1];
      this.warchestShownAtTick = now;
    }

    // World Events: track fired/expired map events
    const mapFiredUpdates = updates[
      GameUpdateType.MapEventFired
    ] as MapEventFiredUpdate[];
    if (mapFiredUpdates && mapFiredUpdates.length > 0) {
      this.activeWorldEvent = mapFiredUpdates[mapFiredUpdates.length - 1];
      this.worldEventShownAtTick = now;
    }
    const mapExpiredUpdates = updates[
      GameUpdateType.MapEventExpired
    ] as MapEventExpiredUpdate[];
    if (mapExpiredUpdates && mapExpiredUpdates.length > 0) {
      this.activeWorldEvent = null;
    }

    // Surge Chronicle: detect local player surge entry
    if (this.status) {
      const myPlayer = this.game.myPlayer();
      if (myPlayer) {
        const surgeState = this.status.surges[myPlayer.smallID()];
        const nowActive = surgeState?.active && surgeState.surgeUntilTick > now;
        if (nowActive && !this.surgeWasActive) {
          this.surgeChronicleEntryTick = now;
        }
        this.surgeWasActive = nowActive ?? false;

        // Combo meter: detect chain completion (step was 2, now 0, and hadn't expired)
        const chainState = this.status.executionChains[myPlayer.smallID()];
        const currentStep = chainState?.step ?? 0;
        if (
          this.prevChainStep === 2 &&
          currentStep === 0 &&
          this.prevChainExpiresAtTick > now
        ) {
          this.chainCompletedAtTick = now;
          this.chainBrokAtTick = -1;
        } else if (
          this.prevChainStep > 0 &&
          currentStep === 0 &&
          this.prevChainExpiresAtTick <= now
        ) {
          this.chainBrokAtTick = now;
        }
        this.prevChainStep = currentStep;
        this.prevChainExpiresAtTick = chainState?.expiresAtTick ?? 0;
      }
    }

    // Fetch vote standings once at tick 3000 if not already fetched
    if (now === this.VOTE_BANNER_START_TICK && this.voteBannerShownAtTick < 0) {
      void this.fetchVoteStandings(now);
    }
    this.updateAccessibleChainStatus(now);
  }

  private updateAccessibleChainStatus(currentTick: number): void {
    if (!this.accessibleChainStatus) return;
    const player = this.game.myPlayer();
    const projection =
      this.status && player
        ? projectExecutionChainHud(this.status, player.smallID(), currentTick)
        : null;
    const key = projection
      ? `${projection.step}:${Math.ceil(projection.remainingTicks / 50)}:${projection.rewardMultiplier}`
      : "";
    if (key === this.accessibleChainStatusKey) return;
    this.accessibleChainStatusKey = key;
    this.accessibleChainStatus.textContent = projection?.accessibleText ?? "";
  }

  private async fetchVoteStandings(atTick: number): Promise<void> {
    try {
      const res = await fetch("/api/season/current");
      if (!res.ok) return;
      const data = (await res.json()) as {
        voteStandings?: Array<{ name: string; votes: number }>;
      };
      if (data.voteStandings && data.voteStandings.length > 0) {
        this.voteBannerStandings = data.voteStandings;
        this.voteBannerShownAtTick = atTick;
      }
    } catch {
      // ignore — non-critical
    }
  }

  renderLayer(ctx: CanvasRenderingContext2D): void {
    if (!this.status && this.activePings.length === 0) {
      return;
    }

    // Non-banner draws always run (no conflict)
    this.drawSurgeOverlays(ctx);
    this.drawConvoys(ctx);
    this.drawVaultSites(ctx);
    this.drawBeaconFields(ctx);
    this.drawActivityPings(ctx);
    this.drawSquadObjectiveRings(ctx);
    this.drawExecutionChainHUD(ctx);
    this.drawSurgeHUD(ctx);

    // Banner slot: only the highest-priority active banner renders.
    // Priority: LAST_STAND > HEIST > SURGE_CHRONICLE > WARCHEST > WORLD_EVENT > BOUNTY > MUTATOR
    this.drawBannerSlot(ctx);

    // Intel market tooltip
    this.drawIntelTooltip(ctx);
  }

  /** Renders only the highest-priority active full-screen banner. */
  private drawBannerSlot(ctx: CanvasRenderingContext2D): void {
    const now = this.game.ticks();

    if (
      this.lastStandActivatedAtTick >= 0 &&
      now - this.lastStandActivatedAtTick < this.lastStandBannerTicks
    ) {
      this.drawLastStandBanner(ctx);
      return;
    }
    if (
      this.heistAlertTick >= 0 &&
      now - this.heistAlertTick < this.heistAlertTicks
    ) {
      this.drawHeistAlert(ctx);
      return;
    }
    if (
      this.surgeChronicleEntryTick >= 0 &&
      now - this.surgeChronicleEntryTick < this.surgeChronicleFlashTicks
    ) {
      this.drawSurgeChronicle(ctx);
      return;
    }
    if (
      this.warchestShownAtTick >= 0 &&
      now - this.warchestShownAtTick < this.warchestBannerTicks
    ) {
      this.drawWarchestBanner(ctx);
      return;
    }
    if (this.activeWorldEvent !== null) {
      this.drawWorldEventBanner(ctx);
      return;
    }
    if (
      this.voteBannerShownAtTick >= 0 &&
      now - this.voteBannerShownAtTick < this.VOTE_BANNER_DURATION_TICKS &&
      this.voteBannerStandings.length > 0
    ) {
      this.drawVoteStandingsBanner(ctx);
      return;
    }
    // Bounty board and mutator banner are persistent; they both render if no higher-priority banner active
    this.drawBountyBoard(ctx);
    this.drawMutatorBanner(ctx);
  }

  private drawVoteStandingsBanner(ctx: CanvasRenderingContext2D): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const bw = Math.min(340, cw * 0.6);
    const bh = 72;
    const bx = (cw - bw) / 2;
    const by = ch - bh - 48;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(99, 102, 241, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#818cf8";
    ctx.font = `bold 10px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("🗳  Community Vote — Next Mutator", cw / 2, by + 16);

    const standings = this.voteBannerStandings.slice(0, 3);
    const totalVotes = Math.max(
      1,
      standings.reduce((s, x) => s + x.votes, 0),
    );
    const cols = standings.length;
    const colW = bw / cols;

    standings.forEach((s, i) => {
      const cx = bx + colW * i + colW / 2;
      const pct = Math.round((s.votes / totalVotes) * 100);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `bold 11px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(s.name, cx, by + 36);
      ctx.fillStyle = "#94a3b8";
      ctx.font = `9px sans-serif`;
      ctx.fillText(`${pct}%`, cx, by + 50);
    });

    ctx.fillStyle = "#475569";
    ctx.font = `8px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("discord.gg/vaultfront to vote", cw / 2, by + 66);

    ctx.restore();
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      "matchMedia" in window &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /** Returns 0.72 on narrow (<600px) canvases for compact mobile banner scaling. */
  private scaleFactor(ctx: CanvasRenderingContext2D): number {
    return ctx.canvas.width < 600 ? 0.72 : 1;
  }

  private drawVaultSites(ctx: CanvasRenderingContext2D): void {
    if (!this.status || this.status.sites.length === 0) return;

    const baseSize = this.markerSize();
    for (const site of this.status.sites) {
      const screen = this.screenForTile(site.tile);
      if (!screen) continue;

      const progress =
        this.status.captureTicksRequired > 0
          ? Math.max(
              0,
              Math.min(1, site.controlTicks / this.status.captureTicksRequired),
            )
          : 0;
      const cooldownRatio =
        this.status.cooldownTicksTotal > 0
          ? Math.max(
              0,
              Math.min(1, site.cooldownTicks / this.status.cooldownTicksTotal),
            )
          : 0;

      const cooldownSecs = Math.ceil(site.cooldownTicks / 10);
      const passiveSecs = Math.max(
        0,
        Math.ceil((site.nextPassiveIncomeTick - this.game.ticks()) / 10),
      );

      ctx.save();
      this.drawVaultIcon(
        ctx,
        screen.x,
        screen.y,
        baseSize,
        site.cooldownTicks > 0
          ? "cooldown"
          : site.controllerID !== null
            ? "capturing"
            : site.passiveOwnerID !== null
              ? "owned"
              : "neutral",
      );

      if (site.controllerID !== null && site.cooldownTicks <= 0) {
        ctx.strokeStyle = "rgba(251, 146, 60, 0.95)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(
          screen.x,
          screen.y,
          baseSize + 5,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * progress,
        );
        ctx.stroke();
      } else if (site.cooldownTicks > 0) {
        ctx.strokeStyle = "rgba(148, 163, 184, 0.95)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(
          screen.x,
          screen.y,
          baseSize + 5,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * cooldownRatio,
        );
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `${Math.round(this.fontSize())}px Overpass, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(`Vault ${site.id}`, screen.x + 13, screen.y - 8);
      if (site.cooldownTicks > 0) {
        ctx.fillStyle = "rgba(203, 213, 225, 0.92)";
        ctx.font = `${Math.round(this.fontSize() - 2)}px Overpass, sans-serif`;
        ctx.fillText(`Cooldown ${cooldownSecs}s`, screen.x + 13, screen.y + 8);
      } else if (site.passiveOwnerID !== null) {
        ctx.fillStyle = "rgba(167, 243, 208, 0.92)";
        ctx.font = `${Math.round(this.fontSize() - 2)}px Overpass, sans-serif`;
        ctx.fillText(
          `Passive +gold in ${passiveSecs}s`,
          screen.x + 13,
          screen.y + 8,
        );
      }
      ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
      ctx.font = `${Math.round(this.fontSize() - 3)}px Overpass, sans-serif`;
      ctx.fillText(
        `Est +${site.projectedGoldReward.toLocaleString()}g +${site.projectedTroopsReward.toLocaleString()}t`,
        screen.x + 13,
        screen.y + 22,
      );
      ctx.restore();
    }
  }

  private drawConvoys(ctx: CanvasRenderingContext2D): void {
    if (!this.status || this.status.convoys.length === 0) return;
    const reducedMotion = this.prefersReducedMotion();

    const myPlayerID = this.game.myPlayer()?.smallID() ?? -1;

    for (const convoy of this.status.convoys) {
      const isOwnConvoy = convoy.ownerID === myPlayerID;
      // Ghost convoys owned by opponents are hidden from us
      if (convoy.isGhost && !isOwnConvoy) continue;

      const src = this.screenForTile(convoy.sourceTile);
      const dst = this.screenForTile(convoy.destinationTile);
      if (!src || !dst) continue;

      const progress =
        convoy.totalTicks > 0
          ? Math.max(
              0,
              Math.min(
                1,
                (convoy.totalTicks - convoy.ticksRemaining) / convoy.totalTicks,
              ),
            )
          : 1;

      const routeX = dst.x - src.x;
      const routeY = dst.y - src.y;
      const routeLen = Math.hypot(routeX, routeY);
      if (routeLen <= 0.01) continue;
      const angle = Math.atan2(routeY, routeX);

      ctx.save();
      const laneGradient = ctx.createLinearGradient(src.x, src.y, dst.x, dst.y);
      laneGradient.addColorStop(0, "rgba(253, 224, 71, 0.25)");
      laneGradient.addColorStop(0.5, "rgba(250, 204, 21, 0.82)");
      laneGradient.addColorStop(1, "rgba(253, 224, 71, 0.28)");
      ctx.strokeStyle = laneGradient;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = reducedMotion
        ? 0
        : -((this.game.ticks() % 24) * 0.75);
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(dst.x, dst.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      ctx.strokeStyle = "rgba(120, 53, 15, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(src.x, src.y + 1.5);
      ctx.lineTo(dst.x, dst.y + 1.5);
      ctx.stroke();

      const convoyScale = Math.max(0.72, Math.min(1.5, this.markerSize() / 5));
      const glowPulse = reducedMotion
        ? 0.55
        : 0.45 + ((this.game.ticks() % 30) / 30) * 0.5;
      ctx.fillStyle = `rgba(250, 204, 21, ${0.08 + glowPulse * 0.12})`;
      ctx.beginPath();
      ctx.arc(
        dst.x,
        dst.y,
        this.markerSize() * (2.2 + glowPulse),
        0,
        Math.PI * 2,
      );
      ctx.fill();

      const offsets = [0, 0.045, 0.09];
      for (let i = offsets.length - 1; i >= 0; i--) {
        const p = Math.max(0, progress - offsets[i]);
        const x = src.x + routeX * p;
        const y = src.y + routeY * p;
        this.drawConvoyTruck(
          ctx,
          x,
          y,
          angle,
          convoyScale,
          i === 0,
          convoy.escortShield > 0,
        );
      }

      const etaSeconds = Math.ceil(convoy.ticksRemaining / 10);
      const midX = src.x + (dst.x - src.x) * 0.5;
      const midY = src.y + (dst.y - src.y) * 0.5;
      const ghostAlpha = convoy.isGhost ? 0.55 : 1;
      ctx.globalAlpha = ghostAlpha;
      ctx.fillStyle = convoy.isGhost
        ? "rgba(168, 162, 255, 0.95)"
        : "rgba(255, 248, 214, 0.95)";
      ctx.font = `${Math.round(this.fontSize() - 1)}px Overpass, sans-serif`;
      ctx.textAlign = "center";
      const shieldLabel =
        convoy.escortShield > 0 ? ` | Shield x${convoy.escortShield}` : "";
      const etaLabel = convoy.isGhost
        ? `👻 Ghost Route ETA ${etaSeconds}s${shieldLabel}`
        : `Vault Convoy ETA ${etaSeconds}s${shieldLabel}`;
      ctx.fillText(etaLabel, midX, midY - 8);
      ctx.fillStyle = convoy.isGhost
        ? "rgba(196, 181, 253, 0.9)"
        : "rgba(255, 236, 179, 0.9)";
      ctx.font = `${Math.round(this.fontSize() - 3)}px Overpass, sans-serif`;
      ctx.fillText(
        `+${convoy.goldReward.toLocaleString()}g +${convoy.troopsReward.toLocaleString()}t`,
        midX,
        midY + 6,
      );
      ctx.globalAlpha = 1;

      // Intercept probability gauge bar
      const prob = convoy.interceptProbability ?? 0;
      if (prob > 0) {
        const barW = Math.min(120, routeLen * 0.45);
        const barH = 4;
        const barX = midX - barW / 2;
        const barY = midY + 16;

        ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW, barH, 2);
        ctx.fill();

        const fillW = (prob / 100) * barW;
        const barGrad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
        barGrad.addColorStop(0, "rgba(34, 197, 94, 0.9)");
        barGrad.addColorStop(0.4, "rgba(234, 179, 8, 0.9)");
        barGrad.addColorStop(1, "rgba(239, 68, 68, 0.95)");
        ctx.fillStyle = barGrad;
        ctx.beginPath();
        ctx.roundRect(barX, barY, fillW, barH, 2);
        ctx.fill();

        // Pulse glow behind bar when danger threshold crossed (>70%)
        if (prob > 70) {
          const pulse = 0.35 + 0.35 * Math.abs(Math.sin(Date.now() / 350));
          ctx.save();
          ctx.shadowColor = "rgba(239, 68, 68, 0.9)";
          ctx.shadowBlur = 8 * pulse;
          ctx.fillStyle = `rgba(239, 68, 68, ${pulse * 0.25})`;
          ctx.beginPath();
          ctx.roundRect(barX - 3, barY - 3, barW + 6, barH + 6, 4);
          ctx.fill();
          ctx.restore();
        }

        ctx.fillStyle =
          prob >= 60
            ? "rgba(252, 165, 165, 0.9)"
            : prob >= 30
              ? "rgba(253, 224, 71, 0.9)"
              : "rgba(134, 239, 172, 0.9)";
        ctx.font = `${Math.round(this.fontSize() - 4)}px Overpass, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(`${prob}% intercept risk`, midX, barY + barH + 9);
      }

      ctx.restore();
    }
  }

  private drawBeaconFields(ctx: CanvasRenderingContext2D): void {
    if (!this.status || this.status.beacons.length === 0) return;

    const now = this.game.ticks();
    for (const beacon of this.status.beacons) {
      if (!beacon.anchorTile || beacon.factoryCount <= 0) {
        continue;
      }

      const screen = this.screenForTile(beacon.anchorTile);
      if (!screen) continue;

      const active = now < beacon.maskedUntilTick;
      const reducedMotion = this.prefersReducedMotion();
      const pulsePhase = reducedMotion ? 0 : (now % 50) / 50;
      const pulse = reducedMotion
        ? 0.35
        : Math.sin(pulsePhase * Math.PI * 2) * 0.5 + 0.5;
      const baseRadius = this.markerSize() * 1.7;
      const radius = baseRadius + pulse * 10;

      ctx.save();
      if (active) {
        ctx.strokeStyle = "rgba(96, 165, 250, 0.96)";
        ctx.fillStyle = "rgba(59, 130, 246, 0.18)";
        ctx.lineWidth = 2.5;
      } else {
        ctx.strokeStyle = "rgba(148, 163, 184, 0.78)";
        ctx.fillStyle = "rgba(71, 85, 105, 0.14)";
        ctx.lineWidth = 1.7;
      }

      ctx.beginPath();
      ctx.arc(screen.x, screen.y, active ? radius : baseRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const chargeRatio = Math.max(0, Math.min(1, beacon.charge / 100));
      ctx.strokeStyle = active
        ? "rgba(191, 219, 254, 0.95)"
        : "rgba(147, 197, 253, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        screen.x,
        screen.y,
        baseRadius + 3,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * chargeRatio,
      );
      ctx.stroke();

      const secondsLeft = Math.max(
        0,
        Math.ceil((beacon.maskedUntilTick - now) / 10),
      );
      const label = active
        ? `Defense Factory Active ${secondsLeft}s`
        : `Defense Factory Charge ${Math.floor(beacon.charge)}%`;
      ctx.fillStyle = "rgba(219, 234, 254, 0.95)";
      ctx.font = `${Math.round(this.fontSize() - 1)}px Overpass, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(label, screen.x + 12, screen.y + 5);
      ctx.restore();
    }
  }

  private drawActivityPings(ctx: CanvasRenderingContext2D): void {
    if (this.activePings.length === 0) return;
    const now = this.game.ticks();
    const reducedMotion = this.prefersReducedMotion();

    for (const ping of this.activePings) {
      const screen = this.screenForTile(ping.tile);
      if (!screen) continue;

      const total = Math.max(1, ping.durationTicks);
      const remaining = Math.max(0, ping.expiresAtTick - now);
      const ratio = remaining / total;
      const alpha = 0.2 + ratio * 0.8;
      const color = this.activityColor(ping.activity);
      const pulse = reducedMotion ? 1.25 : 1 + (1 - ratio) * 2.4;
      const radius = this.markerSize() * pulse;

      ctx.save();
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(
        screen.x,
        screen.y,
        Math.max(2, this.markerSize() * 0.5),
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${0.25 + alpha * 0.6})`;
      ctx.fill();

      if (ping.activity === "convoy_delivered") {
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.max(0.35, alpha)})`;
        ctx.lineWidth = 1.3;
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI * 2 * i) / 6;
          const inner = this.markerSize() * 0.75;
          const outer = radius + this.markerSize() * 0.8;
          ctx.beginPath();
          ctx.moveTo(
            screen.x + Math.cos(angle) * inner,
            screen.y + Math.sin(angle) * inner,
          );
          ctx.lineTo(
            screen.x + Math.cos(angle) * outer,
            screen.y + Math.sin(angle) * outer,
          );
          ctx.stroke();
        }
      }

      if (ping.activity === "convoy_intercepted") {
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.max(0.4, alpha)})`;
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 * i) / 5 + 0.35;
          const start = this.markerSize() * 0.35;
          const end = radius + this.markerSize() * 0.45;
          ctx.beginPath();
          ctx.moveTo(
            screen.x + Math.cos(angle) * start,
            screen.y + Math.sin(angle) * start,
          );
          ctx.lineTo(
            screen.x + Math.cos(angle) * end,
            screen.y + Math.sin(angle) * end,
          );
          ctx.stroke();
        }
      }

      ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.4, alpha)})`;
      ctx.font = `${Math.round(this.fontSize() - 1)}px Overpass, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(ping.label, screen.x + 10, screen.y - 5);
      ctx.restore();
    }
  }

  private drawVaultIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    state: "neutral" | "capturing" | "cooldown" | "owned",
  ): void {
    const half = size * 0.9;
    const doorW = size * 0.72;
    const doorH = size * 0.72;

    const palette =
      state === "cooldown"
        ? {
            stroke: "rgba(148, 163, 184, 0.95)",
            fill: "rgba(71, 85, 105, 0.58)",
            door: "rgba(30, 41, 59, 0.88)",
          }
        : state === "capturing"
          ? {
              stroke: "rgba(251, 146, 60, 0.96)",
              fill: "rgba(249, 115, 22, 0.28)",
              door: "rgba(120, 53, 15, 0.85)",
            }
          : state === "owned"
            ? {
                stroke: "rgba(52, 211, 153, 0.96)",
                fill: "rgba(16, 185, 129, 0.24)",
                door: "rgba(6, 95, 70, 0.84)",
              }
            : {
                stroke: "rgba(34, 211, 238, 0.95)",
                fill: "rgba(34, 211, 238, 0.18)",
                door: "rgba(8, 47, 73, 0.82)",
              };

    ctx.lineWidth = 2.4;
    ctx.strokeStyle = palette.stroke;
    ctx.fillStyle = palette.fill;
    ctx.beginPath();
    ctx.moveTo(x - half * 0.7, y - half);
    ctx.lineTo(x + half * 0.7, y - half);
    ctx.lineTo(x + half, y - half * 0.7);
    ctx.lineTo(x + half, y + half * 0.7);
    ctx.lineTo(x + half * 0.7, y + half);
    ctx.lineTo(x - half * 0.7, y + half);
    ctx.lineTo(x - half, y + half * 0.7);
    ctx.lineTo(x - half, y - half * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = palette.door;
    ctx.strokeStyle = "rgba(226, 232, 240, 0.8)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.rect(x - doorW / 2, y - doorH / 2, doorW, doorH);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, size * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, size * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(241, 245, 249, 0.95)";
    ctx.fill();
  }

  private drawConvoyTruck(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    scale: number,
    lead: boolean,
    escorted: boolean,
  ): void {
    const bodyW = 16 * scale;
    const bodyH = 8 * scale;
    const cabW = 6 * scale;
    const wheelR = 1.6 * scale;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = lead
      ? "rgba(251, 191, 36, 0.98)"
      : "rgba(253, 224, 71, 0.82)";
    ctx.strokeStyle = "rgba(120, 53, 15, 0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(245, 158, 11, 0.96)";
    ctx.beginPath();
    ctx.rect(bodyW / 2 - cabW, -bodyH / 2, cabW, bodyH * 0.82);
    ctx.fill();

    ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
    ctx.beginPath();
    ctx.rect(bodyW / 2 - cabW + 1, -bodyH / 2 + 1, cabW * 0.5, bodyH * 0.28);
    ctx.fill();

    ctx.fillStyle = "rgba(217, 119, 6, 0.9)";
    ctx.beginPath();
    ctx.rect(-bodyW * 0.28, -bodyH * 0.18, bodyW * 0.3, bodyH * 0.36);
    ctx.fill();

    ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
    ctx.beginPath();
    ctx.arc(-bodyW * 0.27, bodyH * 0.58, wheelR, 0, Math.PI * 2);
    ctx.arc(bodyW * 0.2, bodyH * 0.58, wheelR, 0, Math.PI * 2);
    ctx.fill();

    if (escorted) {
      ctx.strokeStyle = "rgba(147, 197, 253, 0.92)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, bodyW * 0.66, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private screenForTile(tile: TileRef): { x: number; y: number } | null {
    const world = new Cell(this.game.x(tile) + 0.5, this.game.y(tile) + 0.5);
    if (!this.transform.isOnScreen(world)) {
      return null;
    }
    return this.transform.worldToScreenCoordinates(world);
  }

  private activityColor(activity: VaultFrontActivityUpdate["activity"]): {
    r: number;
    g: number;
    b: number;
  } {
    switch (activity) {
      case "vault_captured":
        return { r: 34, g: 211, b: 238 };
      case "vault_passive_income":
        return { r: 52, g: 211, b: 153 };
      case "convoy_launched":
      case "convoy_rerouted":
      case "convoy_escorted":
      case "convoy_delivered":
        return { r: 250, g: 204, b: 21 };
      case "convoy_intercepted":
        return { r: 251, g: 113, b: 133 };
      case "beacon_pulse":
        return { r: 96, g: 165, b: 250 };
      case "jam_breaker":
        return { r: 244, g: 114, b: 182 };
      case "comeback_surge":
        return { r: 110, g: 231, b: 183 };
      case "ghost_reveal":
        return { r: 168, g: 162, b: 255 };
      default:
        return { r: 255, g: 255, b: 255 };
    }
  }

  /**
   * Draw squad objective rings on the map for all active windows.
   * A fading circle + timer arc centered on the vault tile.
   */
  private drawSquadObjectiveRings(ctx: CanvasRenderingContext2D): void {
    if (!this.status || this.status.squadObjectives.length === 0) return;
    const now = this.game.ticks();
    for (const obj of this.status.squadObjectives) {
      if (obj.rewarded || obj.expiresAtTick <= now) continue;
      const screen = this.screenForTile(obj.anchorTile);
      if (!screen) continue;

      const totalTicks = 520; // squad window duration from GAMEPLAY_DESIGN.md
      const remaining = obj.expiresAtTick - now;
      const ratio = Math.max(0, Math.min(1, remaining / totalTicks));
      const ringRadius = Math.max(24, this.transform.scale * 6);
      const alpha = 0.4 + ratio * 0.5;

      ctx.save();
      // Outer dashed ring
      ctx.strokeStyle = `rgba(167, 243, 208, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Timer arc (solid, fills clockwise as time runs out)
      ctx.strokeStyle = "rgba(52, 211, 153, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        screen.x,
        screen.y,
        ringRadius + 4,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * ratio,
      );
      ctx.stroke();

      // Label
      ctx.fillStyle = "rgba(167, 243, 208, 0.95)";
      ctx.font = `bold ${Math.round(this.fontSize() - 1)}px Overpass, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("SQUAD", screen.x, screen.y - ringRadius - 8);
      const secsLeft = Math.ceil(remaining / 10);
      ctx.fillStyle = "rgba(209, 250, 229, 0.85)";
      ctx.font = `${Math.round(this.fontSize() - 3)}px Overpass, sans-serif`;
      ctx.fillText(`${secsLeft}s`, screen.x, screen.y + ringRadius + 14);
      ctx.restore();
    }
  }

  /**
   * Draw the execution chain combo meter in the bottom-right HUD corner.
   * Three nodes: [Capture] → [Deliver] → [Jam+Deny]
   * Active step lights up; a timer arc shows remaining window.
   */
  private drawExecutionChainHUD(ctx: CanvasRenderingContext2D): void {
    if (!this.status) return;
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    const now = this.game.ticks();
    this.drawExecutionChainOutcomeBanner(ctx, now);
    const projection = projectExecutionChainHud(
      this.status,
      myPlayer.smallID(),
      now,
    );
    if (!projection) return;
    const chainState = this.status.executionChains[myPlayer.smallID()];

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const baseX = w - 180;
    const baseY = h - 56;
    const nodeR = 10;
    const nodeSpacing = 44;
    const labels = ["CAPTURE", "DELIVER", "JAM"];

    ctx.save();
    // Background pill
    ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
    ctx.beginPath();
    ctx.roundRect(baseX - 16, baseY - 28, 3 * nodeSpacing + 16, 52, 8);
    ctx.fill();

    // Connector lines
    for (let i = 0; i < 2; i++) {
      const x1 = baseX + i * nodeSpacing + nodeR;
      const x2 = baseX + (i + 1) * nodeSpacing - nodeR;
      ctx.strokeStyle =
        i + 1 < chainState.step
          ? "rgba(52, 211, 153, 0.9)"
          : "rgba(71, 85, 105, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, baseY);
      ctx.lineTo(x2, baseY);
      ctx.stroke();
    }

    // Nodes
    for (let i = 0; i < 3; i++) {
      const x = baseX + i * nodeSpacing;
      const filled = i + 1 <= chainState.step;
      const active = i + 1 === chainState.step;

      // Glow for active node
      if (active) {
        ctx.shadowColor = "rgba(52, 211, 153, 0.8)";
        ctx.shadowBlur = 12;
      }
      ctx.fillStyle = filled
        ? active
          ? "rgba(52, 211, 153, 0.95)"
          : "rgba(52, 211, 153, 0.6)"
        : "rgba(51, 65, 85, 0.8)";
      ctx.beginPath();
      ctx.arc(x, baseY, nodeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Node number
      ctx.fillStyle = filled
        ? "rgba(15, 23, 42, 0.9)"
        : "rgba(148,163,184,0.8)";
      ctx.font = `bold 9px Overpass, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), x, baseY + 3.5);

      // Label below
      ctx.fillStyle = filled
        ? "rgba(167, 243, 208, 0.9)"
        : "rgba(100, 116, 139, 0.8)";
      ctx.font = `7px Overpass, sans-serif`;
      ctx.fillText(labels[i], x, baseY + 20);
    }

    // Timer arc around the pill
    const timerX = baseX + nodeSpacing;
    ctx.strokeStyle = "rgba(52, 211, 153, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(
      timerX,
      baseY - 22,
      6,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * projection.progressRatio,
    );
    ctx.stroke();

    ctx.restore();
  }

  private drawExecutionChainOutcomeBanner(
    ctx: CanvasRenderingContext2D,
    currentTick: number,
  ): void {
    if (!this.status) return;
    const completedElapsed =
      this.chainCompletedAtTick >= 0
        ? currentTick - this.chainCompletedAtTick
        : -1;
    const brokenElapsed =
      this.chainBrokAtTick >= 0 ? currentTick - this.chainBrokAtTick : -1;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    if (completedElapsed >= 0 && completedElapsed < this.comboBannerTicks) {
      const fade = hudTransitionAlpha(
        completedElapsed,
        this.comboBannerTicks,
        this.prefersReducedMotion(),
      );
      const multiplier = formatExecutionChainMultiplier(
        this.status.executionChainRewardMultiplier,
      );
      const palette = executionCompletionPalette(
        typeof document === "undefined"
          ? null
          : document.documentElement.getAttribute("data-vaultfront-theme"),
      );
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.shadowColor = palette.shadow;
      ctx.shadowBlur = 18;
      ctx.fillStyle = palette.foreground;
      ctx.font = `bold ${Math.round(h * 0.03)}px Overpass, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(`CLEAN EXECUTION ×${multiplier}`, w / 2, h * 0.28);
      ctx.restore();
    } else if (brokenElapsed >= 0 && brokenElapsed < 20) {
      const fade = hudTransitionAlpha(
        brokenElapsed,
        20,
        this.prefersReducedMotion(),
      );
      ctx.save();
      ctx.fillStyle = `rgba(148, 163, 184, ${fade * 0.7})`;
      ctx.font = `${Math.round(h * 0.022)}px Overpass, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("chain broken", w / 2, h * 0.28);
      ctx.restore();
    }
  }

  /**
   * Draw a surge active badge in the bottom-left HUD corner.
   * Pulses while active; shows countdown.
   */
  private drawSurgeHUD(ctx: CanvasRenderingContext2D): void {
    if (!this.status) return;
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    const surgeState = this.status.surges[myPlayer.smallID()];
    if (!surgeState?.active) return;

    const now = this.game.ticks();
    const remaining = surgeState.surgeUntilTick - now;
    if (remaining <= 0) return;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const sc = this.scaleFactor(ctx);
    const bw = Math.round(148 * sc);
    const bh2 = Math.round(40 * sc);
    const x = 16;
    const y = h - bh2 - 24;
    const pulse = this.prefersReducedMotion()
      ? 0.7
      : 0.7 + 0.3 * Math.sin((now / 5) * Math.PI);
    const secsLeft = Math.ceil(remaining / 10);

    ctx.save();
    ctx.shadowColor = `rgba(52, 211, 153, ${pulse * 0.8})`;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = `rgba(52, 211, 153, ${pulse})`;
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh2, 8);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = `rgba(110, 231, 183, ${pulse})`;
    ctx.font = `bold ${Math.round(12 * sc)}px Overpass, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText("⚡ SURGE ACTIVE", x + 10, y + Math.round(16 * sc));
    ctx.fillStyle = "rgba(167, 243, 208, 0.85)";
    ctx.font = `${Math.round(10 * sc)}px Overpass, sans-serif`;
    ctx.fillText(
      `+gold  +troops  ${secsLeft}s left`,
      x + 10,
      y + Math.round(30 * sc),
    );
    ctx.restore();

    void w;
  }

  /**
   * One-time mutator banner shown at game start for ~6 seconds then fades.
   */
  private drawMutatorBanner(ctx: CanvasRenderingContext2D): void {
    if (!this.status || this.status.weeklyMutator === "none") return;

    const now = this.game.ticks();
    if (this.mutatorBannerShownAtTick === 0) {
      this.mutatorBannerShownAtTick = now;
    }

    const elapsed = now - this.mutatorBannerShownAtTick;
    if (elapsed >= this.mutatorBannerDurationTicks) return;

    const fadeInTicks = 10;
    const fadeOutStart = this.mutatorBannerDurationTicks - 15;
    let alpha: number;
    if (elapsed < fadeInTicks) {
      alpha = elapsed / fadeInTicks;
    } else if (elapsed > fadeOutStart) {
      alpha = 1 - (elapsed - fadeOutStart) / 15;
    } else {
      alpha = 1;
    }
    alpha = Math.max(0, Math.min(1, alpha));

    const mutatorLabels: Record<string, { name: string; desc: string }> = {
      lane_fog: {
        name: "LANE FOG",
        desc: "Convoy activity hidden from feed  •  Routes +8% riskier",
      },
      accelerated_cooldowns: {
        name: "ACCELERATED COOLDOWNS",
        desc: "Vault cooldowns ×0.75  •  Beacon, jam, escort faster",
      },
      double_passive: {
        name: "DOUBLE PASSIVE",
        desc: "Passive vault income ×2  •  Interval halved",
      },
      gold_rush: {
        name: "GOLD RUSH",
        desc: "Convoy gold rewards +50%  •  High-stakes extraction",
      },
      blitz: {
        name: "BLITZ",
        desc: "Vault capture time −40%  •  Control windows close fast",
      },
      no_mercy: {
        name: "NO MERCY",
        desc: "Escort shields disabled  •  All convoys are exposed",
      },
      contested: {
        name: "CONTESTED",
        desc: "Capture progress decays when unoccupied  •  Hold your ground",
      },
      shield_escort: {
        name: "SHIELDED RUN",
        desc: "All convoys launch with 2 escort shields",
      },
      rally_point: {
        name: "RALLY POINT",
        desc: "Passive income ×2  •  Vault captures grant +1,200 troops",
      },
      execution_rush: {
        name: "EXECUTION RUSH",
        desc: "Chain window ×2  •  Clean execution multiplier ×1.5",
      },
    };

    const label = mutatorLabels[this.status.weeklyMutator];
    if (!label) return;

    const w = ctx.canvas.width;
    const bannerW = Math.min(420, w - 32);
    const bx = (w - bannerW) / 2;
    const by = 16;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.strokeStyle = "rgba(96, 165, 250, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bannerW, 52, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(147, 197, 253, 0.95)";
    ctx.font = `bold 11px Overpass, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("THIS WEEK'S MUTATOR", w / 2, by + 16);

    ctx.fillStyle = "rgba(248, 250, 252, 0.95)";
    ctx.font = `bold 14px Overpass, sans-serif`;
    ctx.fillText(label.name, w / 2, by + 32);

    ctx.fillStyle = "rgba(203, 213, 225, 0.85)";
    ctx.font = `10px Overpass, sans-serif`;
    ctx.fillText(label.desc, w / 2, by + 46);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawWorldEventBanner(ctx: CanvasRenderingContext2D): void {
    if (!this.activeWorldEvent || this.worldEventShownAtTick < 0) return;
    const now = this.game.ticks();
    const elapsed = now - this.worldEventShownAtTick;
    if (elapsed > this.worldEventBannerInTicks) return;

    const fadeIn = 8;
    const fadeOut = 14;
    const holdEnd = this.worldEventBannerInTicks - fadeOut;
    let alpha: number;
    if (elapsed < fadeIn) {
      alpha = elapsed / fadeIn;
    } else if (elapsed > holdEnd) {
      alpha = 1 - (elapsed - holdEnd) / fadeOut;
    } else {
      alpha = 1;
    }
    alpha = Math.max(0, Math.min(1, alpha));

    const eventMeta: Record<
      MapEventType,
      { emoji: string; name: string; desc: string; accent: string }
    > = {
      vault_bonanza: {
        emoji: "💰",
        name: "VAULT BONANZA",
        desc: "All vault captures pay double gold  •  Window is brief",
        accent: "rgba(251, 191, 36, 0.9)",
      },
      supply_disruption: {
        emoji: "🚫",
        name: "SUPPLY DISRUPTION",
        desc: "Convoy gold yields −40%  •  Intercepts now more lucrative",
        accent: "rgba(248, 113, 113, 0.9)",
      },
      intelligence_breach: {
        emoji: "👁",
        name: "INTELLIGENCE BREACH",
        desc: "All intel revealed globally  •  No safe routes",
        accent: "rgba(167, 139, 250, 0.9)",
      },
      gold_rush: {
        emoji: "⛏",
        name: "GOLD RUSH",
        desc: "Passive income doubled  •  Stake your claim now",
        accent: "rgba(52, 211, 153, 0.9)",
      },
      siege_protocol: {
        emoji: "🏰",
        name: "SIEGE PROTOCOL",
        desc: "Capture speed ×1.5  •  Defenses weaken globally",
        accent: "rgba(251, 146, 60, 0.9)",
      },
      diplomatic_window: {
        emoji: "🤝",
        name: "DIPLOMATIC WINDOW",
        desc: "Alliance bonuses active  •  Coordinate to dominate",
        accent: "rgba(56, 189, 248, 0.9)",
      },
    };

    const meta = eventMeta[this.activeWorldEvent.eventType];
    if (!meta) return;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const secsLeft = Math.max(
      0,
      Math.ceil(
        (this.activeWorldEvent.startTick +
          this.activeWorldEvent.durationTicks -
          now) /
          10,
      ),
    );

    const bannerW = Math.min(460, w - 32);
    const bx = (w - bannerW) / 2;
    const by = h - 100;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Backdrop
    ctx.fillStyle = "rgba(2, 6, 23, 0.92)";
    ctx.strokeStyle = meta.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bannerW, 58, 8);
    ctx.fill();
    ctx.stroke();

    // Left accent stripe
    ctx.fillStyle = meta.accent;
    ctx.beginPath();
    ctx.roundRect(bx, by, 4, 58, [8, 0, 0, 8]);
    ctx.fill();

    // Emoji + event name
    ctx.fillStyle = meta.accent;
    ctx.font = `bold 11px Overpass, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(`${meta.emoji}  WORLD EVENT`, bx + 14, by + 16);

    ctx.fillStyle = "rgba(248, 250, 252, 0.97)";
    ctx.font = `bold 15px Overpass, sans-serif`;
    ctx.fillText(meta.name, bx + 14, by + 34);

    ctx.fillStyle = "rgba(203, 213, 225, 0.82)";
    ctx.font = `10px Overpass, sans-serif`;
    ctx.fillText(meta.desc, bx + 14, by + 50);

    // Countdown badge
    const badgeText = `${secsLeft}s`;
    ctx.fillStyle = "rgba(30, 41, 59, 0.85)";
    ctx.beginPath();
    ctx.roundRect(bx + bannerW - 44, by + 12, 36, 20, 4);
    ctx.fill();
    ctx.fillStyle = meta.accent;
    ctx.font = `bold 10px Overpass, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(badgeText, bx + bannerW - 26, by + 25);

    ctx.restore();
  }

  private drawHeistAlert(ctx: CanvasRenderingContext2D): void {
    if (this.heistAlertTick < 0 || !this.heistAlert) return;
    const now = this.game.ticks();
    const elapsed = now - this.heistAlertTick;
    if (elapsed > this.heistAlertTicks) return;

    const fadeIn = 6;
    const fadeOut = 12;
    const holdEnd = this.heistAlertTicks - fadeOut;
    let alpha =
      elapsed < fadeIn
        ? elapsed / fadeIn
        : elapsed > holdEnd
          ? 1 - (elapsed - holdEnd) / fadeOut
          : 1;
    alpha = Math.max(0, Math.min(1, alpha));

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const myID = this.game.myPlayer()?.smallID();
    const isVictim = this.heistAlert.victimPlayerID === myID;
    const isHeister = this.heistAlert.heistPlayerID === myID;

    const accent = isVictim
      ? "rgba(248, 113, 113, 0.9)"
      : isHeister
        ? "rgba(52, 211, 153, 0.9)"
        : "rgba(251, 191, 36, 0.9)";
    const goldK = Math.round(this.heistAlert.goldStolen / 1000);
    const headline = isVictim
      ? `💀 VAULT HEISTED — ${goldK}k gold stolen from you`
      : isHeister
        ? `💰 VAULT HEIST — extracted ${goldK}k gold!`
        : `💀 VAULT HEIST in progress — ${goldK}k gold extracted`;

    const bannerW = Math.min(480, w - 32);
    const bx = (w - bannerW) / 2;
    const by = h * 0.3;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Vignette for victim
    if (isVictim) {
      const vg = ctx.createRadialGradient(
        w / 2,
        h / 2,
        h * 0.15,
        w / 2,
        h / 2,
        h * 0.7,
      );
      vg.addColorStop(0, "rgba(220, 38, 38, 0)");
      vg.addColorStop(1, `rgba(185, 28, 28, ${alpha * 0.4})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.fillStyle = "rgba(2, 6, 23, 0.93)";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bannerW, 42, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.font = `bold 14px Overpass, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(headline, w / 2, by + 26);

    ctx.restore();
  }

  private drawBountyBoard(ctx: CanvasRenderingContext2D): void {
    const now = this.game.ticks();

    // Bounty collected flash
    if (this.bountyCollectedTick >= 0 && this.bountyCollectedData) {
      const elapsed = now - this.bountyCollectedTick;
      if (elapsed < this.bountyCollectedAlertTicks) {
        const fadeOut = 12;
        const holdEnd = this.bountyCollectedAlertTicks - fadeOut;
        let alpha =
          elapsed < 6
            ? elapsed / 6
            : elapsed > holdEnd
              ? 1 - (elapsed - holdEnd) / fadeOut
              : 1;
        alpha = Math.max(0, Math.min(1, alpha));

        const w = ctx.canvas.width;
        const myID = this.game.myPlayer()?.smallID();
        const isCollector = this.bountyCollectedData.collectorPlayerID === myID;
        const goldK = Math.round(this.bountyCollectedData.rewardGold / 1000);
        const msg = isCollector
          ? `🏆 BOUNTY CLAIMED — +${goldK}k gold!`
          : `🎯 Bounty collected — ${goldK}k gold paid out`;

        const bannerW = Math.min(420, w - 32);
        const bx = (w - bannerW) / 2;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(2, 6, 23, 0.92)";
        ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(bx, 72, bannerW, 36, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(253, 224, 71, 0.97)";
        ctx.font = `bold 13px Overpass, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(msg, w / 2, 96);
        ctx.restore();
      }
    }

    // Persistent bounty card (top-right)
    if (!this.activeBounty) return;
    if (now >= this.activeBounty.expiresAtTick) {
      this.activeBounty = null;
      return;
    }

    const w = ctx.canvas.width;
    const cardW = 180;
    const cardH = 52;
    const cx = w - cardW - 8;
    const cy = 8;
    const secsLeft = Math.max(
      0,
      Math.ceil((this.activeBounty.expiresAtTick - now) / 10),
    );
    const goldK = Math.round(this.activeBounty.rewardGold / 1000);

    const myID = this.game.myPlayer()?.smallID();
    const isTarget = this.activeBounty.targetPlayerID === myID;

    ctx.save();
    ctx.fillStyle = isTarget
      ? "rgba(127, 29, 29, 0.9)"
      : "rgba(2, 6, 23, 0.92)";
    ctx.strokeStyle = isTarget
      ? "rgba(252, 165, 165, 0.8)"
      : "rgba(251, 191, 36, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cardW, cardH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isTarget
      ? "rgba(252, 165, 165, 0.95)"
      : "rgba(251, 191, 36, 0.95)";
    ctx.font = `bold 10px Overpass, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(
      isTarget ? "🎯 BOUNTY ON YOU" : "🎯 BOUNTY ACTIVE",
      cx + 8,
      cy + 14,
    );

    ctx.fillStyle = "rgba(248, 250, 252, 0.9)";
    ctx.font = `bold 13px Overpass, sans-serif`;
    ctx.fillText(`${goldK}k per intercept`, cx + 8, cy + 30);

    ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
    ctx.font = `9px Overpass, sans-serif`;
    ctx.fillText(
      `${this.activeBounty.chargesLeft} charges • ${secsLeft}s`,
      cx + 8,
      cy + 44,
    );
    ctx.restore();
  }

  private drawWarchestBanner(ctx: CanvasRenderingContext2D): void {
    if (!this.warchestHunt || this.warchestShownAtTick < 0) return;
    const now = this.game.ticks();
    const elapsed = now - this.warchestShownAtTick;
    if (elapsed > this.warchestBannerTicks) return;

    const fadeIn = 8;
    const fadeOut = 14;
    const holdEnd = this.warchestBannerTicks - fadeOut;
    let alpha =
      elapsed < fadeIn
        ? elapsed / fadeIn
        : elapsed > holdEnd
          ? 1 - (elapsed - holdEnd) / fadeOut
          : 1;
    alpha = Math.max(0, Math.min(1, alpha));

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const myID = this.game.myPlayer()?.smallID();
    const isMark = this.warchestHunt.markPlayerID === myID;
    const secsLeft = Math.max(
      0,
      Math.ceil(this.warchestHunt.durationTicks / 10),
    );

    const accent = isMark
      ? "rgba(248, 113, 113, 0.9)"
      : "rgba(250, 204, 21, 0.9)";
    const headline = isMark
      ? `👑 YOU ARE THE WARCHEST MARK — ${secsLeft}s`
      : `⛏ WARCHEST HUNT — gold leader marked for ${secsLeft}s`;
    const sub = isMark
      ? "Opponents earn 2× intercept bonus targeting your convoys — defend!"
      : `Intercepts on the mark pay ${this.warchestHunt.interceptMultiplier}× gold — strike now`;

    const bannerW = Math.min(500, w - 32);
    const bx = (w - bannerW) / 2;
    const by = isMark ? h * 0.28 : 16;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (isMark) {
      const vg = ctx.createRadialGradient(
        w / 2,
        h / 2,
        h * 0.1,
        w / 2,
        h / 2,
        h * 0.65,
      );
      vg.addColorStop(0, "rgba(220, 38, 38, 0)");
      vg.addColorStop(1, `rgba(153, 27, 27, ${alpha * 0.35})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.fillStyle = "rgba(2, 6, 23, 0.92)";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bannerW, 56, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.font = `bold 14px Overpass, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(headline, w / 2, by + 20);

    ctx.fillStyle = "rgba(203, 213, 225, 0.85)";
    ctx.font = `10px Overpass, sans-serif`;
    ctx.fillText(sub, w / 2, by + 38);

    ctx.restore();
  }

  /**
   * Surge Chronicle — cinematic full-screen flash on surge entry for local player.
   * Fades in over 8 ticks, holds, then fades out. Paired with the amber territory
   * glow (drawSurgeOverlays) and the persistent surge HUD badge (drawSurgeHUD).
   */
  private drawSurgeChronicle(ctx: CanvasRenderingContext2D): void {
    if (this.surgeChronicleEntryTick < 0) return;
    const now = this.game.ticks();
    const elapsed = now - this.surgeChronicleEntryTick;
    if (elapsed > this.surgeChronicleFlashTicks) return;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const fadeIn = 8;
    const fadeOut = 10;
    const holdEnd = this.surgeChronicleFlashTicks - fadeOut;
    let alpha: number;
    if (elapsed < fadeIn) {
      alpha = elapsed / fadeIn;
    } else if (elapsed > holdEnd) {
      alpha = 1 - (elapsed - holdEnd) / fadeOut;
    } else {
      alpha = 1;
    }
    alpha = Math.max(0, Math.min(1, alpha));

    ctx.save();

    // Edge vignette burst — amber radial gradient from all four corners
    const cornerGrad = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.25,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.8,
    );
    cornerGrad.addColorStop(0, `rgba(251, 146, 60, 0)`);
    cornerGrad.addColorStop(0.6, `rgba(245, 158, 11, ${alpha * 0.18})`);
    cornerGrad.addColorStop(1, `rgba(234, 88, 12, ${alpha * 0.45})`);
    ctx.fillStyle = cornerGrad;
    ctx.fillRect(0, 0, w, h);

    // Central banner
    if (elapsed < holdEnd + 5) {
      const bannerY = h * 0.38;
      const textAlpha = alpha * 0.95;

      ctx.shadowColor = `rgba(251, 146, 60, ${textAlpha * 0.9})`;
      ctx.shadowBlur = 24;
      ctx.fillStyle = `rgba(254, 215, 170, ${textAlpha})`;
      ctx.font = `bold ${Math.round(h * 0.055)}px Overpass, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("⚡ COMEBACK SURGE", w / 2, bannerY);

      ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(253, 186, 116, ${textAlpha * 0.85})`;
      ctx.font = `${Math.round(h * 0.026)}px Overpass, sans-serif`;
      ctx.fillText(
        "+CONVOY GOLD  +CAPTURE BONUS  +INTERCEPT MULTIPLIER",
        w / 2,
        bannerY + Math.round(h * 0.042),
      );

      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  /**
   * Full-width alert banner shown to all players when Last Stand activates —
   * one player controls 5+ vault sites and opponents receive a gold multiplier.
   * Crimson color scheme to signal threat; fades in/holds/fades out over 5s.
   */
  private drawLastStandBanner(ctx: CanvasRenderingContext2D): void {
    if (this.lastStandActivatedAtTick < 0 || !this.lastStandData) return;
    const now = this.game.ticks();
    const elapsed = now - this.lastStandActivatedAtTick;
    if (elapsed > this.lastStandBannerTicks) return;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const fadeIn = 6;
    const fadeOut = 12;
    const holdEnd = this.lastStandBannerTicks - fadeOut;
    let alpha: number;
    if (elapsed < fadeIn) {
      alpha = elapsed / fadeIn;
    } else if (elapsed > holdEnd) {
      alpha = 1 - (elapsed - holdEnd) / fadeOut;
    } else {
      alpha = 1;
    }
    alpha = Math.max(0, Math.min(1, alpha));

    ctx.save();

    // Red edge vignette
    const vignette = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.2,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.85,
    );
    vignette.addColorStop(0, `rgba(185, 28, 28, 0)`);
    vignette.addColorStop(0.65, `rgba(185, 28, 28, ${alpha * 0.15})`);
    vignette.addColorStop(1, `rgba(220, 38, 38, ${alpha * 0.5})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // Banner panel
    const bannerH = Math.round(h * 0.14);
    const bannerY = Math.round(h * 0.44);
    ctx.fillStyle = `rgba(30, 0, 0, ${alpha * 0.82})`;
    ctx.fillRect(0, bannerY, w, bannerH);

    // Top/bottom accent lines
    ctx.strokeStyle = `rgba(220, 38, 38, ${alpha * 0.9})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, bannerY);
    ctx.lineTo(w, bannerY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, bannerY + bannerH);
    ctx.lineTo(w, bannerY + bannerH);
    ctx.stroke();

    // Headline
    ctx.textAlign = "center";
    ctx.shadowColor = `rgba(239, 68, 68, ${alpha * 0.9})`;
    ctx.shadowBlur = 20;
    ctx.fillStyle = `rgba(254, 202, 202, ${alpha})`;
    ctx.font = `bold ${Math.round(h * 0.048)}px Overpass, sans-serif`;
    const triggerPlayer = this.game.playerBySmallID(
      this.lastStandData.triggerPlayerID,
    );
    const triggerName = triggerPlayer?.isPlayer()
      ? triggerPlayer.name()
      : "A player";
    ctx.fillText(
      `🚨 LAST STAND — ${triggerName} holds ${this.lastStandData.siteCount} vaults!`,
      w / 2,
      bannerY + Math.round(bannerH * 0.48),
    );

    // Subtitle
    ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(252, 165, 165, ${alpha * 0.85})`;
    ctx.font = `${Math.round(h * 0.024)}px Overpass, sans-serif`;
    const pct = Math.round(
      (this.lastStandData.opponentGoldMultiplier - 1) * 100,
    );
    ctx.fillText(
      `All opponents receive +${pct}% convoy gold for ${Math.round(this.lastStandData.bonusDurationTicks / 10)}s`,
      w / 2,
      bannerY + Math.round(bannerH * 0.78),
    );

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /**
   * Pulsing amber territory glow for each player currently in comeback surge.
   * Drawn beneath all other overlays so it doesn't obscure icons or text.
   */
  private drawSurgeOverlays(ctx: CanvasRenderingContext2D): void {
    if (!this.status) return;
    const now = this.game.ticks();
    const pulse = surgeOverlayPulse(now, this.prefersReducedMotion());
    const radius = Math.max(60, this.transform.scale * 28);

    for (const [smallIDStr, surgeState] of Object.entries(this.status.surges)) {
      if (!surgeState.active || surgeState.surgeUntilTick <= now) continue;

      const player = this.game.playerBySmallID(Number(smallIDStr));
      if (!player || !("nameLocation" in player)) continue;

      const loc = (
        player as { nameLocation(): { x: number; y: number } }
      ).nameLocation();
      const screen = this.transform.worldToScreenCoordinates(
        new Cell(loc.x, loc.y),
      );
      if (!screen) continue;

      const gradient = ctx.createRadialGradient(
        screen.x,
        screen.y,
        radius * 0.1,
        screen.x,
        screen.y,
        radius,
      );
      gradient.addColorStop(0, `rgba(251, 146, 60, ${pulse * 0.55})`);
      gradient.addColorStop(0.5, `rgba(245, 158, 11, ${pulse * 0.28})`);
      gradient.addColorStop(1, `rgba(251, 146, 60, 0)`);

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private markerSize(): number {
    return Math.max(4, Math.min(12, this.transform.scale * 2.8));
  }

  private fontSize(): number {
    return Math.max(10, Math.min(18, this.transform.scale * 4.4));
  }

  /** Called by external code (e.g. Api response handler) to show an intel result. */
  showIntelTooltip(routeRisk: number, interceptProbability: number): void {
    this.intelTooltip = {
      routeRisk,
      interceptProbability,
      shownAtTick: this.game.ticks(),
    };
  }

  private drawIntelTooltip(ctx: CanvasRenderingContext2D): void {
    if (!this.intelTooltip) return;
    const age = this.game.ticks() - this.intelTooltip.shownAtTick;
    if (age >= this.INTEL_TOOLTIP_TICKS) {
      this.intelTooltip = null;
      return;
    }
    const alpha = age < 10 ? age / 10 : age > 100 ? (120 - age) / 20 : 1;
    const { routeRisk, interceptProbability } = this.intelTooltip;
    const riskPct = Math.round(routeRisk * 100);
    const interceptPct = Math.round(interceptProbability * 100);
    const riskColor =
      routeRisk > 0.6 ? "#f87171" : routeRisk > 0.35 ? "#fbbf24" : "#4ade80";

    const cw = ctx.canvas.width;
    const bw = 220;
    const bh = 60;
    const bx = cw - bw - 16;
    const by = 80;

    ctx.save();
    ctx.globalAlpha = alpha * 0.92;
    ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
    ctx.strokeStyle = "rgba(99, 102, 241, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.font = "bold 11px sans-serif";
    ctx.fillStyle = "#a5b4fc";
    ctx.fillText("Route Intel", bx + 10, by + 18);

    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(`Route Risk: `, bx + 10, by + 36);
    ctx.fillStyle = riskColor;
    ctx.fillText(`${riskPct}%`, bx + 90, by + 36);

    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(`Intercept: `, bx + 10, by + 52);
    ctx.fillStyle = riskColor;
    ctx.fillText(`${interceptPct}%`, bx + 80, by + 52);
    ctx.restore();
  }
}
