import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import {
  GameUpdateType,
  VaultFrontActivityUpdate,
  VaultFrontConvoyState,
  VaultFrontStatusUpdate,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import {
  DailyChallenge,
  fetchDailyChallenge,
  fetchVaultFrontPlaytestPulseSummary,
  type MasteryDoctrineId,
  selectMasteryDoctrine,
  VaultFrontPlaytestPulseSummary,
} from "../../Api";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { PauseGameIntentEvent, SendWinnerEvent } from "../../Transport";
import { translateText } from "../../Utils";
import {
  applyGlobalHudScale,
  dispatchHudLayoutUpdate,
  HUD_LAYOUT_EVENT,
  readHudLayout,
  writeHudLayout,
} from "../HudLayout";
import { logHudTelemetry } from "../HudTelemetry";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { Layer } from "./Layer";
import { GoToPositionEvent } from "./Leaderboard";
import { ShowReplayPanelEvent } from "./ReplayPanel";
import { ShowSettingsModalEvent } from "./SettingsModal";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
import exitIcon from "/images/ExitIconWhite.svg?url";
import FastForwardIconSolid from "/images/FastForwardIconSolidWhite.svg?url";
import pauseIcon from "/images/PauseIconWhite.svg?url";
import playIcon from "/images/PlayIconWhite.svg?url";
import settingsIcon from "/images/SettingIconWhite.svg?url";

@customElement("game-right-sidebar")
export class GameRightSidebar extends LitElement implements Layer {
  private static readonly MAJOR_TIMELINE_ACTIVITIES = new Set([
    "vault_captured",
    "vault_passive_income",
    "convoy_intercepted",
    "convoy_delivered",
    "beacon_pulse",
    "jam_breaker",
    "comeback_surge",
  ]);
  private static readonly VAULT_FEED_MAX_ITEMS = 4;
  private static readonly VAULT_FEED_TTL_TICKS = 260;
  private static readonly PASSIVE_FEED_MERGE_WINDOW_TICKS = 240;
  private static readonly FEED_PRIORITY_SELF = 4;
  private static readonly FEED_PRIORITY_ALLY = 3;
  private static readonly FEED_PRIORITY_GLOBAL = 2;
  private static readonly FEED_PRIORITY_GLOBAL_PASSIVE = 1;
  private static readonly OBJECTIVE_RAIL_MAX_ITEMS = 3;
  private static readonly VAULT_DEBUG_STORAGE_KEY = "vaultfront.debug";
  private static readonly VAULT_DEBUG_EVENT = "vaultfront-debug-toggle";
  // Frozen Vault feed rules: self > ally > global, passive income merges briefly, feed stays short-lived.

  public game: GameView;
  public eventBus: EventBus;

  @state()
  private _isSinglePlayer: boolean = false;

  @state()
  private _isReplayVisible: boolean = false;

  @state()
  private _isVisible: boolean = true;

  @state()
  private isPaused: boolean = false;

  @state()
  private timer: number = 0;

  @state()
  private vaultTimeline: Array<{
    tick: number;
    label: string;
    tile?: number;
    activity: VaultFrontActivityUpdate["activity"];
  }> = [];

  @state()
  private kpiPanelVisible = false;

  @state()
  private timelineExpanded = true;

  @state()
  private timelineFilters: Record<
    "captures" | "convoys" | "pulses" | "surge",
    boolean
  > = {
    captures: true,
    convoys: true,
    pulses: true,
    surge: true,
  };

  @state()
  private latestVaultStatus: VaultFrontStatusUpdate | null = null;

  @state()
  private hudEditMode = false;

  @state()
  private hudScale = 1;

  @state()
  private dockOffsetX = 0;

  @state()
  private dockOffsetY = 0;

  @state()
  private recentVaultFeed: Array<{
    key: string;
    tick: number;
    tile?: number;
    label: string;
    activity: VaultFrontActivityUpdate["activity"];
    audience: "self" | "ally" | "global";
    priority: number;
    count?: number;
  }> = [];

  @state()
  private vaultDebugActive = false;

  @state()
  private dailyChallenge: DailyChallenge | null = null;

  @state()
  private masterySelectionPending: MasteryDoctrineId | null = null;

  @state()
  private masterySelectionNotice = "";

  @state()
  private playtestPulse: VaultFrontPlaytestPulseSummary | null = null;
  private playtestPulseLastFetchAt = 0;
  private readonly PULSE_FETCH_INTERVAL_MS = 5 * 60 * 1000;

  private hasWinner = false;
  private isLobbyCreator = false;
  private spawnBarVisible = false;
  private immunityBarVisible = false;
  private draggingDock = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragBaseX = 0;
  private dragBaseY = 0;
  private lastVaultRiskBySite = new Map<number, string>();

  private viewportWidth(): number {
    return typeof window !== "undefined" ? window.innerWidth : 1920;
  }

  createRenderRoot() {
    return this;
  }

  init() {
    this._isSinglePlayer =
      this.game?.config()?.gameConfig()?.gameType === GameType.Singleplayer ||
      this.game.config().isReplay();
    this._isVisible = true;
    this.game.inSpawnPhase();
    sessionStorage.removeItem("vaultfront.matchTimeline");
    this.vaultDebugActive =
      localStorage.getItem(GameRightSidebar.VAULT_DEBUG_STORAGE_KEY) === "1" ||
      sessionStorage.getItem(GameRightSidebar.VAULT_DEBUG_STORAGE_KEY) === "1";
    this.kpiPanelVisible = localStorage.getItem("vaultfront.kpi.panel") === "1";
    this.timelineExpanded = this.viewportWidth() >= 1200;
    this.loadHudLayout();
    applyGlobalHudScale(this.hudScale);
    window.addEventListener(
      HUD_LAYOUT_EVENT,
      this.onHudLayoutUpdated as EventListener,
    );

    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
      this.updateParentOffset();
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
      this.updateParentOffset();
    });

    this.eventBus.on(SendWinnerEvent, () => {
      this.hasWinner = true;
      this.refreshDailyMastery(1_000);
      this.requestUpdate();
    });

    this.refreshDailyMastery();

    this.requestUpdate();
  }
  private refreshDailyMastery(delayMs = 0): void {
    window.setTimeout(() => {
      void fetchDailyChallenge().then((challenge) => {
        if (!challenge) return;
        this.dailyChallenge = challenge;
        this.requestUpdate();
      });
    }, delayMs);
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    // Timer logic
    // Check if the player is the lobby creator
    if (!this.isLobbyCreator && this.game.myPlayer()?.isLobbyCreator()) {
      this.isLobbyCreator = true;
      this.requestUpdate();
    }

    const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
    const spawnPhaseTurns = this.game.config().numSpawnPhaseTurns();
    const ticks = this.game.ticks();
    const gameTicks = Math.max(0, ticks - spawnPhaseTurns);
    const elapsedSeconds = Math.floor(gameTicks / 10); // 10 ticks per second

    if (this.game.inSpawnPhase()) {
      this.timer = maxTimerValue !== undefined ? maxTimerValue * 60 : 0;
      return;
    }

    if (this.hasWinner) {
      return;
    }

    if (maxTimerValue !== undefined) {
      this.timer = Math.max(0, maxTimerValue * 60 - elapsedSeconds);
    } else {
      this.timer = elapsedSeconds;
    }

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      const statusUpdates = updates[
        GameUpdateType.VaultFrontStatus
      ] as VaultFrontStatusUpdate[];
      if (statusUpdates.length > 0) {
        this.latestVaultStatus = statusUpdates[statusUpdates.length - 1];
      }
      const activityUpdates = updates[
        GameUpdateType.VaultFrontActivity
      ] as VaultFrontActivityUpdate[];
      const majorActivityUpdates = activityUpdates.filter((entry) =>
        GameRightSidebar.MAJOR_TIMELINE_ACTIVITIES.has(entry.activity),
      );
      if (majorActivityUpdates.length > 0) {
        const now = this.game.ticks();
        const appended = majorActivityUpdates.map((entry) => ({
          tick: now,
          label: entry.label,
          tile: entry.tile,
          activity: entry.activity,
        }));
        this.vaultTimeline = [...this.vaultTimeline, ...appended].slice(-10);
        this.persistTimelineEvents(now, majorActivityUpdates);
      }
      if (activityUpdates.length > 0) {
        this.appendVaultFeed(activityUpdates, this.game.ticks());
      }
    }
    this.pruneVaultFeed(this.game.ticks());
  }

  private feedAudience(
    entry: VaultFrontActivityUpdate,
  ): "self" | "ally" | "global" {
    const me = this.game.myPlayer();
    if (!me) return "global";
    if (
      entry.sourcePlayerID === me.smallID() ||
      entry.targetPlayerID === me.smallID()
    ) {
      return "self";
    }
    for (const id of [entry.sourcePlayerID, entry.targetPlayerID]) {
      if (id === null) continue;
      const player = this.game.playerBySmallID(id);
      if (player?.isPlayer() && me.isFriendly(player)) {
        return "ally";
      }
    }
    return "global";
  }

  private feedPriority(entry: VaultFrontActivityUpdate): number {
    const audience = this.feedAudience(entry);
    if (audience === "self") return GameRightSidebar.FEED_PRIORITY_SELF;
    if (audience === "ally") return GameRightSidebar.FEED_PRIORITY_ALLY;
    if (entry.activity === "vault_passive_income") {
      return GameRightSidebar.FEED_PRIORITY_GLOBAL_PASSIVE;
    }
    return GameRightSidebar.FEED_PRIORITY_GLOBAL;
  }

  private mergePassiveFeedLabel(
    existing: string,
    next: string,
    count: number,
  ): string {
    const goldMatch = /\+([\d,]+)g/.exec(next);
    const gold = goldMatch ? goldMatch[1] : null;
    if (gold) {
      return `Passive income +${gold}g x${count}`;
    }
    return existing;
  }

  private pruneVaultFeed(now: number): void {
    this.recentVaultFeed = this.recentVaultFeed.filter(
      (entry) => now - entry.tick <= GameRightSidebar.VAULT_FEED_TTL_TICKS,
    );
  }

  private appendVaultFeed(
    updates: VaultFrontActivityUpdate[],
    now: number,
  ): void {
    let feed = this.recentVaultFeed.filter(
      (entry) => now - entry.tick <= GameRightSidebar.VAULT_FEED_TTL_TICKS,
    );
    for (const entry of updates) {
      if (
        entry.activity !== "vault_passive_income" &&
        entry.activity !== "convoy_delivered" &&
        entry.activity !== "convoy_intercepted" &&
        entry.activity !== "vault_captured" &&
        entry.activity !== "jam_breaker" &&
        entry.activity !== "beacon_pulse"
      ) {
        continue;
      }

      const audience = this.feedAudience(entry);
      const priority = this.feedPriority(entry);
      const last = feed[feed.length - 1];
      if (
        last &&
        last.activity === "vault_passive_income" &&
        entry.activity === "vault_passive_income" &&
        last.priority === priority &&
        last.audience === audience &&
        now - last.tick <= GameRightSidebar.PASSIVE_FEED_MERGE_WINDOW_TICKS
      ) {
        const nextCount = (last.count ?? 1) + 1;
        last.tick = now;
        last.count = nextCount;
        last.label = this.mergePassiveFeedLabel(
          last.label,
          entry.label,
          nextCount,
        );
        last.tile = entry.tile;
        continue;
      }

      feed.push({
        key: `${entry.activity}-${now}-${feed.length}`,
        tick: now,
        tile: entry.tile,
        label: entry.label,
        activity: entry.activity,
        audience,
        priority,
      });
    }

    feed = feed
      .sort((a, b) => b.priority - a.priority || b.tick - a.tick)
      .slice(0, GameRightSidebar.VAULT_FEED_MAX_ITEMS)
      .sort((a, b) => a.tick - b.tick);
    this.recentVaultFeed = feed;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(
      HUD_LAYOUT_EVENT,
      this.onHudLayoutUpdated as EventListener,
    );
    window.removeEventListener("pointermove", this.onDockDragMove);
    window.removeEventListener("pointerup", this.onDockDragEnd);
  }

  private persistTimelineEvents(
    tick: number,
    updates: VaultFrontActivityUpdate[],
  ): void {
    const key = "vaultfront.matchTimeline";
    let events: Array<{
      tick: number;
      activity: string;
      tile?: number;
      label: string;
      sourcePlayerID: number | null;
      targetPlayerID: number | null;
    }> = [];
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        events = JSON.parse(raw) as typeof events;
      } catch {
        events = [];
      }
    }
    for (const entry of updates) {
      events.push({
        tick,
        activity: entry.activity,
        tile: entry.tile,
        label: entry.label,
        sourcePlayerID: entry.sourcePlayerID,
        targetPlayerID: entry.targetPlayerID,
      });
    }
    sessionStorage.setItem(key, JSON.stringify(events.slice(-60)));
  }

  private toggleKpiPanel(): void {
    this.kpiPanelVisible = !this.kpiPanelVisible;
    localStorage.setItem(
      "vaultfront.kpi.panel",
      this.kpiPanelVisible ? "1" : "0",
    );
    logHudTelemetry("hud_kpi_panel_toggle", { visible: this.kpiPanelVisible });
    if (this.kpiPanelVisible) void this.refreshPlaytestPulse();
  }

  private async refreshPlaytestPulse(): Promise<void> {
    const now = Date.now();
    if (now - this.playtestPulseLastFetchAt < this.PULSE_FETCH_INTERVAL_MS)
      return;
    this.playtestPulseLastFetchAt = now;
    const result = await fetchVaultFrontPlaytestPulseSummary();
    if (result) this.playtestPulse = result;
  }

  private toggleVaultDebug(): void {
    this.vaultDebugActive = !this.vaultDebugActive;
    sessionStorage.setItem(
      GameRightSidebar.VAULT_DEBUG_STORAGE_KEY,
      this.vaultDebugActive ? "1" : "0",
    );
    localStorage.setItem(
      GameRightSidebar.VAULT_DEBUG_STORAGE_KEY,
      this.vaultDebugActive ? "1" : "0",
    );
    window.dispatchEvent(
      new CustomEvent<{ enabled: boolean }>(
        GameRightSidebar.VAULT_DEBUG_EVENT,
        {
          detail: { enabled: this.vaultDebugActive },
        },
      ),
    );
    logHudTelemetry("hud_vault_debug_toggle", {
      enabled: this.vaultDebugActive,
    });
  }

  private toggleTimeline(): void {
    this.timelineExpanded = !this.timelineExpanded;
    logHudTelemetry("hud_timeline_toggle", { visible: this.timelineExpanded });
  }

  private timelineCategory(
    activity: VaultFrontActivityUpdate["activity"],
  ): "captures" | "convoys" | "pulses" | "surge" {
    if (activity === "vault_captured" || activity === "vault_passive_income") {
      return "captures";
    }
    if (activity === "comeback_surge") return "surge";
    if (activity === "beacon_pulse" || activity === "jam_breaker") {
      return "pulses";
    }
    return "convoys";
  }

  private isTerritoryNearVault(tile: number, myID: number): boolean {
    const tx = this.game.x(tile);
    const ty = this.game.y(tile);
    const range = 24;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > range) continue;
        const sx = Math.max(0, Math.min(this.game.width() - 1, tx + dx));
        const sy = Math.max(0, Math.min(this.game.height() - 1, ty + dy));
        const owner = this.game.owner(this.game.ref(sx, sy));
        if (owner.isPlayer() && owner.smallID() === myID) {
          return true;
        }
      }
    }
    return false;
  }

  private vaultRiskTag(tile: number, myID: number): "Low" | "Medium" | "High" {
    const me = this.game.myPlayer();
    if (!me || me.smallID() !== myID) return "Low";
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    let hostile = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (dx === 0 && dy === 0) continue;
        const sx = Math.max(0, Math.min(this.game.width() - 1, x + dx));
        const sy = Math.max(0, Math.min(this.game.height() - 1, y + dy));
        const owner = this.game.owner(this.game.ref(sx, sy));
        if (!owner.isPlayer()) continue;
        if (owner.smallID() !== myID && !me.isFriendly(owner)) {
          hostile++;
        }
      }
    }
    if (hostile >= 7) return "High";
    if (hostile >= 3) return "Medium";
    return "Low";
  }

  private vaultRiskTrend(
    siteID: number,
    risk: "Low" | "Medium" | "High",
  ): string {
    const previous = this.lastVaultRiskBySite.get(siteID) ?? risk;
    this.lastVaultRiskBySite.set(siteID, risk);
    if (previous === risk) return "steady";
    if (
      (risk === "High" && previous !== "High") ||
      (risk === "Medium" && previous === "Low")
    ) {
      return "rising";
    }
    return "falling";
  }

  private toggleTimelineFilter(
    category: "captures" | "convoys" | "pulses" | "surge",
  ): void {
    this.timelineFilters = {
      ...this.timelineFilters,
      [category]: !this.timelineFilters[category],
    };
    logHudTelemetry("hud_timeline_filter_toggle", {
      category,
      enabled: this.timelineFilters[category],
    });
  }

  private onHudLayoutUpdated = (event: CustomEvent): void => {
    this.applyHudLayout(event.detail ?? {});
  };

  private applyHudLayout(layout: ReturnType<typeof readHudLayout>): void {
    this.hudEditMode = layout.editMode === true;
    this.hudScale = applyGlobalHudScale(layout.uiScale ?? this.hudScale);
    this.dockOffsetX = Number(layout.rightDockOffsetX ?? this.dockOffsetX ?? 0);
    this.dockOffsetY = Number(layout.rightDockOffsetY ?? this.dockOffsetY ?? 0);
  }

  private loadHudLayout(): void {
    this.applyHudLayout(readHudLayout());
  }

  private persistHudLayout(patch: Parameters<typeof writeHudLayout>[0]): void {
    const next = writeHudLayout(patch);
    this.applyHudLayout(next);
    dispatchHudLayoutUpdate(next);
  }

  private onDockDragStart = (event: PointerEvent): void => {
    if (!this.hudEditMode) return;
    event.preventDefault();
    this.draggingDock = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragBaseX = this.dockOffsetX;
    this.dragBaseY = this.dockOffsetY;
    window.addEventListener("pointermove", this.onDockDragMove);
    window.addEventListener("pointerup", this.onDockDragEnd);
  };

  private onDockDragMove = (event: PointerEvent): void => {
    if (!this.draggingDock) return;
    this.dockOffsetX = this.dragBaseX + (event.clientX - this.dragStartX);
    this.dockOffsetY = this.dragBaseY + (event.clientY - this.dragStartY);
  };

  private onDockDragEnd = (): void => {
    if (!this.draggingDock) return;
    this.draggingDock = false;
    this.persistHudLayout({
      rightDockOffsetX: Math.round(this.dockOffsetX),
      rightDockOffsetY: Math.round(this.dockOffsetY),
    });
    logHudTelemetry("hud_right_dock_drag");
    window.removeEventListener("pointermove", this.onDockDragMove);
    window.removeEventListener("pointerup", this.onDockDragEnd);
  };

  private kpiNumber(key: string): number {
    return Number(localStorage.getItem(key) ?? "0");
  }

  private kpiPercent(numerator: number, denominator: number): string {
    if (denominator <= 0) return "0%";
    const pct = Math.max(0, Math.min(100, (numerator / denominator) * 100));
    return `${pct.toFixed(1)}%`;
  }

  private renderKpiPanel() {
    if (!this.kpiPanelVisible) return null;
    const matches = this.kpiNumber("vaultfront.kpi.matches");
    const retentionHits = this.kpiNumber("vaultfront.kpi.nextMatchRetention");
    const behindMatches = this.kpiNumber("vaultfront.kpi.minute8BehindMatches");
    const comebackWins = this.kpiNumber(
      "vaultfront.kpi.comebackWinsFromBehind",
    );
    const firstInterceptSum = this.kpiNumber(
      "vaultfront.kpi.firstInterceptTimeSum",
    );
    const firstInterceptSamples = this.kpiNumber(
      "vaultfront.kpi.firstInterceptSamples",
    );
    const onboardingShown = this.kpiNumber("vaultfront.kpi.onboardingShown");
    const onboardingCompleted = this.kpiNumber(
      "vaultfront.kpi.onboardingCompleted",
    );
    const dockTopExposure = this.kpiNumber(
      "vaultfront.kpi.hud.hud_ab_dock_exposure_top",
    );
    const dockStackExposure = this.kpiNumber(
      "vaultfront.kpi.hud.hud_ab_dock_exposure_stack",
    );
    const dockTopObjective = this.kpiNumber(
      "vaultfront.kpi.hud.hud_left_leaderboard_open_top",
    );
    const dockStackObjective = this.kpiNumber(
      "vaultfront.kpi.hud.hud_left_leaderboard_open_stack",
    );
    const noticeJumps = this.kpiNumber(
      "vaultfront.kpi.hud.hud_vault_notice_jump",
    );
    const railJumps = this.kpiNumber(
      "vaultfront.kpi.hud.hud_objective_rail_click",
    );
    const timelineJumps = this.kpiNumber(
      "vaultfront.kpi.hud.hud_timeline_jump",
    );
    const avgFirstIntercept =
      firstInterceptSamples > 0
        ? `${(firstInterceptSum / firstInterceptSamples).toFixed(1)}s`
        : "n/a";
    return html`
      <div
        class="fixed right-2 top-16 z-[1200] w-64 rounded-md border border-cyan-400/45 bg-slate-900/88 p-2 text-[11px] text-cyan-50 shadow-lg"
      >
        <div class="font-semibold text-cyan-200 mb-1">VaultFront KPI</div>
        <div class="flex justify-between">
          <span>Retention Proxy</span
          ><span>${this.kpiPercent(retentionHits, Math.max(1, matches))}</span>
        </div>
        <div class="flex justify-between">
          <span>Comeback Rate</span
          ><span>${this.kpiPercent(comebackWins, behindMatches)}</span>
        </div>
        <div class="flex justify-between">
          <span>Avg First Intercept</span><span>${avgFirstIntercept}</span>
        </div>
        <div class="flex justify-between">
          <span>Onboarding Complete</span
          ><span>${this.kpiPercent(onboardingCompleted, onboardingShown)}</span>
        </div>
        <div class="mt-1 border-t border-cyan-300/20 pt-1">
          <div class="text-cyan-200/85">Dock A/B</div>
          <div class="flex justify-between">
            <span>Exposure T/S</span
            ><span>${dockTopExposure}/${dockStackExposure}</span>
          </div>
          <div class="flex justify-between">
            <span>Obj Opens T/S</span
            ><span>${dockTopObjective}/${dockStackObjective}</span>
          </div>
        </div>
        <div class="mt-1 border-t border-cyan-300/20 pt-1">
          <div class="text-cyan-200/85">HUD Jumps</div>
          <div class="flex justify-between">
            <span>Notices</span><span>${noticeJumps}</span>
          </div>
          <div class="flex justify-between">
            <span>Objective Rail</span><span>${railJumps}</span>
          </div>
          <div class="flex justify-between">
            <span>Timeline</span><span>${timelineJumps}</span>
          </div>
        </div>
        ${this.renderPlaytestPulseTile()} ${this.renderSessionStatsTile()}
      </div>
    `;
  }

  private renderSessionStatsTile() {
    const matches = this.kpiNumber("vaultfront.kpi.matches");
    const firstInterceptSum = this.kpiNumber(
      "vaultfront.kpi.firstInterceptTimeSum",
    );
    const firstInterceptSamples = this.kpiNumber(
      "vaultfront.kpi.firstInterceptSamples",
    );
    const comebackWins = this.kpiNumber(
      "vaultfront.kpi.comebackWinsFromBehind",
    );
    const behindMatches = this.kpiNumber("vaultfront.kpi.minute8BehindMatches");
    const currentElo = Number(
      localStorage.getItem("vaultfront.lastElo") ?? "0",
    );

    const avgIntercept =
      firstInterceptSamples > 0
        ? `${(firstInterceptSum / firstInterceptSamples).toFixed(1)}s`
        : "—";
    const comebackRate =
      behindMatches > 0
        ? `${Math.round((comebackWins / behindMatches) * 100)}%`
        : "—";
    const eloLabel = currentElo > 0 ? String(currentElo) : "—";

    return html`
      <div class="mt-1 border-t border-cyan-300/20 pt-1">
        <div class="text-cyan-200/85">My Session</div>
        <div class="flex justify-between">
          <span>Matches played</span><span>${matches}</span>
        </div>
        <div class="flex justify-between">
          <span>Avg 1st intercept</span><span>${avgIntercept}</span>
        </div>
        <div class="flex justify-between">
          <span>Comeback rate</span><span>${comebackRate}</span>
        </div>
        <div class="flex justify-between">
          <span>Current Elo</span><span>${eloLabel}</span>
        </div>
      </div>
    `;
  }

  private renderPlaytestPulseTile() {
    const p = this.playtestPulse;
    const dot =
      !p || p.status === "no-signal"
        ? html`<span class="text-slate-400">⬤ no-signal</span>`
        : p.status === "warming"
          ? html`<span class="text-yellow-300">⬤ warming</span>`
          : html`<span class="text-green-400">⬤ ready</span>`;
    const tutCompletion = p
      ? p.totals.tutorialShown > 0
        ? `${Math.round((p.totals.tutorialCompleted / p.totals.tutorialShown) * 100)}%`
        : "0%"
      : "—";
    const retentionAction = p
      ? p.totals.retentionChallengeShown > 0
        ? `${Math.round(p.rates.retentionAction * 100)}%`
        : "—"
      : "—";
    const nextAction =
      p?.operatorNext.headline ??
      p?.actionInsights[0] ??
      "Open KPI after one internal playtest.";
    const latestAge =
      p?.freshness.ageMinutes === null || p?.freshness.ageMinutes === undefined
        ? "—"
        : p.freshness.ageMinutes < 1
          ? "<1m"
          : `${Math.round(p.freshness.ageMinutes)}m`;
    const alphaGate = p?.alphaGate;
    const alphaGateLabel =
      alphaGate?.status === "ready"
        ? "ready"
        : alphaGate?.status === "blocked"
          ? "blocked"
          : alphaGate?.status === "warming"
            ? "warming"
            : "not-started";
    const alphaGateCopy =
      alphaGate?.status === "ready"
        ? alphaGate.passLabel
        : (alphaGate?.nextCheck ?? "Run one guided internal playtest.");
    return html`
      <div class="mt-1 border-t border-cyan-300/20 pt-1">
        <div class="flex justify-between items-center">
          <span class="text-cyan-200/85">Playtest Pulse</span>${dot}
        </div>
        <div class="flex justify-between">
          <span>Score</span><span>${p ? p.score : "—"}</span>
        </div>
        <div class="flex justify-between">
          <span>Tutorial done</span><span>${tutCompletion}</span>
        </div>
        <div class="flex justify-between">
          <span>Match feedback</span
          ><span>${p ? p.totals.matchFeedback : "—"}</span>
        </div>
        <div class="flex justify-between">
          <span>Rival action</span><span>${retentionAction}</span>
        </div>
        <div class="flex justify-between">
          <span>Latest signal</span><span>${latestAge}</span>
        </div>
        <div class="flex justify-between">
          <span>Alpha gate</span><span>${alphaGateLabel}</span>
        </div>
        <div class="flex justify-between">
          <span>Tournament actions</span
          ><span>${p ? p.totals.tournamentActions : "—"}</span>
        </div>
        <div class="mt-1 text-[10px] leading-snug text-cyan-100/85">
          ${nextAction}
        </div>
        <div class="mt-1 text-[10px] leading-snug text-amber-100/85">
          ${alphaGateCopy}
        </div>
      </div>
    `;
  }

  private updateParentOffset(): void {
    const offset =
      (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
    const parent = this.parentElement as HTMLElement;
    if (parent) {
      parent.style.marginTop = `${offset}px`;
    }
  }

  private secondsToHms = (d: number): string => {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);

    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);

    if (h !== 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    } else {
      return `${pad(m)}:${pad(s)}`;
    }
  };

  private convoyThreat(
    convoy: VaultFrontConvoyState,
  ): "Low" | "Medium" | "High" {
    const me = this.game.myPlayer();
    if (!me) return "Low";
    const srcX = this.game.x(convoy.sourceTile);
    const srcY = this.game.y(convoy.sourceTile);
    const dstX = this.game.x(convoy.destinationTile);
    const dstY = this.game.y(convoy.destinationTile);
    let hostile = 0;
    const sampleCount = 6;
    for (let i = 0; i < sampleCount; i++) {
      const blend = i / Math.max(1, sampleCount - 1);
      const x = Math.max(
        0,
        Math.min(
          this.game.width() - 1,
          Math.round(srcX + (dstX - srcX) * blend),
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          this.game.height() - 1,
          Math.round(srcY + (dstY - srcY) * blend),
        ),
      );
      const owner = this.game.owner(this.game.ref(x, y));
      if (
        owner.isPlayer() &&
        owner.smallID() !== convoy.ownerID &&
        !me.isFriendly(owner)
      ) {
        hostile++;
      }
    }
    const etaSeconds = Math.max(0, Math.ceil(convoy.ticksRemaining / 10));
    if (
      hostile >= 4 ||
      convoy.routeRisk >= 0.58 ||
      (hostile >= 2 && etaSeconds <= 4)
    ) {
      return "High";
    }
    if (hostile >= 2 || convoy.routeRisk >= 0.3 || etaSeconds <= 7) {
      return "Medium";
    }
    return "Low";
  }

  private threatClass(level: "Low" | "Medium" | "High"): string {
    if (level === "High")
      return "border-orange-300/50 bg-orange-500/25 text-orange-100";
    if (level === "Medium")
      return "border-sky-300/50 bg-sky-500/25 text-sky-100";
    return "border-slate-300/50 bg-slate-500/25 text-slate-100";
  }

  private convoyRailPriority(
    convoy: VaultFrontConvoyState,
    myID: number | undefined,
  ): number {
    if (myID === undefined) return 0;
    if (convoy.ownerID === myID) return 2;
    const owner = this.game.playerBySmallID(convoy.ownerID);
    if (owner?.isPlayer() === true && this.game.myPlayer()?.isFriendly(owner)) {
      return 1;
    }
    return 0;
  }

  private objectiveRailItems(): Array<{
    key: string;
    tile: number;
    text: string;
    tag?: string;
    details?: string;
    actionLabel?: "Capture" | "Defend" | "Intercept";
    actionTile?: number;
  }> {
    const status = this.latestVaultStatus;
    if (!status) return [];
    const now = this.game.ticks();
    const items: Array<{
      key: string;
      tile: number;
      text: string;
      tag?: string;
      details?: string;
      actionLabel?: "Capture" | "Defend" | "Intercept";
      actionTile?: number;
    }> = [];

    const myID = this.game.myPlayer()?.smallID();
    if (myID !== undefined) {
      const nearbySite = [...status.sites]
        .filter((site) => this.isTerritoryNearVault(site.tile, myID))
        .sort((a, b) => a.cooldownTicks - b.cooldownTicks)[0];
      if (nearbySite) {
        const eta = Math.max(0, Math.ceil(nearbySite.cooldownTicks / 10));
        const tag = this.vaultRiskTag(nearbySite.tile, myID);
        const trend = this.vaultRiskTrend(nearbySite.id, tag);
        const actionLabel =
          nearbySite.passiveOwnerID === myID
            ? "Defend"
            : nearbySite.cooldownTicks <= 0
              ? "Capture"
              : "Intercept";
        items.push({
          key: `site-${nearbySite.id}`,
          tile: nearbySite.tile,
          text:
            nearbySite.cooldownTicks <= 0
              ? `Vault ${nearbySite.id} open`
              : `Vault ${nearbySite.id} ${eta}s`,
          tag,
          details: `${nearbySite.rewardMath} | Est +${nearbySite.projectedGoldReward.toLocaleString()}g +${nearbySite.projectedTroopsReward.toLocaleString()}t | Threat ${trend}`,
          actionLabel,
          actionTile: nearbySite.tile,
        });
      }
    }

    const convoyItems = [...status.convoys]
      .sort((a, b) => {
        const aPriority = this.convoyRailPriority(a, myID);
        const bPriority = this.convoyRailPriority(b, myID);
        return bPriority - aPriority || a.ticksRemaining - b.ticksRemaining;
      })
      .slice(0, 1);
    for (const convoy of convoyItems) {
      const threat = this.convoyThreat(convoy);
      const convoyLabel =
        convoy.ownerID === myID
          ? "Your Convoy"
          : this.convoyRailPriority(convoy, myID) > 0
            ? "Ally Convoy"
            : "Enemy Convoy";
      const etaSeconds = Math.max(0, Math.ceil(convoy.ticksRemaining / 10));
      const interceptGold = Math.floor(convoy.goldReward / 2);
      const interceptTroops = Math.floor(convoy.troopsReward / 2);
      items.push({
        key: `convoy-${convoy.id}`,
        tile: convoy.destinationTile,
        text: `${convoyLabel} ${convoy.id} ${etaSeconds}s`,
        tag: threat,
        details:
          convoy.ownerID === myID
            ? `Hold for +${convoy.goldReward.toLocaleString()}g +${convoy.troopsReward.toLocaleString()}t | Threat ${threat}`
            : this.convoyRailPriority(convoy, myID) > 0
              ? `Escort window ${etaSeconds}s | Threat ${threat} | Reward +${convoy.goldReward.toLocaleString()}g`
              : `Cut for +${interceptGold.toLocaleString()}g +${interceptTroops.toLocaleString()}t | Threat ${threat}`,
        actionLabel:
          convoy.ownerID === myID || this.convoyRailPriority(convoy, myID) > 0
            ? "Defend"
            : "Intercept",
        actionTile: convoy.destinationTile,
      });
    }

    // Keep latest pulse cadence visible while active.
    const activePulse = status.beacons.find(
      (b) => b.maskedUntilTick > now && b.anchorTile !== undefined,
    );
    if (activePulse?.anchorTile !== undefined) {
      items.push({
        key: `pulse-${activePulse.playerID}`,
        tile: activePulse.anchorTile,
        text: `Pulse ${Math.max(0, Math.ceil((activePulse.maskedUntilTick - now) / 10))}s`,
        details: `Pulse lockout ${Math.max(0, Math.ceil((activePulse.cooldownUntilTick - now) / 10))}s | Jam lockout ${Math.max(0, Math.ceil((activePulse.jamBreakerCooldownUntilTick - now) / 10))}s`,
      });
    }
    return items.slice(0, GameRightSidebar.OBJECTIVE_RAIL_MAX_ITEMS);
  }

  private feedAudienceLabel(
    audience: "self" | "ally" | "global",
  ): "You" | "Ally" | "Map" {
    if (audience === "self") return "You";
    if (audience === "ally") return "Ally";
    return "Map";
  }

  private feedActivityLabel(
    activity: VaultFrontActivityUpdate["activity"],
  ): string {
    if (activity === "convoy_delivered") return "Delivery";
    if (activity === "convoy_intercepted") return "Intercept";
    if (activity === "vault_captured") return "Vault";
    if (activity === "jam_breaker") return "Jam";
    if (activity === "beacon_pulse") return "Pulse";
    return "Income";
  }

  private feedActivityToneClass(
    activity: VaultFrontActivityUpdate["activity"],
  ): string {
    if (activity === "convoy_intercepted") {
      return "border-rose-300/30 bg-rose-500/10 text-rose-100";
    }
    if (activity === "convoy_delivered" || activity === "vault_captured") {
      return "border-emerald-300/30 bg-emerald-500/10 text-emerald-100";
    }
    if (activity === "beacon_pulse" || activity === "jam_breaker") {
      return "border-fuchsia-300/30 bg-fuchsia-500/10 text-fuchsia-100";
    }
    return "border-cyan-300/25 bg-cyan-500/10 text-cyan-100";
  }

  private feedAgeLabel(tick: number): string {
    const now =
      typeof this.game?.ticks === "function" ? this.game.ticks() : tick;
    const ageTicks = Math.max(0, now - tick);
    const ageSeconds = Math.floor(ageTicks / 10);
    if (ageSeconds <= 0) return "now";
    return `${ageSeconds}s ago`;
  }

  private focusTile(tile: number): void {
    this.eventBus.emit(
      new GoToPositionEvent(this.game.x(tile), this.game.y(tile)),
    );
    logHudTelemetry("hud_objective_rail_click");
  }

  private performRailAction(item: {
    actionLabel?: "Capture" | "Defend" | "Intercept";
    actionTile?: number;
    tile: number;
  }): void {
    this.focusTile(item.actionTile ?? item.tile);
  }

  private renderDailyChallenge() {
    const ch = this.dailyChallenge;
    if (!ch) return null;
    const pct =
      ch.target > 0
        ? Math.min(100, Math.round((ch.progress / ch.target) * 100))
        : 0;
    return html`
      <div
        class="fixed bottom-24 right-4 z-[900] w-64 rounded-md border border-amber-400/40 bg-slate-950/90 px-2.5 py-2 text-[10px] text-amber-50 shadow-lg"
        style="zoom: ${this.hudScale};"
      >
        <div
          class="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wider text-amber-300"
        >
          <span>Daily Mastery</span>
          <span class="text-amber-400">+${ch.rewardMastery} M</span>
        </div>
        <div class="mb-1.5 text-[10px] leading-snug text-slate-200">
          ${ch.description}
        </div>
        <div
          class="mb-1 flex items-center justify-between text-[9px] text-slate-400"
        >
          <span>Certified matches only</span>
          <span>${ch.masteryBalance} M total</span>
        </div>
        ${
          ch.durability === "process-local"
            ? html`<div class="mb-1 text-[8px] text-slate-500">
                Local session progress
              </div>`
            : null
        }
        <div class="h-1.5 overflow-hidden rounded-full bg-slate-700">
          <div
            class="h-full rounded-full ${
              ch.completed ? "bg-emerald-400" : "bg-amber-400"
            } transition-all"
            style="width:${pct}%"
          ></div>
        </div>
        <div
          class="mt-0.5 text-right text-[9px] ${
            ch.completed ? "text-emerald-300" : "text-slate-400"
          }"
        >
          ${ch.completed ? "✓ Complete" : `${ch.progress}/${ch.target}`}
        </div>
        <div class="mt-2 border-t border-amber-300/20 pt-1.5">
          <div
            class="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-amber-200"
          >
            <span>Doctrine Vault</span>
            <span>${ch.masteryBalance} M</span>
          </div>
          <div class="mb-1 text-[8px] text-slate-400">
            Coaching identity only · never combat power
          </div>
          <div class="grid gap-1">
            ${ch.doctrines.catalog.map((doctrine) => {
              const owned = ch.doctrines.ownedIds.includes(doctrine.id);
              const active = ch.doctrines.activeId === doctrine.id;
              const affordable = ch.masteryBalance >= doctrine.costMastery;
              const pending = this.masterySelectionPending === doctrine.id;
              return html`
                <button
                  class="rounded border px-1.5 py-1 text-left transition-colors ${
                    active
                      ? "border-emerald-300/60 bg-emerald-500/15 text-emerald-100"
                      : "border-slate-600/70 bg-slate-900/70 text-slate-200 hover:border-amber-300/50"
                  }"
                  ?disabled=${pending || (!owned && !affordable)}
                  title=${doctrine.brief}
                  @click=${() => this.chooseMasteryDoctrine(doctrine.id)}
                >
                  <span class="flex justify-between gap-2 font-semibold">
                    <span>${doctrine.name}</span>
                    <span
                      >${
                        active
                          ? "Active"
                          : owned
                            ? "Select"
                            : `${doctrine.costMastery} M`
                      }</span
                    >
                  </span>
                  <span class="block text-[8px] text-slate-400"
                    >${doctrine.role}</span
                  >
                </button>
              `;
            })}
          </div>
          ${
            this.masterySelectionNotice
              ? html`<div class="mt-1 text-[8px] text-amber-100" role="status">
                  ${this.masterySelectionNotice}
                </div>`
              : null
          }
        </div>
      </div>
    `;
  }

  private async chooseMasteryDoctrine(
    doctrineId: MasteryDoctrineId,
  ): Promise<void> {
    if (this.masterySelectionPending) return;
    this.masterySelectionPending = doctrineId;
    this.masterySelectionNotice = "";
    const result = await selectMasteryDoctrine(doctrineId);
    this.masterySelectionPending = null;
    if (!result.ok) {
      this.masterySelectionNotice = result.error;
      return;
    }
    this.dailyChallenge = result.value.snapshot;
    this.masterySelectionNotice = result.value.receipt.unlockedNow
      ? `${result.value.receipt.spentMastery} M invested · receipt ${result.value.receipt.receiptDigest.slice(0, 8)}`
      : `Doctrine active · no spend · receipt ${result.value.receipt.receiptDigest.slice(0, 8)}`;
  }

  private renderObjectiveRail() {
    const items = this.objectiveRailItems();
    if (items.length === 0) return null;
    return html`
      <div
        class="fixed left-1/2 top-2 z-[1150] -translate-x-1/2 flex max-w-[94vw] flex-wrap items-center gap-1 rounded-md border border-cyan-400/35 bg-slate-950/80 px-2 py-1 text-[10px] text-cyan-50 shadow-lg"
        style="zoom: ${this.hudScale}; top: ${this.objectiveRailTopPx()}px;"
      >
        ${items.map(
          (item) => html`
            <div
              class="flex items-center gap-1 rounded border border-cyan-300/35 bg-cyan-500/10 px-1.5 py-0.5"
              title=${
                item.details
                  ? `${item.details} | Click to center camera`
                  : "Center camera on objective"
              }
            >
              <button
                class="hover:text-cyan-100"
                @click=${() => this.focusTile(item.tile)}
              >
                <span>${item.text}</span>
                ${
                  item.tag
                    ? html`<span
                        class="ml-1 rounded border px-1 py-0.5 ${this.threatClass(
                          item.tag as "Low" | "Medium" | "High",
                        )}"
                        >${item.tag}</span
                      >`
                    : ""
                }
              </button>
              ${
                item.actionLabel
                  ? html`<button
                      class="rounded border border-amber-300/45 bg-amber-500/20 px-1 py-0.5 text-[10px] text-amber-50 hover:bg-amber-500/30"
                      @click=${() => this.performRailAction(item)}
                    >
                      ${item.actionLabel}
                    </button>`
                  : ""
              }
            </div>
          `,
        )}
      </div>
    `;
  }

  private renderVaultFeed() {
    if (this.recentVaultFeed.length === 0) return null;
    return html`
      <div
        class="fixed z-[1160] flex w-[min(92vw,320px)] flex-col gap-1"
        style="zoom: ${
          this.hudScale
        }; right: ${this.vaultFeedRightPx()}px; top: ${this.vaultFeedTopPx()}px;"
      >
        ${this.recentVaultFeed.map(
          (entry) => html`
            <button
              class="rounded border border-cyan-300/30 bg-slate-950/82 px-2 py-1 text-left text-[10px] text-cyan-50 shadow-lg hover:bg-slate-900/88"
              @click=${() => {
                if (entry.tile !== undefined) {
                  this.focusTile(entry.tile);
                }
              }}
            >
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate">${entry.label}</div>
                  <div
                    class="mt-0.5 flex items-center gap-1 text-[9px] text-cyan-200/70"
                  >
                    <span
                      class="rounded border border-cyan-300/25 bg-cyan-500/10 px-1 py-0.5"
                    >
                      ${this.feedAudienceLabel(entry.audience)}
                    </span>
                    <span
                      class="rounded border px-1 py-0.5 ${this.feedActivityToneClass(
                        entry.activity,
                      )}"
                    >
                      ${this.feedActivityLabel(entry.activity)}
                    </span>
                    <span>${this.feedAgeLabel(entry.tick)}</span>
                  </div>
                </div>
              </div>
            </button>
          `,
        )}
      </div>
    `;
  }

  private objectiveRailTopPx(): number {
    return (
      8 + (this.spawnBarVisible ? 26 : 0) + (this.immunityBarVisible ? 26 : 0)
    );
  }

  private vaultFeedTopPx(): number {
    return (
      (this.viewportWidth() >= 1200
        ? 360
        : this.viewportWidth() >= 980
          ? 304
          : 244) +
      (this.spawnBarVisible ? 26 : 0) +
      (this.immunityBarVisible ? 26 : 0)
    );
  }

  private vaultFeedRightPx(): number {
    return this.viewportWidth() >= 1200 ? 356 : 2;
  }

  private toggleReplayPanel(): void {
    this._isReplayVisible = !this._isReplayVisible;
    this.eventBus.emit(
      new ShowReplayPanelEvent(this._isReplayVisible, this._isSinglePlayer),
    );
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      crazyGamesSDK.gameplayStop();
    } else {
      crazyGamesSDK.gameplayStart();
    }
    this.eventBus.emit(new PauseGameIntentEvent(this.isPaused));
    logHudTelemetry("hud_pause_toggle", { paused: this.isPaused });
  }

  private async onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!isConfirmed) return;
    }
    await crazyGamesSDK.requestMidgameAd();
    await crazyGamesSDK.gameplayStop();
    // redirect to the home page
    logHudTelemetry("hud_exit_click");
    window.location.href = "/";
  }

  private onSettingsButtonClick() {
    this.eventBus.emit(
      new ShowSettingsModalEvent(true, this._isSinglePlayer, this.isPaused),
    );
    logHudTelemetry("hud_settings_open");
  }

  render() {
    if (this.game === undefined) return html``;

    const timerColor =
      this.game.config().gameConfig().maxTimerValue !== undefined &&
      this.timer < 60
        ? "text-red-400"
        : "";
    const filteredTimeline = this.vaultTimeline.filter((entry) => {
      const category = this.timelineCategory(entry.activity);
      return this.timelineFilters[category];
    });

    return html`
      ${this.renderObjectiveRail()} ${this.renderDailyChallenge()}
      <aside
        class=${`w-fit flex flex-row items-center gap-2 py-2 px-3 bg-gray-800/70 backdrop-blur-xs shadow-xs min-[1200px]:rounded-lg rounded-bl-lg transition-transform duration-300 ease-out transform text-white ${
          this._isVisible ? "translate-x-0" : "translate-x-full"
        }`}
        style="margin-top: ${this.dockOffsetY}px; margin-right: ${-this
          .dockOffsetX}px; zoom: ${this.hudScale};"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div class="flex items-center gap-3">
          <div class=${timerColor}>${this.secondsToHms(this.timer)}</div>
          ${this.maybeRenderReplayButtons()}
          <div
            class="cursor-pointer rounded bg-slate-600/45 px-1.5 py-0.5 text-[11px] hover:bg-slate-600/65 min-[1200px]:hidden"
            @click=${() => this.toggleTimeline()}
            title="Toggle objective timeline"
          >
            OBJ
          </div>
          <div
            class="cursor-pointer rounded bg-cyan-600/30 px-1.5 py-0.5 text-[11px] hover:bg-cyan-600/45"
            title="Toggle internal KPI overlay"
            @click=${() => this.toggleKpiPanel()}
          >
            KPI
          </div>
          <div
            class="cursor-pointer rounded px-1.5 py-0.5 text-[11px] ${
              this.vaultDebugActive
                ? "bg-amber-500/35 text-amber-50 hover:bg-amber-500/50"
                : "bg-slate-600/45 text-slate-100 hover:bg-slate-600/65"
            }"
            title="Toggle VaultFront debug checklist and logs"
            @click=${() => this.toggleVaultDebug()}
          >
            ${this.vaultDebugActive ? "VDbg On" : "VDbg"}
          </div>
          ${
            this.hudEditMode
              ? html`
                  <div
                    class="cursor-pointer rounded bg-cyan-500/35 px-1.5 py-0.5 text-[11px] hover:bg-cyan-500/55"
                    title="Drag right HUD dock"
                    @pointerdown=${this.onDockDragStart}
                  >
                    Drag
                  </div>
                `
              : ""
          }
          <div
            class="cursor-pointer p-1 rounded hover:bg-white/10"
            @click=${this.onSettingsButtonClick}
          >
            <img src=${settingsIcon} alt="settings" width="20" height="20" />
          </div>
          <div
            class="cursor-pointer p-1 rounded hover:bg-white/10"
            @click=${this.onExitButtonClick}
          >
            <img src=${exitIcon} alt="exit" width="20" height="20" />
          </div>
        </div>

        <div
          class="${
            this.timelineExpanded || this.viewportWidth() >= 1200
              ? "max-w-75 border-l border-white/20 pl-2 text-[11px] leading-4"
              : "hidden"
          }"
        >
          <div class="text-cyan-200 font-semibold mb-0.5">
            Objective Timeline
          </div>
          <div class="mb-1 flex flex-wrap gap-1">
            ${(
              [
                { key: "captures", label: "Captures" },
                { key: "convoys", label: "Convoys" },
                { key: "pulses", label: "Pulses" },
                { key: "surge", label: "Surge" },
              ] as const
            ).map(
              (chip) =>
                html`<button
                  class="rounded border px-1 py-0.5 ${
                    this.timelineFilters[chip.key]
                      ? "border-cyan-200/65 bg-cyan-500/25 text-cyan-50"
                      : "border-slate-300/35 bg-slate-700/30 text-slate-200"
                  }"
                  @click=${() => this.toggleTimelineFilter(chip.key)}
                >
                  ${chip.label}
                </button>`,
            )}
          </div>
          ${
            filteredTimeline.length === 0
              ? html`<div class="text-white/55">No objective activity yet</div>`
              : filteredTimeline.slice(-4).map(
                  (entry) =>
                    html`<button
                      class="block w-full text-left text-white/85 truncate hover:text-cyan-200"
                      title=${
                        entry.tile !== undefined
                          ? "Jump to objective location"
                          : entry.label
                      }
                      @click=${() => {
                        if (entry.tile !== undefined) {
                          this.focusTile(entry.tile);
                          logHudTelemetry("hud_timeline_jump");
                        }
                      }}
                    >
                      [${this.secondsToHms(
                        Math.max(
                          0,
                          Math.floor(
                            (entry.tick -
                              this.game.config().numSpawnPhaseTurns()) /
                              10,
                          ),
                        ),
                      )}]
                      ${entry.label}
                    </button>`,
                )
          }
        </div>
        ${this.renderKpiPanel()}
      </aside>
    `;
  }

  maybeRenderReplayButtons() {
    const isReplayOrSingleplayer =
      this._isSinglePlayer || this.game?.config()?.isReplay();
    const showPauseButton = isReplayOrSingleplayer || this.isLobbyCreator;

    return html`
      ${
        isReplayOrSingleplayer
          ? html`
              <div class="cursor-pointer" @click=${this.toggleReplayPanel}>
                <img
                  src=${FastForwardIconSolid}
                  alt="replay"
                  width="20"
                  height="20"
                />
              </div>
            `
          : ""
      }
      ${
        showPauseButton
          ? html`
              <div class="cursor-pointer" @click=${this.onPauseButtonClick}>
                <img
                  src=${this.isPaused ? playIcon : pauseIcon}
                  alt="play/pause"
                  width="20"
                  height="20"
                />
              </div>
            `
          : ""
      }
    `;
  }
}
