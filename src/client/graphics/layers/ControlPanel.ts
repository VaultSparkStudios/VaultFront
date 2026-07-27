import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { DEFAULT_VAULT_GAMEPLAY_BALANCE } from "../../../core/execution/VaultFrontBalance";
import { Gold } from "../../../core/game/Game";
import {
  GameUpdateType,
  VaultFrontActivityUpdate,
  VaultFrontBeaconState,
  VaultFrontConvoyState,
  VaultFrontStatusUpdate,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import {
  fetchVaultFrontRuntimeAssignment,
  recordVaultFrontRuntimeEvent,
} from "../../Api";
import { clearConvoyMastery, readConvoyMastery } from "../../ConvoyMastery";
import {
  FIRST_EXTRACTION_STEPS,
  FIRST_EXTRACTION_TITLE,
  firstExtractionComplete,
} from "../../FirstExtractionQuest";
import { AttackRatioEvent } from "../../InputHandler";
import {
  SendDefenseFactoryCommandIntentEvent,
  SendResourceFocusIntentEvent,
  SendVaultConvoyCommandIntentEvent,
  SendVaultRolePingIntentEvent,
} from "../../Transport";
import { renderNumber, renderTroops } from "../../Utils";
import {
  HUD_LAYOUT_EVENT,
  HudPreset,
  VaultNoticeSortMode,
  applyGlobalHudScale,
  dispatchHudLayoutUpdate,
  readHudLayout,
  writeHudLayout,
} from "../HudLayout";
import { logHudTelemetry } from "../HudTelemetry";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import { GoToPositionEvent } from "./Leaderboard";
import goldCoinIcon from "/images/GoldCoinIcon.svg?url";
import soldierIcon from "/images/SoldierIcon.svg?url";
import swordIcon from "/images/SwordIcon.svg?url";

interface OnboardingProgress {
  focusSet: boolean;
  vaultCaptured: boolean;
  convoyAction: boolean;
  pulseTriggered: boolean;
}

interface VaultNotice {
  key: string;
  siteID: number;
  tile: number;
  label: string;
  etaSeconds: number;
  details: string;
  risk: "Low" | "Medium" | "High";
  riskScore: number;
  trend: "Rising" | "Falling" | "Stable";
  actionLabel: "Capture" | "Defend" | "Intercept";
  actionTile: number;
}

interface CoachmarkProgress {
  shield: boolean;
  reroute: boolean;
  jamBreaker: boolean;
}

interface VaultQaProgress {
  vaultCaptured: boolean;
  passiveIncomeEvents: number;
  convoyDelivered: number;
  convoyIntercepted: number;
  escortCommands: number;
  reroutesApplied: number;
  jamBreakersTriggered: number;
}

interface VaultDebugToggleDetail {
  enabled: boolean;
}

@customElement("control-panel")
export class ControlPanel extends LitElement implements Layer {
  private static readonly ONBOARDING_DURATION_TICKS = 1_800;
  private static readonly ONBOARDING_DISMISS_KEY =
    "vaultfront.onboarding.dismissed";
  private static readonly COACHMARK_KEY = "vaultfront.coachmarks.v1";
  private static readonly VAULT_DEBUG_STORAGE_KEY = "vaultfront.debug";
  private static readonly VAULT_DEBUG_QUERY_PARAM = "vaultDebug";
  private static readonly VAULT_DEBUG_EVENT = "vaultfront-debug-toggle";
  private static readonly VAULT_NOTICE_TERRITORY_RANGE = 24;
  private static readonly JAM_BREAKER_GOLD_COST =
    DEFAULT_VAULT_GAMEPLAY_BALANCE.defense.jamBreakerGoldCost;
  private static readonly FLOATING_VAULT_HUD_WIDTH_PX = 344;

  public game: GameView;
  public clientID: ClientID;
  public eventBus: EventBus;
  public uiState: UIState;

  @state()
  private attackRatio: number = 0.2;

  @state()
  private resourceFocus: number = 50;

  @state()
  private _maxTroops: number;

  @state()
  private troopRate: number;

  @state()
  private goldRate: number;

  @state()
  private _troops: number;

  @state()
  private _isVisible = false;

  @state()
  private _gold: Gold;

  @state()
  private _attackingTroops: number = 0;

  @state()
  private _touchDragging = false;

  @state()
  private latestVaultStatus: VaultFrontStatusUpdate | null = null;

  @state()
  private onboardingDismissed = false;

  @state()
  private onboardingProgress: OnboardingProgress = {
    focusSet: false,
    vaultCaptured: false,
    convoyAction: false,
    pulseTriggered: false,
  };

  @state()
  private nextMatchGoal = "";

  @state()
  private nextMatchGoalKey = "";

  @state()
  private nextMatchGoalCompleted = false;

  @state()
  private convoyRoutePreference: "city" | "port" | "factory" | "silo" = "city";

  @state()
  private jamBreakerCooldownUntilTick = 0;

  @state()
  private jamOnNextPulseArmed = false;

  @state()
  private hudCompactMode = false;

  @state()
  private hudEditMode = false;

  @state()
  private hudEditExpanded = false;

  @state()
  private hudScale = 1;

  @state()
  private hudPreset: HudPreset = "competitive";

  @state()
  private vaultNoticeSortMode: VaultNoticeSortMode = "eta";

  @state()
  private panelOffsetX = 0;

  @state()
  private panelOffsetY = 0;

  @state()
  private coachmarksEnabled = false;

  @state()
  private coachmarkProgress: CoachmarkProgress = {
    shield: false,
    reroute: false,
    jamBreaker: false,
  };

  @state()
  private tutorialLockActive = false;

  @state()
  private advancedCommandsExpanded = false;

  @state()
  private runtimeRewardVariant: "control" | "high_risk_high_reward" = "control";

  @state()
  private runtimeHudVariant: "default" | "mobile_priority" = "default";

  @state()
  private reducedMotion = false;

  @state()
  private rewardExplainExpanded = false;

  @state()
  private selectedPreviewCommand:
    | "reroute_city"
    | "reroute_port"
    | "reroute_factory"
    | "reroute_silo"
    | "reroute_safest" = "reroute_safest";

  @state()
  private quickRolePreset: "aggro" | "economy" | "control" = "control";

  @state()
  private heavyCombatActive = false;

  @state()
  private vaultHudHoverExpanded = false;

  @state()
  private vaultHudPinnedExpanded = false;

  @state()
  private adaptiveNudgeKey:
    "vault_first" | "convoy_impact" | "pulse_chain" | "focus_stable" | "" = "";

  @state()
  private vaultDebugActive = false;

  @state()
  private vaultQaProgress: VaultQaProgress = {
    vaultCaptured: false,
    passiveIncomeEvents: 0,
    convoyDelivered: 0,
    convoyIntercepted: 0,
    escortCommands: 0,
    reroutesApplied: 0,
    jamBreakersTriggered: 0,
  };

  private pendingResourceFocus: number | null = null;

  private _troopRateIsIncreasing: boolean = true;

  private _lastTroopIncreaseRate = 0;
  private _lastProcessedTick = -1;
  private onboardingCompletionRecorded = false;
  private hudCollisionCheckNextTick = 0;
  private draggingPanel = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragBaseX = 0;
  private dragBaseY = 0;
  private lastVaultDebugStatusKey = "";
  private lastVaultDebugSelectionKey = "";
  private reducedMotionMediaQuery: MediaQueryList | null = null;
  private lastRiskByVault = new Map<number, number>();

  getTickIntervalMs() {
    return 100;
  }

  init() {
    this.initializeVaultDebugState();
    this.attackRatio = Number(
      localStorage.getItem("settings.attackRatio") ?? "0.2",
    );
    this.uiState.attackRatio = this.attackRatio;
    this.onboardingDismissed =
      localStorage.getItem(ControlPanel.ONBOARDING_DISMISS_KEY) === "1";
    const mastery = readConvoyMastery();
    this.nextMatchGoal =
      mastery?.text ?? localStorage.getItem("vaultfront.nextMatchGoal") ?? "";
    this.nextMatchGoalKey =
      mastery?.goalKey ??
      localStorage.getItem("vaultfront.nextMatchGoalKey") ??
      "";
    this.loadHudLayout();
    applyGlobalHudScale(this.hudScale);
    if (typeof window !== "undefined" && "matchMedia" in window) {
      this.reducedMotionMediaQuery = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );
      this.reducedMotion = this.reducedMotionMediaQuery.matches;
      this.reducedMotionMediaQuery.addEventListener(
        "change",
        this.onReducedMotionChanged,
      );
    }

    const rawCoachmarks = localStorage.getItem(ControlPanel.COACHMARK_KEY);
    if (rawCoachmarks) {
      try {
        const parsed = JSON.parse(rawCoachmarks) as Partial<CoachmarkProgress>;
        this.coachmarkProgress = {
          shield: parsed.shield === true,
          reroute: parsed.reroute === true,
          jamBreaker: parsed.jamBreaker === true,
        };
      } catch {
        this.coachmarkProgress = {
          shield: false,
          reroute: false,
          jamBreaker: false,
        };
      }
    }
    const matches = Number(
      localStorage.getItem("vaultfront.kpi.matches") ?? "0",
    );
    this.tutorialLockActive = matches <= 0;
    const presetRaw = localStorage.getItem("vaultfront.quickRolePreset");
    if (
      presetRaw === "aggro" ||
      presetRaw === "economy" ||
      presetRaw === "control"
    ) {
      this.quickRolePreset = presetRaw;
    }
    const nudgeRaw = localStorage.getItem("vaultfront.adaptiveNudgeKey");
    if (
      nudgeRaw === "vault_first" ||
      nudgeRaw === "convoy_impact" ||
      nudgeRaw === "pulse_chain" ||
      nudgeRaw === "focus_stable"
    ) {
      this.adaptiveNudgeKey = nudgeRaw;
    }
    const coachmarksDone =
      this.coachmarkProgress.shield &&
      this.coachmarkProgress.reroute &&
      this.coachmarkProgress.jamBreaker;
    this.coachmarksEnabled = matches <= 1 && !coachmarksDone;
    window.addEventListener(
      HUD_LAYOUT_EVENT,
      this.onHudLayoutUpdated as EventListener,
    );
    window.addEventListener("keydown", this.onGlobalKeyDown);
    window.addEventListener(
      ControlPanel.VAULT_DEBUG_EVENT,
      this.onVaultDebugToggle as EventListener,
    );
    void this.resolveRuntimeAssignment();
    logHudTelemetry("hud_session_start", {
      preset: this.hudPreset,
      scale: this.hudScale,
    });
    const endedAt = sessionStorage.getItem("vaultfront.matchEndedAt");
    if (endedAt !== null) {
      const prev = Number(
        localStorage.getItem("vaultfront.kpi.nextMatchRetention") ?? "0",
      );
      localStorage.setItem(
        "vaultfront.kpi.nextMatchRetention",
        String(prev + 1),
      );
      sessionStorage.removeItem("vaultfront.matchEndedAt");
    }
    const onboardingShown = Number(
      localStorage.getItem("vaultfront.kpi.onboardingShown") ?? "0",
    );
    localStorage.setItem(
      "vaultfront.kpi.onboardingShown",
      String(onboardingShown + 1),
    );
    this.eventBus.on(AttackRatioEvent, (event) => {
      let newAttackRatio = this.attackRatio + event.attackRatio / 100;

      if (newAttackRatio < 0.01) {
        newAttackRatio = 0.01;
      }

      if (newAttackRatio > 1) {
        newAttackRatio = 1;
      }

      if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
        // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep a consistency
        newAttackRatio = 0.1;
      }

      this.attackRatio = newAttackRatio;
      this.onAttackRatioChange(this.attackRatio);
      logHudTelemetry("hud_attack_ratio_changed");
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(
      HUD_LAYOUT_EVENT,
      this.onHudLayoutUpdated as EventListener,
    );
    window.removeEventListener("pointermove", this.onPanelDragMove);
    window.removeEventListener("pointerup", this.onPanelDragEnd);
    window.removeEventListener("keydown", this.onGlobalKeyDown);
    window.removeEventListener(
      ControlPanel.VAULT_DEBUG_EVENT,
      this.onVaultDebugToggle as EventListener,
    );
    this.reducedMotionMediaQuery?.removeEventListener(
      "change",
      this.onReducedMotionChanged,
    );
  }

  tick() {
    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    this.updateTroopIncrease();
    this.consumeVaultFrontUpdates();
    this.maybeTriggerAutoJamOnPulse();
    this.updateNextMatchGoalProgress();
    this.maybeClearAdaptiveNudge();
    this.detectHudCollision();

    this._maxTroops = this.game.config().maxTroops(player);
    this._gold = player.gold();
    this._troops = player.troops();
    const serverFocus = player.goldTroopFocus();
    if (this.pendingResourceFocus !== null) {
      if (serverFocus === this.pendingResourceFocus) {
        this.pendingResourceFocus = null;
        this.resourceFocus = serverFocus;
      } else {
        this.resourceFocus = this.pendingResourceFocus;
      }
    } else {
      this.resourceFocus = serverFocus;
    }
    if (serverFocus !== 50) {
      this.updateOnboardingProgress({ focusSet: true });
    }
    this._attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    this.updateHeavyCombatState();
    const { troopMultiplier, goldMultiplier } = this.resourceFocusMultipliers(
      this.resourceFocus,
    );
    this.troopRate =
      this.game.config().troopIncreaseRate(player) * troopMultiplier * 10;
    this.goldRate =
      Number(this.game.config().goldAdditionRate(player)) * goldMultiplier * 10;
    this.requestUpdate();
  }

  private updateTroopIncrease() {
    const player = this.game?.myPlayer();
    if (player === null) return;
    const troopIncreaseRate = this.game.config().troopIncreaseRate(player);
    this._troopRateIsIncreasing =
      troopIncreaseRate >= this._lastTroopIncreaseRate;
    this._lastTroopIncreaseRate = troopIncreaseRate;
  }

  private updateHeavyCombatState(): void {
    const troops = Math.max(1, this._troops ?? 1);
    const heavyByOutgoing = this._attackingTroops > troops * 0.28;
    const heavyByRatio =
      this.attackRatio >= 0.55 && this._attackingTroops > 10_000;
    this.heavyCombatActive = heavyByOutgoing || heavyByRatio;
  }

  onAttackRatioChange(newRatio: number) {
    this.uiState.attackRatio = newRatio;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Render any necessary canvas elements
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  private _outsideTouchHandler: ((ev: Event) => void) | null = null;

  private handleAttackTouchStart(e: TouchEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (this._touchDragging) {
      this.closeAttackBar();
      return;
    }

    this._touchDragging = true;

    setTimeout(() => {
      this._outsideTouchHandler = () => {
        this.closeAttackBar();
      };
      document.addEventListener("touchstart", this._outsideTouchHandler);
    }, 0);
  }

  private closeAttackBar() {
    this._touchDragging = false;
    if (this._outsideTouchHandler) {
      document.removeEventListener("touchstart", this._outsideTouchHandler);
      this._outsideTouchHandler = null;
    }
  }

  private handleBarTouch(e: TouchEvent) {
    e.preventDefault();
    e.stopPropagation();

    this.setRatioFromTouch(e.touches[0]);

    const onMove = (ev: TouchEvent) => {
      ev.preventDefault();
      this.setRatioFromTouch(ev.touches[0]);
    };

    const onEnd = () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };

    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
  }

  private setRatioFromTouch(touch: Touch) {
    const barEl = this.querySelector(".attack-drag-bar");
    if (!barEl) return;

    const rect = barEl.getBoundingClientRect();
    const ratio = (rect.bottom - touch.clientY) / (rect.bottom - rect.top);
    this.attackRatio =
      Math.round(Math.max(1, Math.min(100, ratio * 100))) / 100;
    this.onAttackRatioChange(this.attackRatio);
  }

  private handleRatioSliderInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    this.attackRatio = value / 100;
    this.onAttackRatioChange(this.attackRatio);
    logHudTelemetry("hud_attack_ratio_slider");
  }

  private handleResourceFocusSliderInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    const focus = Math.max(0, Math.min(100, Math.round(value)));
    if (focus === this.resourceFocus && this.pendingResourceFocus === focus) {
      return;
    }
    this.pendingResourceFocus = focus;
    this.resourceFocus = focus;
    this.updateOnboardingProgress({ focusSet: true });
    this.eventBus.emit(new SendResourceFocusIntentEvent(focus));
    logHudTelemetry("hud_focus_slider", { focus });
  }

  private consumeVaultFrontUpdates() {
    const tick = this.game?.ticks() ?? 0;
    if (tick === this._lastProcessedTick) return;
    this._lastProcessedTick = tick;

    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    const statusUpdates = updates[
      GameUpdateType.VaultFrontStatus
    ] as VaultFrontStatusUpdate[];
    if (statusUpdates.length > 0) {
      this.latestVaultStatus = statusUpdates[statusUpdates.length - 1];
      const beacon = this.myBeacon();
      if (beacon) {
        this.jamBreakerCooldownUntilTick = beacon.jamBreakerCooldownUntilTick;
      }
      this.debugVaultStatus(this.latestVaultStatus);
    }

    const activityUpdates = updates[
      GameUpdateType.VaultFrontActivity
    ] as VaultFrontActivityUpdate[];
    if (activityUpdates.length === 0) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    const myID = myPlayer.smallID();

    let vaultCaptured = this.onboardingProgress.vaultCaptured;
    let convoyAction = this.onboardingProgress.convoyAction;
    let pulseTriggered = this.onboardingProgress.pulseTriggered;

    for (const update of activityUpdates) {
      if (
        update.activity === "vault_captured" &&
        update.sourcePlayerID === myID
      ) {
        vaultCaptured = true;
      }
      if (
        (update.activity === "convoy_intercepted" ||
          update.activity === "convoy_delivered") &&
        update.sourcePlayerID === myID
      ) {
        convoyAction = true;
      }
      if (
        update.activity === "beacon_pulse" &&
        update.sourcePlayerID === myID
      ) {
        pulseTriggered = true;
      }
    }

    this.updateVaultQaProgress(activityUpdates, myID);

    this.updateOnboardingProgress({
      vaultCaptured,
      convoyAction,
      pulseTriggered,
    });
  }

  private updateOnboardingProgress(next: Partial<OnboardingProgress>) {
    const merged: OnboardingProgress = {
      ...this.onboardingProgress,
      ...next,
    };
    if (
      merged.focusSet === this.onboardingProgress.focusSet &&
      merged.vaultCaptured === this.onboardingProgress.vaultCaptured &&
      merged.convoyAction === this.onboardingProgress.convoyAction &&
      merged.pulseTriggered === this.onboardingProgress.pulseTriggered
    ) {
      return;
    }
    this.onboardingProgress = merged;
    if (
      !this.onboardingCompletionRecorded &&
      merged.focusSet &&
      merged.vaultCaptured &&
      merged.convoyAction &&
      merged.pulseTriggered &&
      (this.game?.ticks() ?? Number.MAX_SAFE_INTEGER) <=
        ControlPanel.ONBOARDING_DURATION_TICKS
    ) {
      this.onboardingCompletionRecorded = true;
      const prev = Number(
        localStorage.getItem("vaultfront.kpi.onboardingCompleted") ?? "0",
      );
      localStorage.setItem(
        "vaultfront.kpi.onboardingCompleted",
        String(prev + 1),
      );
    }
  }

  private updateNextMatchGoalProgress() {
    if (!this.nextMatchGoalKey || this.nextMatchGoalCompleted) return;
    const ticks = this.game?.ticks() ?? 0;
    const spawnTicks = this.game?.config().numSpawnPhaseTurns() ?? 0;
    const liveTicks = Math.max(0, ticks - spawnTicks);

    let completed: boolean;
    switch (this.nextMatchGoalKey) {
      case "vault_first":
        completed = this.onboardingProgress.vaultCaptured && liveTicks <= 2_400;
        break;
      case "convoy_impact":
        completed = this.onboardingProgress.convoyAction;
        break;
      case "pulse_chain":
        completed = this.onboardingProgress.pulseTriggered;
        break;
      case "focus_stable":
        completed = this.onboardingProgress.focusSet;
        break;
      default:
        completed = false;
    }

    if (completed) {
      this.nextMatchGoalCompleted = true;
      clearConvoyMastery();
    }
  }

  private maybeClearAdaptiveNudge(): void {
    if (!this.adaptiveNudgeKey) return;
    const progress = this.onboardingProgress;
    const completed =
      (this.adaptiveNudgeKey === "vault_first" && progress.vaultCaptured) ||
      (this.adaptiveNudgeKey === "convoy_impact" && progress.convoyAction) ||
      (this.adaptiveNudgeKey === "pulse_chain" && progress.pulseTriggered) ||
      (this.adaptiveNudgeKey === "focus_stable" && progress.focusSet);
    if (!completed) return;
    this.adaptiveNudgeKey = "";
    localStorage.removeItem("vaultfront.adaptiveNudgeKey");
  }

  private shouldShowOnboarding(): boolean {
    const lockRequired =
      this.tutorialLockActive &&
      (!this.onboardingProgress.vaultCaptured ||
        !this.onboardingProgress.convoyAction);
    if (!lockRequired && this.hudCompactMode) return false;
    if (this.onboardingDismissed || this.latestVaultStatus === null)
      return false;
    if (
      !lockRequired &&
      (this.game?.ticks() ?? 0) > ControlPanel.ONBOARDING_DURATION_TICKS
    ) {
      return false;
    }
    return !this.onboardingChainCompleted();
  }

  private onboardingChainCompleted(): boolean {
    const progress = this.onboardingProgress;
    const completed = firstExtractionComplete(progress);
    if (
      this.tutorialLockActive &&
      progress.vaultCaptured &&
      progress.convoyAction
    ) {
      this.tutorialLockActive = false;
    }
    return completed;
  }

  private dismissOnboarding() {
    if (
      this.tutorialLockActive &&
      (!this.onboardingProgress.vaultCaptured ||
        !this.onboardingProgress.convoyAction)
    ) {
      return;
    }
    this.onboardingDismissed = true;
    localStorage.setItem(ControlPanel.ONBOARDING_DISMISS_KEY, "1");
  }

  private myBeacon(): VaultFrontBeaconState | null {
    const status = this.latestVaultStatus;
    const myID = this.game?.myPlayer()?.smallID();
    if (!status || myID === undefined) return null;
    return status.beacons.find((beacon) => beacon.playerID === myID) ?? null;
  }

  private myConvoy(): VaultFrontConvoyState | null {
    const status = this.latestVaultStatus;
    const myID = this.game?.myPlayer()?.smallID();
    if (!status || myID === undefined) return null;
    return (
      [...status.convoys]
        .filter((convoy) => convoy.ownerID === myID)
        .sort((a, b) => a.ticksRemaining - b.ticksRemaining)[0] ?? null
    );
  }

  private alliedConvoy(): VaultFrontConvoyState | null {
    const status = this.latestVaultStatus;
    const me = this.game?.myPlayer();
    if (!status || !me) return null;
    return (
      [...status.convoys]
        .filter((convoy) => {
          if (convoy.ownerID === me.smallID()) return false;
          const owner = this.game.playerBySmallID(convoy.ownerID);
          return owner?.isPlayer() === true && me.isFriendly(owner);
        })
        .sort((a, b) => a.ticksRemaining - b.ticksRemaining)[0] ?? null
    );
  }

  private displayConvoy():
    | { convoy: VaultFrontConvoyState; source: "self" | "ally" }
    | { convoy: null; source: "none" } {
    const own = this.myConvoy();
    if (own) {
      this.debugVaultSelection("self", own.id);
      return { convoy: own, source: "self" };
    }
    const ally = this.alliedConvoy();
    if (ally) {
      this.debugVaultSelection("ally", ally.id);
      return { convoy: ally, source: "ally" };
    }
    this.debugVaultSelection("none", null);
    return { convoy: null, source: "none" };
  }

  private vaultDebugEnabled(): boolean {
    return this.vaultDebugActive;
  }

  private debugVaultHud(stage: string, payload: Record<string, unknown>): void {
    if (!this.vaultDebugEnabled()) return;
    console.debug(`[VaultFrontHUD:${stage}]`, payload);
  }

  private debugVaultStatus(status: VaultFrontStatusUpdate): void {
    const key = status.convoys
      .map(
        (convoy) =>
          `${convoy.id}:${convoy.ownerID}:${convoy.sourceTile}:${convoy.destinationTile}`,
      )
      .join("|");
    if (key === this.lastVaultDebugStatusKey) return;
    this.lastVaultDebugStatusKey = key;
    this.debugVaultHud("status_update", {
      convoyCount: status.convoys.length,
      convoyIDs: status.convoys.map((convoy) => convoy.id),
      siteControllers: status.sites.map((site) => ({
        id: site.id,
        controllerID: site.controllerID,
        passiveOwnerID: site.passiveOwnerID,
        cooldownTicks: site.cooldownTicks,
      })),
    });
  }

  private initializeVaultDebugState(): void {
    const globalDebug =
      (
        globalThis as {
          __OPENFRONT_VAULT_DEBUG__?: boolean;
          __VAULTFRONT_DEBUG__?: boolean;
        }
      ).__OPENFRONT_VAULT_DEBUG__ === true ||
      (
        globalThis as {
          __OPENFRONT_VAULT_DEBUG__?: boolean;
          __VAULTFRONT_DEBUG__?: boolean;
        }
      ).__VAULTFRONT_DEBUG__ === true;
    if (globalDebug) {
      this.vaultDebugActive = true;
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get(ControlPanel.VAULT_DEBUG_QUERY_PARAM);
      if (fromQuery === "1") {
        this.setVaultDebugEnabled(true, true);
        return;
      }
      if (fromQuery === "0") {
        this.setVaultDebugEnabled(false, true);
        return;
      }
      this.vaultDebugActive =
        localStorage.getItem(ControlPanel.VAULT_DEBUG_STORAGE_KEY) === "1" ||
        sessionStorage.getItem(ControlPanel.VAULT_DEBUG_STORAGE_KEY) === "1";
    } catch {
      this.vaultDebugActive = false;
    }
  }

  private setVaultDebugEnabled(enabled: boolean, persist = false): void {
    this.vaultDebugActive = enabled;
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(
        ControlPanel.VAULT_DEBUG_STORAGE_KEY,
        enabled ? "1" : "0",
      );
      if (persist) {
        localStorage.setItem(
          ControlPanel.VAULT_DEBUG_STORAGE_KEY,
          enabled ? "1" : "0",
        );
      }
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }

  private toggleVaultDebug(): void {
    this.setVaultDebugEnabled(!this.vaultDebugActive, true);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<VaultDebugToggleDetail>(
          ControlPanel.VAULT_DEBUG_EVENT,
          {
            detail: { enabled: this.vaultDebugActive },
          },
        ),
      );
    }
    this.debugVaultHud("debug_toggle", { enabled: this.vaultDebugActive });
  }

  private onVaultDebugToggle = (event: Event): void => {
    const detail = (event as CustomEvent<VaultDebugToggleDetail>).detail;
    if (!detail) return;
    this.setVaultDebugEnabled(detail.enabled, false);
  };

  private resetVaultQaProgress(): void {
    this.vaultQaProgress = {
      vaultCaptured: false,
      passiveIncomeEvents: 0,
      convoyDelivered: 0,
      convoyIntercepted: 0,
      escortCommands: 0,
      reroutesApplied: 0,
      jamBreakersTriggered: 0,
    };
  }

  private updateVaultQaProgress(
    activityUpdates: VaultFrontActivityUpdate[],
    myID: number,
  ): void {
    let next = this.vaultQaProgress;
    for (const update of activityUpdates) {
      if (update.sourcePlayerID !== myID && update.targetPlayerID !== myID) {
        continue;
      }
      if (
        update.activity === "vault_captured" &&
        update.sourcePlayerID === myID
      ) {
        next = { ...next, vaultCaptured: true };
      } else if (
        update.activity === "vault_passive_income" &&
        update.sourcePlayerID === myID
      ) {
        next = {
          ...next,
          passiveIncomeEvents: next.passiveIncomeEvents + 1,
        };
      } else if (
        update.activity === "convoy_delivered" &&
        update.sourcePlayerID === myID
      ) {
        next = {
          ...next,
          convoyDelivered: next.convoyDelivered + 1,
        };
      } else if (
        update.activity === "convoy_intercepted" &&
        (update.sourcePlayerID === myID || update.targetPlayerID === myID)
      ) {
        next = {
          ...next,
          convoyIntercepted: next.convoyIntercepted + 1,
        };
      } else if (
        update.activity === "convoy_escorted" &&
        update.sourcePlayerID === myID
      ) {
        next = {
          ...next,
          escortCommands: next.escortCommands + 1,
        };
      } else if (
        update.activity === "convoy_rerouted" &&
        update.sourcePlayerID === myID
      ) {
        next = {
          ...next,
          reroutesApplied: next.reroutesApplied + 1,
        };
      } else if (
        update.activity === "jam_breaker" &&
        update.sourcePlayerID === myID
      ) {
        next = {
          ...next,
          jamBreakersTriggered: next.jamBreakersTriggered + 1,
        };
      }
    }
    if (next !== this.vaultQaProgress) {
      this.vaultQaProgress = next;
    }
  }

  private renderVaultDebugPanel() {
    if (!this.vaultDebugActive) return "";
    const escortDurationTicks =
      this.latestVaultStatus?.escortDurationTicks ?? 600;
    const checks = [
      {
        label: "Capture a vault",
        done: this.vaultQaProgress.vaultCaptured,
        detail: this.vaultQaProgress.vaultCaptured ? "Done" : "Pending",
      },
      {
        label: "Passive gold twice",
        done: this.vaultQaProgress.passiveIncomeEvents >= 2,
        detail: `${this.vaultQaProgress.passiveIncomeEvents}/2`,
      },
      {
        label: "Convoy delivered",
        done: this.vaultQaProgress.convoyDelivered >= 1,
        detail: `${this.vaultQaProgress.convoyDelivered}`,
      },
      {
        label: "Convoy intercepted",
        done: this.vaultQaProgress.convoyIntercepted >= 1,
        detail: `${this.vaultQaProgress.convoyIntercepted}`,
      },
    ];
    return html`
      <div
        class="mt-1 rounded border border-cyan-300/25 bg-slate-950/45 p-1.5 text-[10px]"
      >
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-cyan-200 font-semibold">Vault QA</div>
            <div class="text-[9px] text-cyan-100/65">
              Live verification checklist
            </div>
          </div>
          <button
            class="rounded border border-cyan-300/35 px-1 py-0.5 text-cyan-100 hover:bg-cyan-500/20"
            @click=${() => this.resetVaultQaProgress()}
            title="Reset this session's VaultFront QA checklist"
          >
            Reset
          </button>
        </div>
        <div class="mt-1 space-y-0.5">
          ${checks.map(
            (check) =>
              html`<div class="flex items-center justify-between gap-2">
                <span
                  class=${check.done ? "text-emerald-200" : "text-slate-200/85"}
                >
                  ${check.done ? "Done" : "Pending"} ${check.label}
                </span>
                <span class="tabular-nums text-cyan-100/75"
                  >${check.detail}</span
                >
              </div>`,
          )}
        </div>
        <div
          class="mt-1 rounded border border-cyan-300/20 bg-slate-900/35 px-1.5 py-1 text-[9px] text-cyan-100/80"
        >
          <div class="font-semibold text-cyan-200/90">Command Ops</div>
          <div class="mt-0.5 tabular-nums">
            Escort ${this.vaultQaProgress.escortCommands} | Reroute
            ${this.vaultQaProgress.reroutesApplied} | Jam
            ${this.vaultQaProgress.jamBreakersTriggered}
          </div>
          <div class="mt-1 font-semibold text-cyan-200/90">Live tuning</div>
          <div class="mt-0.5 tabular-nums">
            Passive ${this.passiveGoldPerMinuteValue().toLocaleString()}g/60s |
            Jam ${this.jamBreakerGoldCostValue().toLocaleString()}g | Escort
            ${Math.ceil(escortDurationTicks / 10)}s
          </div>
        </div>
      </div>
    `;
  }

  private renderVaultDebugWaitingCard() {
    if (!this.vaultDebugActive || this.latestVaultStatus !== null) return "";
    return html`
      <div class="vf-hud-surface rounded-lg p-2 text-[10px] lg:text-[11px]">
        <div class="flex items-center justify-between gap-2">
          <div class="vf-hud-title">VaultFront Debug</div>
          <button
            class="rounded border border-cyan-300/35 px-1 py-0.5 text-cyan-100 hover:bg-cyan-500/20"
            @click=${() => this.toggleVaultDebug()}
          >
            Disable
          </button>
        </div>
        <div class="mt-1 text-slate-100/90">
          Waiting for VaultFront status. Start or unpause the solo match and
          this panel will switch to the live QA checklist.
        </div>
      </div>
    `;
  }

  private debugVaultSelection(
    source: "self" | "ally" | "none",
    selectedConvoyID: number | null,
  ): void {
    const status = this.latestVaultStatus;
    if (!status) return;
    const me = this.game?.myPlayer();
    const ownCount =
      me === null || me === undefined
        ? 0
        : status.convoys.filter((convoy) => convoy.ownerID === me.smallID())
            .length;
    const allyCount =
      me === null || me === undefined
        ? 0
        : status.convoys.filter((convoy) => {
            if (convoy.ownerID === me.smallID()) return false;
            const owner = this.game.playerBySmallID(convoy.ownerID);
            return owner?.isPlayer() === true && me.isFriendly(owner);
          }).length;
    const key = `${source}:${selectedConvoyID ?? "none"}:${ownCount}:${allyCount}:${status.convoys.length}`;
    if (key === this.lastVaultDebugSelectionKey) return;
    this.lastVaultDebugSelectionKey = key;
    this.debugVaultHud("selection", {
      source,
      selectedConvoyID,
      ownCount,
      allyCount,
      totalConvoys: status.convoys.length,
    });
  }

  private nextProjectedConvoyText(): string | null {
    const status = this.latestVaultStatus;
    if (!status) return null;
    const soonest = [...status.sites].sort(
      (a, b) => a.cooldownTicks - b.cooldownTicks,
    )[0];
    if (!soonest) return null;
    const eta = Math.max(0, Math.ceil(soonest.cooldownTicks / 10));
    return `No active convoy | Next vault window ${eta}s | Est +${soonest.projectedGoldReward.toLocaleString()}g +${soonest.projectedTroopsReward.toLocaleString()}t`;
  }

  private convoyRisk(convoy: VaultFrontConvoyState): "Low" | "Medium" | "High" {
    const me = this.game.myPlayer();
    if (!me) return "Low";
    const srcX = this.game.x(convoy.sourceTile);
    const srcY = this.game.y(convoy.sourceTile);
    const dstX = this.game.x(convoy.destinationTile);
    const dstY = this.game.y(convoy.destinationTile);
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

    let hostileSamples = 0;
    const sampleCount = 7;
    for (let i = 0; i < sampleCount; i++) {
      const blend = progress + ((1 - progress) * i) / (sampleCount - 1);
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
        owner.smallID() !== me.smallID() &&
        !me.isFriendly(owner)
      ) {
        hostileSamples++;
      }
    }

    if (hostileSamples >= 4) return "High";
    if (hostileSamples >= 2) return "Medium";
    return "Low";
  }

  private nextVaultObjectiveText(): string {
    const status = this.latestVaultStatus;
    if (!status) return "Vault timers unavailable";

    const myID = this.game.myPlayer()?.smallID();
    const now = this.game.ticks();
    const required = status.captureTicksRequired;

    if (myID !== undefined) {
      const capturing = status.sites
        .filter((site) => site.controllerID === myID && site.cooldownTicks <= 0)
        .sort((a, b) => b.controlTicks - a.controlTicks)[0];
      if (capturing) {
        const secs = Math.max(
          0,
          Math.ceil((required - capturing.controlTicks) / 10),
        );
        return `Vault ${capturing.id} capture in ${secs}s`;
      }

      const passive = status.sites
        .filter(
          (site) =>
            site.passiveOwnerID === myID && site.nextPassiveIncomeTick > now,
        )
        .sort((a, b) => a.nextPassiveIncomeTick - b.nextPassiveIncomeTick)[0];
      if (passive) {
        const secs = Math.max(
          0,
          Math.ceil((passive.nextPassiveIncomeTick - now) / 10),
        );
        return `Vault ${passive.id} passive +gold in ${secs}s`;
      }
    }

    const openSite = status.sites
      .filter((site) => site.cooldownTicks <= 0)
      .sort((a, b) => a.id - b.id)[0];
    if (openSite) {
      return `Vault ${openSite.id} is open for capture`;
    }

    const soonest = [...status.sites].sort(
      (a, b) => a.cooldownTicks - b.cooldownTicks,
    )[0];
    const secs = Math.max(0, Math.ceil(soonest.cooldownTicks / 10));
    return `Next vault opens in ${secs}s`;
  }

  private viewportWidth(): number {
    return typeof window !== "undefined" ? window.innerWidth : 1920;
  }

  private isMobilePriorityMode(): boolean {
    return (
      this.runtimeHudVariant === "mobile_priority" ||
      this.hudPreset === "mobile" ||
      this.viewportWidth() < 980
    );
  }

  private onReducedMotionChanged = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };

  private onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (!this._isVisible) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "1") {
      this.sendEscortCommand();
    } else if (key === "2") {
      this.sendRerouteSafestCommand();
    } else if (key === "3") {
      this.sendJamBreakerCommand();
    } else if (key === "4") {
      this.toggleJamOnNextPulse();
    } else if (key === "5") {
      this.expandAdvancedCommands();
    } else {
      return;
    }
    event.preventDefault();
  };

  private async resolveRuntimeAssignment(): Promise<void> {
    const assignment = await fetchVaultFrontRuntimeAssignment();
    if (assignment === false) return;
    this.runtimeRewardVariant = assignment.rewardVariant;
    this.runtimeHudVariant = assignment.hudVariant;
    const hasPreset = readHudLayout().preset !== undefined;
    if (assignment.hudVariant === "mobile_priority" && !hasPreset) {
      this.hudPreset = "mobile";
      this.hudCompactMode = true;
      this.persistHudLayout({
        preset: "mobile",
        controlPanelCompact: true,
        leftDockExpanded: false,
      });
    }
    logHudTelemetry("hud_runtime_variant_exposed", {
      rewardVariant: assignment.rewardVariant,
      hudVariant: assignment.hudVariant,
    });
    void recordVaultFrontRuntimeEvent({
      event: `exposure_${assignment.rewardVariant}_${assignment.hudVariant}`,
      rewardVariant: assignment.rewardVariant,
      hudVariant: assignment.hudVariant,
      value: 1,
    });
  }

  private onHudLayoutUpdated = (event: CustomEvent): void => {
    const detail = (event.detail ?? {}) as ReturnType<typeof readHudLayout>;
    this.applyHudLayout(detail);
  };

  private applyHudLayout(layout: ReturnType<typeof readHudLayout>): void {
    this.hudCompactMode =
      layout.controlPanelCompact !== undefined
        ? layout.controlPanelCompact === true
        : this.viewportWidth() < 1450;
    this.hudEditMode = layout.editMode === true;
    this.hudScale = applyGlobalHudScale(layout.uiScale ?? this.hudScale ?? 1);
    this.hudPreset = layout.preset ?? this.hudPreset;
    this.panelOffsetX = Number(
      layout.controlPanelOffsetX ?? this.panelOffsetX ?? 0,
    );
    this.panelOffsetY = Number(
      layout.controlPanelOffsetY ?? this.panelOffsetY ?? 0,
    );
    this.vaultNoticeSortMode =
      layout.vaultNoticeSortMode ?? this.vaultNoticeSortMode;
  }

  private loadHudLayout(): void {
    this.applyHudLayout(readHudLayout());
  }

  private persistHudLayout(
    patch: Parameters<typeof writeHudLayout>[0],
    telemetryAction?: string,
  ): void {
    const next = writeHudLayout(patch);
    this.applyHudLayout(next);
    dispatchHudLayoutUpdate(next);
    if (telemetryAction) {
      logHudTelemetry(telemetryAction);
    }
  }

  private detectHudCollision(): void {
    if (this.hudEditMode) return;
    const nowTick = this.game?.ticks() ?? 0;
    if (nowTick < this.hudCollisionCheckNextTick) return;
    this.hudCollisionCheckNextTick = nowTick + 10;

    const selfRect = this.getBoundingClientRect();
    const eventsEl = document.querySelector(
      "events-display",
    ) as HTMLElement | null;
    const attacksEl = document.querySelector(
      "attacks-display",
    ) as HTMLElement | null;
    const eventsRect = eventsEl?.getBoundingClientRect();
    const attacksRect = attacksEl?.getBoundingClientRect();

    const overlaps = (a: DOMRect, b: DOMRect | undefined): boolean => {
      if (!b) return false;
      return !(
        a.right < b.left ||
        a.left > b.right ||
        a.bottom < b.top ||
        a.top > b.bottom
      );
    };

    const nextCompact =
      overlaps(selfRect, eventsRect) || overlaps(selfRect, attacksRect);
    if (nextCompact !== this.hudCompactMode) {
      this.hudCompactMode = nextCompact;
      this.persistHudLayout({ controlPanelCompact: this.hudCompactMode });
    }
  }

  private isTerritoryNearVault(tile: number, myID: number): boolean {
    const tx = this.game.x(tile);
    const ty = this.game.y(tile);
    const range = ControlPanel.VAULT_NOTICE_TERRITORY_RANGE;
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

  private riskTrendLabel(
    siteID: number,
    riskScore: number,
  ): "Rising" | "Falling" | "Stable" {
    const previous = this.lastRiskByVault.get(siteID) ?? riskScore;
    this.lastRiskByVault.set(siteID, riskScore);
    const delta = riskScore - previous;
    if (delta >= 1) return "Rising";
    if (delta <= -1) return "Falling";
    return "Stable";
  }

  private recommendedNoticeAction(
    site: VaultFrontStatusUpdate["sites"][number],
    myID: number,
  ): { actionLabel: "Capture" | "Defend" | "Intercept"; actionTile: number } {
    if (site.passiveOwnerID === myID) {
      return { actionLabel: "Defend", actionTile: site.tile };
    }
    if (site.cooldownTicks <= 0) {
      return { actionLabel: "Capture", actionTile: site.tile };
    }
    const enemyConvoyTile =
      this.latestVaultStatus?.convoys.find((convoy) => convoy.ownerID !== myID)
        ?.destinationTile ?? site.tile;
    return { actionLabel: "Intercept", actionTile: enemyConvoyTile };
  }

  private buildVaultNotices(): VaultNotice[] {
    const status = this.latestVaultStatus;
    if (!status) return [];
    const myID = this.game.myPlayer()?.smallID();
    if (myID === undefined) return [];
    const now = this.game.ticks();
    const noticesByTile = new Map<number, VaultNotice>();

    for (const site of status.sites) {
      if (!this.isTerritoryNearVault(site.tile, myID)) {
        continue;
      }
      const openEta = Math.max(0, Math.ceil(site.cooldownTicks / 10));
      const riskScore = this.vaultSiteRiskScore(site.tile, myID);
      const trend = this.riskTrendLabel(site.id, riskScore);
      const action = this.recommendedNoticeAction(site, myID);
      const baseLabel =
        site.cooldownTicks <= 0
          ? `Vault ${site.id} is open now`
          : `Vault ${site.id} opens in ${openEta}s`;
      const baseDetails =
        `${site.rewardMath} | projected +${site.projectedGoldReward.toLocaleString()} gold, ` +
        `+${site.projectedTroopsReward.toLocaleString()} troops` +
        (site.reducedRewardNextCapture
          ? " | reduced recapture value active"
          : "");
      const baseNotice: VaultNotice = {
        key: `site-${site.id}`,
        siteID: site.id,
        tile: site.tile,
        label: baseLabel,
        etaSeconds: openEta,
        details: baseDetails,
        riskScore,
        risk: this.riskLabelFromScore(riskScore),
        trend,
        actionLabel: action.actionLabel,
        actionTile: action.actionTile,
      };
      noticesByTile.set(site.tile, baseNotice);

      if (site.passiveOwnerID === myID && site.nextPassiveIncomeTick > now) {
        const passiveEta = Math.max(
          0,
          Math.ceil((site.nextPassiveIncomeTick - now) / 10),
        );
        const passiveRiskScore = this.vaultSiteRiskScore(site.tile, myID);
        const merged = noticesByTile.get(site.tile);
        const mergedLabel = `Vault ${site.id} passive +gold in ${passiveEta}s`;
        const passiveDetails = `${site.rewardMath} | passive +${this.passiveGoldPerMinuteValue().toLocaleString()} gold every 60s while held`;
        if (!merged) {
          noticesByTile.set(site.tile, {
            key: `passive-${site.id}`,
            siteID: site.id,
            tile: site.tile,
            label: mergedLabel,
            etaSeconds: passiveEta,
            details: passiveDetails,
            riskScore: passiveRiskScore,
            risk: this.riskLabelFromScore(passiveRiskScore),
            trend: this.riskTrendLabel(site.id, passiveRiskScore),
            actionLabel: "Defend",
            actionTile: site.tile,
          });
        } else {
          merged.label = `${merged.label} | passive +gold ${passiveEta}s`;
          merged.etaSeconds = Math.min(merged.etaSeconds, passiveEta);
          merged.riskScore = Math.max(merged.riskScore, passiveRiskScore);
          merged.risk = this.riskLabelFromScore(merged.riskScore);
          merged.details = `${merged.details} | ${passiveDetails}`;
          merged.trend = this.riskTrendLabel(site.id, merged.riskScore);
          merged.actionLabel = "Defend";
          merged.actionTile = site.tile;
        }
      }
    }

    const notices = [...noticesByTile.values()];

    if (this.vaultNoticeSortMode === "risk") {
      notices.sort(
        (a, b) => b.riskScore - a.riskScore || a.etaSeconds - b.etaSeconds,
      );
    } else {
      notices.sort(
        (a, b) => a.etaSeconds - b.etaSeconds || b.riskScore - a.riskScore,
      );
    }
    return notices.slice(0, 1);
  }

  private vaultSiteRiskScore(tile: number, myID: number | undefined): number {
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    let hostile = 0;
    let friendly = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (dx === 0 && dy === 0) continue;
        const sx = Math.max(0, Math.min(this.game.width() - 1, x + dx));
        const sy = Math.max(0, Math.min(this.game.height() - 1, y + dy));
        const owner = this.game.owner(this.game.ref(sx, sy));
        if (!owner.isPlayer() || myID === undefined) continue;
        if (owner.smallID() === myID) {
          friendly++;
        } else if (!this.game.myPlayer()?.isFriendly(owner)) {
          hostile++;
        }
      }
    }
    const score = hostile * 2 - friendly;
    return Math.max(0, Math.min(9, score));
  }

  private riskLabelFromScore(score: number): "Low" | "Medium" | "High" {
    if (score >= 6) return "High";
    if (score >= 3) return "Medium";
    return "Low";
  }

  private riskBadgeClass(risk: "Low" | "Medium" | "High"): string {
    if (risk === "High")
      return "bg-orange-500/25 text-orange-100 border-orange-300/45";
    if (risk === "Medium")
      return "bg-sky-500/25 text-sky-100 border-sky-300/45";
    return "bg-slate-500/25 text-slate-100 border-slate-300/45";
  }

  private trendBadgeClass(trend: "Rising" | "Falling" | "Stable"): string {
    if (trend === "Rising")
      return "bg-rose-500/20 text-rose-100 border-rose-300/40";
    if (trend === "Falling")
      return "bg-emerald-500/20 text-emerald-100 border-emerald-300/40";
    return "bg-slate-500/20 text-slate-100 border-slate-300/40";
  }

  private focusVault(tile: number): void {
    this.eventBus.emit(
      new GoToPositionEvent(this.game.x(tile), this.game.y(tile)),
    );
    logHudTelemetry("hud_vault_notice_jump");
  }

  private performNoticeAction(notice: VaultNotice): void {
    if (notice.actionLabel === "Capture") {
      this.focusVault(notice.actionTile);
      return;
    }
    if (notice.actionLabel === "Defend") {
      this.focusVault(notice.actionTile);
      this.sendRolePing("escort_convoy");
      return;
    }
    this.focusVault(notice.actionTile);
    this.sendRolePing("intercept_lane");
  }

  private toggleVaultNoticeSortMode(): void {
    this.vaultNoticeSortMode =
      this.vaultNoticeSortMode === "eta" ? "risk" : "eta";
    this.persistHudLayout(
      { vaultNoticeSortMode: this.vaultNoticeSortMode },
      "hud_vault_notice_sort_toggle",
    );
  }

  private renderVaultNotices(
    notices: VaultNotice[] = this.buildVaultNotices(),
  ) {
    if (notices.length === 0) return "";
    const compact = this.isMobilePriorityMode();
    return html`
      <div
        class="mt-2 rounded-md border border-amber-300/40 bg-amber-950/25 ${
          compact ? "p-1.5" : "p-2"
        }"
      >
        <div class="flex items-center justify-between gap-2">
          <div
            class="text-[9px] lg:text-[10px] uppercase tracking-wide text-amber-200 font-semibold"
          >
            Vault Notices
          </div>
          <button
            class="rounded border border-amber-300/40 px-1 py-0.5 text-[9px] lg:text-[10px] text-amber-100 hover:bg-amber-400/15"
            title="Toggle notice sort"
            @click=${() => this.toggleVaultNoticeSortMode()}
          >
            Sort: ${this.vaultNoticeSortMode === "eta" ? "ETA" : "Risk"}
          </button>
        </div>
        <div class="mt-1 flex flex-col gap-1">
          ${notices.map(
            (notice) => html`
              <div
                class="w-full text-left ${
                  compact ? "px-1.5 py-1.5" : "px-1.5 py-1"
                } rounded bg-amber-400/15 hover:bg-amber-400/25 text-amber-50 text-[10px] lg:text-[11px] pointer-events-auto touch-manipulation"
                title=${`${notice.details} | Click to center camera`}
                role="button"
                tabindex="0"
                @click=${() => this.focusVault(notice.tile)}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.focusVault(notice.tile);
                  }
                }}
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate"
                    >${
                      compact
                        ? `V${notice.siteID} ${notice.etaSeconds}s`
                        : notice.label
                    }</span
                  >
                  <div class="shrink-0 flex items-center gap-1">
                    <span
                      class="rounded border px-1 py-0.5 text-[9px] lg:text-[10px] ${this.riskBadgeClass(
                        notice.risk,
                      )}"
                      >${notice.risk}</span
                    >
                    <span
                      class="rounded border px-1 py-0.5 text-[9px] lg:text-[10px] ${this.trendBadgeClass(
                        notice.trend,
                      )}"
                      >${notice.trend}</span
                    >
                  </div>
                </div>
                ${
                  compact
                    ? ""
                    : html`<div
                        class="mt-0.5 text-[10px] text-amber-100/85 truncate"
                      >
                        ${notice.details}
                      </div>`
                }
                <div class="mt-1 flex justify-end">
                  <button
                    class="rounded border border-cyan-300/45 bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-50 hover:bg-cyan-500/30"
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      this.performNoticeAction(notice);
                    }}
                  >
                    ${notice.actionLabel}
                  </button>
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private passiveGoldPerMinuteValue(): number {
    return this.latestVaultStatus?.passiveGoldPerMinute ?? 75_000;
  }

  private jamBreakerGoldCostValue(): number {
    return (
      this.latestVaultStatus?.jamBreakerGoldCost ??
      ControlPanel.JAM_BREAKER_GOLD_COST
    );
  }

  private hasActiveEnemyPulse(): boolean {
    const status = this.latestVaultStatus;
    const me = this.game.myPlayer();
    const ticks = this.game.ticks();
    if (!status || !me) return false;
    return status.beacons.some((beacon) => {
      if (beacon.maskedUntilTick <= ticks) return false;
      const player = this.game.playerBySmallID(beacon.playerID);
      if (!player || !player.isPlayer()) return false;
      return player.smallID() !== me.smallID() && !me.isFriendly(player);
    });
  }

  private livePulseSummary(jamLockoutSecs: number): string {
    const beacon = this.myBeacon();
    if (this.hasActiveEnemyPulse()) {
      return jamLockoutSecs > 0
        ? `Enemy pulse live. Jam ready again in ${jamLockoutSecs}s.`
        : "Enemy pulse live. Jam now or pre-arm Jam Next Pulse.";
    }
    if (!beacon) return "No Defense Factory online yet.";
    if (beacon.cooldownUntilTick > this.game.ticks()) {
      return `Your pulse recharges in ${Math.ceil((beacon.cooldownUntilTick - this.game.ticks()) / 10)}s.`;
    }
    if (beacon.charge >= 60) {
      return `Defense Factory nearly ready at ${Math.floor(beacon.charge)}% charge.`;
    }
    return `Defense Factory at ${Math.floor(beacon.charge)}% charge.`;
  }

  private commandPriorityCallout(
    ownConvoy: VaultFrontConvoyState | null,
    leadNotice: VaultNotice | null,
    jamLockoutSecs: number,
    escortLockoutSecs: number,
  ): {
    title: string;
    detail: string;
    tone: "amber" | "cyan" | "fuchsia" | "emerald";
  } {
    if (ownConvoy) {
      const risk = this.convoyRisk(ownConvoy);
      if (risk === "High" && escortLockoutSecs <= 0) {
        return {
          title: "Act Now",
          detail:
            "Shield Nearest before contact. Your active convoy is on a high-threat lane.",
          tone: "amber",
        };
      }
      if (risk !== "Low") {
        return {
          title: "Stabilize Route",
          detail:
            "Reroute Safest if the lane stays pressured. Save Shield for first enemy touch.",
          tone: "cyan",
        };
      }
    }
    if (this.hasActiveEnemyPulse()) {
      return {
        title: jamLockoutSecs > 0 ? "Pulse Pressure" : "Counter Pulse",
        detail:
          jamLockoutSecs > 0
            ? `Enemy pulse is live. Survive ${jamLockoutSecs}s, then fire Jam Breaker.`
            : "Enemy pulse is live. Jam Breaker is your cleanest answer right now.",
        tone: "fuchsia",
      };
    }
    if (leadNotice) {
      return {
        title:
          leadNotice.actionLabel === "Capture" ? "Capture Window" : "Map Call",
        detail:
          leadNotice.actionLabel === "Capture"
            ? `Vault ${leadNotice.siteID} is the next swing objective. Rotate before the window closes.`
            : leadNotice.actionLabel === "Defend"
              ? `Hold Vault ${leadNotice.siteID} through the next passive payout before rotating out.`
              : `Set up to cut the next enemy route near Vault ${leadNotice.siteID}.`,
        tone: leadNotice.actionLabel === "Capture" ? "emerald" : "cyan",
      };
    }
    return {
      title: "Setup",
      detail:
        "No live convoy yet. Capture the nearest vault and keep Jam available for the first enemy pulse.",
      tone: "emerald",
    };
  }

  private currentCommandHint(): string {
    const spawnTicks = this.game?.config().numSpawnPhaseTurns() ?? 0;
    const liveTicks = Math.max(0, (this.game?.ticks() ?? 0) - spawnTicks);
    const ownConvoy = this.myConvoy();
    const leadNotice = this.buildVaultNotices()[0] ?? null;
    if (ownConvoy) {
      const risk = this.convoyRisk(ownConvoy);
      if (risk === "High") {
        return "High-threat convoy: Shield first, then reroute only if the lane stays red.";
      }
      if (risk === "Medium") {
        return "Medium-threat convoy: Reroute Safest is usually better than spending Jam early.";
      }
      return "Low-threat convoy: keep Shield available and greed the safer payout line.";
    }
    if (this.hasActiveEnemyPulse()) {
      return this.jamOnNextPulseArmed
        ? "Jam Next Pulse is armed. Let it auto-fire unless you need manual Jam immediately."
        : "Enemy pulse is live. Jam Breaker wins more value than an early reroute here.";
    }
    if (leadNotice?.actionLabel === "Capture") {
      return "Open vaults matter more than passive income races. Rotate early and secure the first payout.";
    }
    if (leadNotice?.actionLabel === "Intercept") {
      return "No personal convoy yet: set up on the shortest enemy lane instead of waiting idle.";
    }
    if (this.shouldTrimUnderusedCommands()) {
      return "More opens pings, lane previews, and Jam Next Pulse once the core loop feels automatic.";
    }
    if (liveTicks > 3_600) return "";
    return "Shield Nearest, Reroute Safest, Jam Breaker: treat them as one clean cycle, not separate buttons.";
  }

  private adaptiveNudgeText(): string | null {
    if (!this.adaptiveNudgeKey) return null;
    if (this.adaptiveNudgeKey === "vault_first") {
      return "Adaptive nudge: path to the first nearby vault by 2:30, then hold for one passive payout.";
    }
    if (this.adaptiveNudgeKey === "convoy_impact") {
      return "Adaptive nudge: spend one Shield or one Intercept on the very first convoy cycle.";
    }
    if (this.adaptiveNudgeKey === "pulse_chain") {
      return "Adaptive nudge: save Jam for a live enemy pulse and chain your next factory window behind it.";
    }
    return "Adaptive nudge: hold one focus setting per phase and only flip after a clean disengage.";
  }

  private activeCoachmark(): "shield" | "reroute" | "jamBreaker" | null {
    if (!this.coachmarksEnabled || !this.onboardingChainCompleted())
      return null;
    if (!this.coachmarkProgress.shield) return "shield";
    if (!this.coachmarkProgress.reroute) return "reroute";
    if (!this.coachmarkProgress.jamBreaker) return "jamBreaker";
    return null;
  }

  private renderCoachmark(
    key: "shield" | "reroute" | "jamBreaker",
    text: string,
  ) {
    if (this.activeCoachmark() !== key) return "";
    return html`<div
      class="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-cyan-300/45 bg-slate-900/95 px-1.5 py-0.5 text-[10px] text-cyan-100 shadow-lg"
    >
      ${text}
    </div>`;
  }

  private markCoachmarkComplete(key: keyof CoachmarkProgress): void {
    if (
      !this.coachmarksEnabled ||
      !this.onboardingChainCompleted() ||
      this.coachmarkProgress[key]
    )
      return;
    this.coachmarkProgress = {
      ...this.coachmarkProgress,
      [key]: true,
    };
    localStorage.setItem(
      ControlPanel.COACHMARK_KEY,
      JSON.stringify(this.coachmarkProgress),
    );
    logHudTelemetry("hud_coachmark_step_complete", { step: key });
    const done =
      this.coachmarkProgress.shield &&
      this.coachmarkProgress.reroute &&
      this.coachmarkProgress.jamBreaker;
    if (done) {
      this.coachmarksEnabled = false;
      logHudTelemetry("hud_coachmark_completed");
    }
  }

  private cooldownRingStyle(
    remainingSeconds: number,
    totalSeconds: number,
    color: string,
  ): string {
    if (remainingSeconds <= 0 || totalSeconds <= 0) return "";
    const ratio = Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
    return `background-image: conic-gradient(${color} ${Math.round(ratio * 360)}deg, rgba(15,23,42,0.32) 0deg);`;
  }

  private activeReroutePreview(convoy: VaultFrontConvoyState): {
    command:
      | "reroute_city"
      | "reroute_port"
      | "reroute_factory"
      | "reroute_silo"
      | "reroute_safest";
    destinationTile: number;
    etaSeconds: number;
    routeRisk: number;
    routeDistance: number;
    rewardMultiplier: number;
    rewardScale: number;
    strengthMultiplier: number;
    phaseMultiplier: number;
    riskMultiplier: number;
    goldReward: number;
    troopsReward: number;
    rewardMath: string;
    deltaGold: number;
    deltaTroops: number;
    deltaEtaSeconds: number;
    deltaRisk: number;
  } | null {
    const previews = convoy.reroutePreviews ?? [];
    return (
      previews.find((entry) => entry.command === this.selectedPreviewCommand) ??
      previews[0] ??
      null
    );
  }

  private sendRerouteSpecificCommand(
    command:
      | "reroute_city"
      | "reroute_port"
      | "reroute_factory"
      | "reroute_silo"
      | "reroute_safest",
  ): void {
    if (!this.myConvoy()) return;
    this.eventBus.emit(new SendVaultConvoyCommandIntentEvent(command));
    if (command === "reroute_city") this.convoyRoutePreference = "city";
    if (command === "reroute_port") this.convoyRoutePreference = "port";
    if (command === "reroute_factory") this.convoyRoutePreference = "factory";
    if (command === "reroute_silo") this.convoyRoutePreference = "silo";
    this.markCoachmarkComplete("reroute");
    const lane =
      command === "reroute_city"
        ? "city"
        : command === "reroute_port"
          ? "port"
          : command === "reroute_factory"
            ? "factory"
            : command === "reroute_silo"
              ? "silo"
              : "safest";
    logHudTelemetry("hud_command_reroute_preview_apply", { lane });
    void recordVaultFrontRuntimeEvent({
      event: `reroute_apply_${lane}`,
      rewardVariant: this.runtimeRewardVariant,
      hudVariant: this.runtimeHudVariant,
      value: 1,
    });
  }

  private renderReroutePreviewPanel(convoy: VaultFrontConvoyState) {
    const previews = convoy.reroutePreviews ?? [];
    if (previews.length === 0) return "";
    const selected = this.activeReroutePreview(convoy);
    if (!selected) return "";
    const compact = this.isMobilePriorityMode();
    const laneLabel = (command: string): string =>
      command === "reroute_city"
        ? "City"
        : command === "reroute_port"
          ? "Port"
          : command === "reroute_factory"
            ? "Factory"
            : command === "reroute_silo"
              ? "Silo"
              : "Safest";
    return html`
      <div
        class="mt-1 rounded border border-cyan-300/35 bg-cyan-950/20 ${
          compact ? "p-1" : "p-1.5"
        }"
      >
        <div class="text-[10px] text-cyan-100/90">
          ${compact ? "Reroute Preview" : "Pre-Action Reroute Preview"}
        </div>
        <div
          class="mt-1 ${compact ? "grid grid-cols-3" : "flex flex-wrap"} gap-1"
        >
          ${previews.map(
            (preview) => html`
              <button
                class="rounded border ${
                  compact ? "px-1 py-1" : "px-1.5 py-0.5"
                } text-[10px] ${
                  this.selectedPreviewCommand === preview.command
                    ? "border-cyan-200/70 bg-cyan-500/25 text-cyan-50"
                    : "border-cyan-300/35 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                }"
                @mouseenter=${() =>
                  (this.selectedPreviewCommand = preview.command)}
                @focus=${() => (this.selectedPreviewCommand = preview.command)}
                @click=${() => (this.selectedPreviewCommand = preview.command)}
              >
                ${laneLabel(preview.command)}
              </button>
            `,
          )}
        </div>
        <div class="mt-1 text-[10px] text-cyan-50 tabular-nums">
          ETA ${selected.etaSeconds}s
          (${
            selected.deltaEtaSeconds >= 0 ? "+" : ""
          }${selected.deltaEtaSeconds}s)
          | Risk ${selected.routeRisk.toFixed(2)}
          (${selected.deltaRisk >= 0 ? "+" : ""}${selected.deltaRisk.toFixed(
            2,
          )})
        </div>
        <div class="text-[10px] text-cyan-100/90 tabular-nums">
          Est +${selected.goldReward.toLocaleString()}g
          (${
            selected.deltaGold >= 0 ? "+" : ""
          }${selected.deltaGold.toLocaleString()}g)
          ${
            compact
              ? ""
              : html` +${selected.troopsReward.toLocaleString()}t
                (${
                  selected.deltaTroops >= 0 ? "+" : ""
                }${selected.deltaTroops.toLocaleString()}t)`
          }
        </div>
        <button
          class="mt-1 rounded border border-cyan-200/50 bg-cyan-500/25 px-1.5 py-0.5 text-[10px] text-cyan-50 hover:bg-cyan-500/35"
          @click=${() => this.sendRerouteSpecificCommand(selected.command)}
        >
          ${compact ? "Apply" : "Apply Previewed Reroute"}
        </button>
      </div>
    `;
  }

  private renderRewardExplainPanel(convoy: VaultFrontConvoyState | null) {
    if (!convoy) return "";
    const compact = this.isMobilePriorityMode();
    const penaltyText =
      convoy.rewardScale < 1
        ? `${Math.round((1 - convoy.rewardScale) * 100)}% penalty active`
        : "No penalty";
    const expectedRaw =
      convoy.strengthMultiplier *
      convoy.phaseMultiplier *
      convoy.riskMultiplier *
      convoy.rewardScale;
    return html`
      <div
        class="mt-1 rounded border border-amber-300/35 bg-amber-950/20 ${
          compact ? "p-1" : "p-1.5"
        }"
      >
        <button
          class="w-full text-left text-[10px] text-amber-100 hover:text-amber-50"
          @click=${() =>
            (this.rewardExplainExpanded = !this.rewardExplainExpanded)}
        >
          ${this.rewardExplainExpanded ? "Hide" : "Show"}
          ${compact ? "Explain" : "Reward Explain"}
        </button>
        ${
          compact
            ? html`<div
                class="mt-0.5 text-[10px] text-amber-100/90 tabular-nums"
              >
                x${convoy.rewardMultiplier.toFixed(2)} | risk
                ${convoy.routeRisk.toFixed(2)} | d${convoy.routeDistance}
              </div>`
            : ""
        }
        ${
          this.rewardExplainExpanded
            ? html`
                <div class="mt-1 text-[10px] text-amber-50 tabular-nums">
                  Distance: ${convoy.routeDistance} | Route risk:
                  ${convoy.routeRisk.toFixed(2)}
                </div>
                <div class="text-[10px] text-amber-100/90 tabular-nums">
                  Strength ${convoy.strengthMultiplier.toFixed(2)} x Phase
                  ${convoy.phaseMultiplier.toFixed(2)} x Risk
                  ${convoy.riskMultiplier.toFixed(2)}
                </div>
                <div class="text-[10px] text-amber-100/90 tabular-nums">
                  Penalty scale ${convoy.rewardScale.toFixed(2)} | Raw
                  ${expectedRaw.toFixed(2)} | Applied
                  ${convoy.rewardMultiplier.toFixed(2)}
                </div>
                <div class="text-[10px] text-amber-200/90">${penaltyText}</div>
                ${
                  compact
                    ? ""
                    : html`<div class="mt-0.5 text-[10px] text-amber-100/90">
                        ${convoy.rewardMath}
                      </div>`
                }
              `
            : ""
        }
      </div>
    `;
  }

  private renderVaultHud() {
    const status = this.latestVaultStatus;
    if (!status) return "";
    const compact = this.isMobilePriorityMode();
    const myPlayer = this.game.myPlayer();
    const myPressure = myPlayer
      ? status.pressure?.[myPlayer.smallID()]
      : undefined;
    const pressureWindowSeconds = myPressure
      ? Math.max(
          0,
          Math.ceil(
            (myPressure.breachWindowUntilTick - this.game.ticks()) / 10,
          ),
        )
      : 0;

    // Frozen VaultFront interaction model: own convoy > allied convoy > projected next vault.
    const convoyDisplay = this.displayConvoy();
    const ownConvoy = this.myConvoy();
    const convoy = convoyDisplay.convoy;
    const notices = this.buildVaultNotices();
    const leadNotice = notices[0] ?? null;
    const showAdvanced = this.advancedCommandsExpanded;
    const primaryTitle = convoy
      ? `${convoyDisplay.source === "ally" ? "Ally" : "Vault"} Convoy ${Math.ceil(convoy.ticksRemaining / 10)}s`
      : "No active convoy";
    const primarySubtitle = convoy
      ? `Risk ${this.convoyRisk(convoy)} | +${convoy.goldReward.toLocaleString()}g +${convoy.troopsReward.toLocaleString()}t`
      : leadNotice
        ? `Next vault ${leadNotice.etaSeconds}s | Est +${status.sites.find((site) => site.id === leadNotice.siteID)?.projectedGoldReward.toLocaleString() ?? "0"}g`
        : (this.nextProjectedConvoyText() ?? "Waiting for next vault window");
    const recommendedAction = leadNotice
      ? `${leadNotice.actionLabel} Vault ${leadNotice.siteID}`
      : ownConvoy
        ? "Protect active convoy"
        : "Contest nearest vault";

    const beacon = this.myBeacon();
    const now = this.game.ticks();
    let beaconText = "Defense Factory unavailable";
    let jamLockoutSecs = 0;
    let escortLockoutSecs = 0;
    if (beacon) {
      const activeSecs = Math.max(
        0,
        Math.ceil((beacon.maskedUntilTick - now) / 10),
      );
      const cooldownSecs = Math.max(
        0,
        Math.ceil((beacon.cooldownUntilTick - now) / 10),
      );
      jamLockoutSecs = Math.max(
        0,
        Math.ceil((beacon.jamBreakerCooldownUntilTick - now) / 10),
      );
      escortLockoutSecs = Math.max(
        0,
        Math.ceil((beacon.escortUntilTick - now) / 10),
      );
      if (activeSecs > 0) {
        beaconText = `Defense Factory pulse ${activeSecs}s`;
      } else if (cooldownSecs > 0) {
        beaconText = `Defense Factory cooldown ${cooldownSecs}s | charge ${Math.floor(beacon.charge)}%`;
      } else {
        beaconText = `Defense Factory charge ${Math.floor(beacon.charge)}% (ready at 72%)`;
      }
    }
    const escortDisabled = escortLockoutSecs > 0;
    const rerouteDisabled = ownConvoy === null;
    const jamBreakerDisabled = jamLockoutSecs > 0;
    const jamNextDisabled = jamLockoutSecs > 0 && !this.jamOnNextPulseArmed;
    const oneTapButtonClass = compact
      ? "px-2.5 py-1.5 text-[11px] min-h-8"
      : "px-1.5 py-1";
    const escortRingStyle = this.cooldownRingStyle(
      escortLockoutSecs,
      60,
      "rgba(251,191,36,0.58)",
    );
    const jamRingStyle = this.cooldownRingStyle(
      jamLockoutSecs,
      90,
      "rgba(232,121,249,0.58)",
    );
    const jamNextRingStyle = this.cooldownRingStyle(
      jamLockoutSecs,
      90,
      "rgba(232,121,249,0.42)",
    );
    const escortLabel =
      escortLockoutSecs > 0
        ? `Shield Nearest ${escortLockoutSecs}s`
        : "Shield Nearest";
    const reroutePresetLabel =
      this.quickRolePreset === "aggro"
        ? "Reroute Aggro"
        : this.quickRolePreset === "control"
          ? "Reroute Control"
          : "Reroute Safest";
    const rerouteLabel = rerouteDisabled
      ? `${reroutePresetLabel} (No Convoy)`
      : reroutePresetLabel;
    const jamLabel =
      jamLockoutSecs > 0 ? `Jam Breaker ${jamLockoutSecs}s` : "Jam Breaker";
    const jamNextLabel = this.jamOnNextPulseArmed
      ? "Jam Next Pulse: Armed"
      : jamNextDisabled
        ? `Jam Next Pulse ${jamLockoutSecs}s`
        : "Jam on Next Pulse";
    const jamCostText = `${this.jamBreakerGoldCostValue().toLocaleString()} gold`;
    const lockedSites = status.sites.filter(
      (site) => site.cooldownTicks > 0,
    ).length;
    const nextOpenSite = [...status.sites].sort(
      (a, b) => a.cooldownTicks - b.cooldownTicks,
    )[0];
    const nextOpenSecs = nextOpenSite
      ? Math.max(0, Math.ceil(nextOpenSite.cooldownTicks / 10))
      : 0;
    const passiveGoldText = `${this.passiveGoldPerMinuteValue().toLocaleString()}g`;
    const commandCallout = this.commandPriorityCallout(
      ownConvoy,
      leadNotice,
      jamLockoutSecs,
      escortLockoutSecs,
    );
    const trimUnderused = this.shouldTrimUnderusedCommands();
    const adaptiveNudge = this.adaptiveNudgeText();
    const commandHint = this.currentCommandHint();
    const primaryRowClass = compact
      ? "mt-1.5 grid grid-cols-3 gap-1"
      : "mt-1.5 grid grid-cols-3 gap-1";

    return html`
      <div
        class="vf-hud-surface mt-1.5 rounded-lg ${
          compact ? "p-1.5" : "p-2"
        } text-[10px] lg:text-[11px]"
      >
        <div class="vf-hud-title mb-1">VaultFront HUD</div>
        <div class="text-slate-100 tabular-nums">
          ${this.nextVaultObjectiveText()}
        </div>
        ${
          myPressure
            ? html`<div
                class="mt-1 rounded border px-1.5 py-1 tabular-nums ${
                  pressureWindowSeconds > 0
                    ? "border-rose-300/60 bg-rose-950/35 text-rose-100"
                    : "border-cyan-300/30 bg-cyan-950/20 text-cyan-100"
                }"
                role="status"
                aria-label="Vault Pressure"
              >
                ${
                  pressureWindowSeconds > 0
                    ? "BREACH WINDOW " +
                      pressureWindowSeconds +
                      "s — deliver one convoy to win"
                    : "Vault Pressure " +
                      myPressure.pressure +
                      "/" +
                      myPressure.threshold
                }
              </div>`
            : ""
        }
        <div
          class="mt-1 rounded border border-amber-300/35 bg-amber-950/18 p-1.5"
        >
          <div
            class="text-[12px] lg:text-[13px] font-semibold text-amber-100 tabular-nums"
          >
            ${primaryTitle}
          </div>
          <div
            class="text-amber-200/90 tabular-nums text-[10px] lg:text-[11px]"
          >
            ${primarySubtitle}
          </div>
          <div class="mt-0.5 text-cyan-100/90 text-[10px] lg:text-[11px]">
            Recommended: ${recommendedAction}
          </div>
        </div>
        ${
          convoyDisplay.source === "ally"
            ? html`<div class="text-amber-100/70 tabular-nums text-[10px]">
                Tracking allied convoy. Shield/reroute commands apply only to
                your convoy.
              </div>`
            : ""
        }
        <div
          class="mt-1 rounded border px-1.5 py-1 text-[10px] ${
            commandCallout.tone === "amber"
              ? "border-amber-300/40 bg-amber-900/18 text-amber-100"
              : commandCallout.tone === "fuchsia"
                ? "border-fuchsia-300/40 bg-fuchsia-900/18 text-fuchsia-100"
                : commandCallout.tone === "cyan"
                  ? "border-cyan-300/35 bg-cyan-950/18 text-cyan-100"
                  : "border-emerald-300/35 bg-emerald-950/18 text-emerald-100"
          }"
        >
          <div
            class="font-semibold uppercase tracking-wide text-[9px] lg:text-[10px]"
          >
            ${commandCallout.title}
          </div>
          <div class="mt-0.5 text-[10px] lg:text-[11px]">
            ${commandCallout.detail}
          </div>
        </div>
        <div class="mt-1 text-blue-100/85 tabular-nums text-[10px]">
          ${beaconText} | ${this.livePulseSummary(jamLockoutSecs)} | Cost
          ${jamCostText}
        </div>
        <div class="text-slate-200/75 tabular-nums text-[10px]">
          Vault lockouts ${lockedSites}/${status.sites.length} | next open
          ${nextOpenSecs}s | passive hold ${passiveGoldText}/60s
        </div>
        <div class=${primaryRowClass}>
          <button
            class="relative rounded ${oneTapButtonClass} ${
              escortDisabled
                ? "bg-amber-900/35 text-amber-200/65 cursor-not-allowed"
                : "bg-amber-500/30 text-amber-100 hover:bg-amber-500/40"
            }"
            aria-label="Shield nearest convoy"
            aria-keyshortcuts="1"
            title=${
              escortDisabled
                ? `Escort lockout active for ${escortLockoutSecs}s.`
                : "One tap: shield your nearest active Vault Convoy."
            }
            style=${escortDisabled ? escortRingStyle : ""}
            ?disabled=${escortDisabled}
            @click=${() => this.sendEscortCommand()}
          >
            ${this.renderCoachmark(
              "shield",
              "Use before contested convoy lanes.",
            )}
            ${escortLabel}
          </button>
          <button
            class="relative rounded ${oneTapButtonClass} ${
              rerouteDisabled
                ? "bg-cyan-900/30 text-cyan-200/60 cursor-not-allowed"
                : "bg-cyan-500/30 text-cyan-100 hover:bg-cyan-500/40"
            }"
            aria-label="Reroute convoy to safest lane"
            aria-keyshortcuts="2"
            title=${
              rerouteDisabled
                ? "No active convoy to reroute."
                : "One tap: reroute active convoy to lowest-risk destination."
            }
            ?disabled=${rerouteDisabled}
            @click=${() => this.sendRerouteSafestCommand()}
          >
            ${this.renderCoachmark(
              "reroute",
              "Switch lane when pressure flips.",
            )}
            ${rerouteLabel}
          </button>
          <button
            class="relative rounded ${oneTapButtonClass} ${
              jamBreakerDisabled
                ? "bg-fuchsia-900/30 text-fuchsia-200/60 cursor-not-allowed"
                : "bg-fuchsia-500/30 text-fuchsia-100 hover:bg-fuchsia-500/40"
            }"
            aria-label="Trigger Jam Breaker"
            aria-keyshortcuts="3"
            title=${
              jamBreakerDisabled
                ? `Jam Breaker lockout active for ${jamLockoutSecs}s.`
                : `Counter enemy masking and reopen tactical information. Cost: ${jamCostText}.`
            }
            style=${jamBreakerDisabled ? jamRingStyle : ""}
            ?disabled=${jamBreakerDisabled}
            @click=${() => this.sendJamBreakerCommand()}
          >
            ${this.renderCoachmark(
              "jamBreaker",
              "Fire right before pulse windows.",
            )}
            ${compact ? "Jam" : jamLabel}
          </button>
        </div>
        <div class="mt-1">
          <button
            class="w-full rounded bg-slate-500/20 px-1.5 py-1 text-slate-100 hover:bg-slate-500/35"
            title=${
              showAdvanced
                ? "Hide secondary Vault controls"
                : "Show presets, pings, and advanced Vault controls"
            }
            aria-label="Toggle secondary Vault controls"
            aria-keyshortcuts="5"
            @click=${() => this.expandAdvancedCommands()}
          >
            ${showAdvanced ? "Hide More" : "More Commands"}
          </button>
        </div>
        ${
          showAdvanced
            ? html`
                <div
                  class="mt-1.5 rounded border border-cyan-300/25 bg-slate-950/35 p-1.5"
                >
                  <div class="flex flex-wrap gap-1">
                    ${(["aggro", "economy", "control"] as const).map(
                      (preset) => html`
                        <button
                          class="rounded border px-1.5 py-0.5 text-[10px] ${
                            this.quickRolePreset === preset
                              ? "border-cyan-200/65 bg-cyan-500/25 text-cyan-50"
                              : "border-slate-300/35 bg-slate-700/25 text-slate-100 hover:bg-slate-700/40"
                          }"
                          @click=${() => this.setQuickRolePreset(preset)}
                        >
                          ${
                            preset === "aggro"
                              ? "Aggro"
                              : preset === "economy"
                                ? "Economy"
                                : "Control"
                          }
                        </button>
                      `,
                    )}
                  </div>
                  ${
                    trimUnderused
                      ? html`<div class="mt-1 text-[10px] text-slate-200/80">
                          Core loop first. Advanced pings and lane rotation live
                          here once Shield, Reroute, and Jam feel automatic.
                        </div>`
                      : ""
                  }
                  <div class="mt-1 grid grid-cols-2 gap-1">
                    <button
                      class="${
                        compact ? "px-2 py-1.5" : "px-1.5 py-1"
                      } rounded bg-fuchsia-500/20 text-fuchsia-100 hover:bg-fuchsia-500/30 ${
                        jamNextDisabled && !this.jamOnNextPulseArmed
                          ? "opacity-60 cursor-not-allowed"
                          : ""
                      }"
                      title=${
                        jamNextDisabled
                          ? `Jam Breaker lockout active for ${jamLockoutSecs}s.`
                          : `Arms Jam Breaker and auto-fires when an enemy pulse activates. Cost: ${jamCostText}.`
                      }
                      style=${jamNextDisabled ? jamNextRingStyle : ""}
                      ?disabled=${jamNextDisabled}
                      @click=${() => this.toggleJamOnNextPulse()}
                    >
                      ${jamNextLabel}
                    </button>
                    <button
                      class="${
                        compact ? "px-2 py-1.5" : "px-1.5 py-1"
                      } rounded bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/35"
                      title="Advanced manual reroute: rotate target structure lane."
                      @click=${() => this.sendRerouteCommand()}
                    >
                      Reroute Lane: ${this.convoyRoutePreference}
                    </button>
                    <button
                      class="${
                        compact ? "px-2 py-1.5" : "px-1.5 py-1"
                      } rounded bg-sky-500/25 text-sky-100 hover:bg-sky-500/35"
                      title="Ask team to shield your convoy lane."
                      @click=${() => this.sendRolePing("escort_convoy")}
                    >
                      Ping Shield
                    </button>
                    <button
                      class="${
                        compact ? "px-2 py-1.5" : "px-1.5 py-1"
                      } rounded bg-sky-500/25 text-sky-100 hover:bg-sky-500/35"
                      title="Ask team to cut enemy convoy routes."
                      @click=${() => this.sendRolePing("intercept_lane")}
                    >
                      Ping Intercept
                    </button>
                    <button
                      class="col-span-2 ${
                        compact ? "px-2 py-1.5" : "px-1.5 py-1"
                      } rounded bg-sky-500/25 text-sky-100 hover:bg-sky-500/35"
                      title="Notify team about upcoming Defense Factory pulse timing."
                      @click=${() => this.sendRolePing("pulse_soon")}
                    >
                      Ping Pulse
                    </button>
                    <button
                      class="col-span-2 ${
                        compact ? "px-2 py-1.5" : "px-1.5 py-1"
                      } rounded bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                      title="Broadcast your active intel to all opponents — earn gold per recipient. Requires active Intel purchase."
                      @click=${() => this.sendSellIntelCommand()}
                    >
                      Sell Intel (earn gold)
                    </button>
                    <button
                      class="col-span-2 ${
                        compact ? "px-2 py-1.5" : "px-1.5 py-1"
                      } rounded bg-red-500/20 text-red-100 hover:bg-red-500/30"
                      title="Last-resort: costs 20k gold. Your next convoy will extract 50% of any vault site's gold on delivery (capped 200k). Only available when you hold ≤2 territories."
                      @click=${() => this.sendVaultHeistCommand()}
                    >
                      💀 Vault Heist (20k gold)
                    </button>
                  </div>
                  ${ownConvoy ? this.renderReroutePreviewPanel(ownConvoy) : ""}
                  ${this.renderRewardExplainPanel(convoy)}
                  ${
                    adaptiveNudge
                      ? html`<div
                          class="mt-1 rounded border border-emerald-300/35 bg-emerald-900/20 px-1.5 py-1 text-[10px] text-emerald-100"
                        >
                          ${adaptiveNudge}
                        </div>`
                      : ""
                  }
                  ${
                    commandHint
                      ? html`<div
                          class="mt-1.5 text-[10px] lg:text-[11px] text-cyan-100/90"
                        >
                          Tip: ${commandHint}
                        </div>`
                      : ""
                  }
                </div>
              `
            : ""
        }
      </div>
    `;
  }

  private sendEscortCommand() {
    const beacon = this.myBeacon();
    if (beacon && this.game.ticks() < beacon.escortUntilTick) return;
    this.eventBus.emit(new SendVaultConvoyCommandIntentEvent("escort"));
    this.markCoachmarkComplete("shield");
    logHudTelemetry("hud_command_shield");
    void recordVaultFrontRuntimeEvent({
      event: "command_shield",
      rewardVariant: this.runtimeRewardVariant,
      hudVariant: this.runtimeHudVariant,
      value: 1,
    });
  }

  private sendSellIntelCommand() {
    this.eventBus.emit(new SendVaultConvoyCommandIntentEvent("sell_intel"));
    logHudTelemetry("hud_command_sell_intel");
  }

  private sendVaultHeistCommand() {
    this.eventBus.emit(new SendVaultConvoyCommandIntentEvent("vault_heist"));
    logHudTelemetry("hud_command_vault_heist");
  }

  private sendRerouteSafestCommand() {
    const presetCommand =
      this.quickRolePreset === "aggro"
        ? "reroute_factory"
        : this.quickRolePreset === "control"
          ? "reroute_port"
          : "reroute_safest";
    this.sendRerouteSpecificCommand(presetCommand);
    logHudTelemetry("hud_command_reroute_safest");
  }

  private sendRerouteCommand() {
    const next =
      this.convoyRoutePreference === "city"
        ? "port"
        : this.convoyRoutePreference === "port"
          ? "factory"
          : this.convoyRoutePreference === "factory"
            ? "silo"
            : "city";
    this.convoyRoutePreference = next;
    const command =
      next === "city"
        ? "reroute_city"
        : next === "port"
          ? "reroute_port"
          : next === "factory"
            ? "reroute_factory"
            : "reroute_silo";
    this.eventBus.emit(new SendVaultConvoyCommandIntentEvent(command));
    this.markCoachmarkComplete("reroute");
    logHudTelemetry("hud_command_reroute", { lane: next });
    void recordVaultFrontRuntimeEvent({
      event: `command_reroute_${next}`,
      rewardVariant: this.runtimeRewardVariant,
      hudVariant: this.runtimeHudVariant,
      value: 1,
    });
  }

  private sendJamBreakerCommand(trigger: "manual" | "auto" = "manual") {
    const ticks = this.game.ticks();
    if (ticks < this.jamBreakerCooldownUntilTick) return;
    this.jamBreakerCooldownUntilTick = ticks + 900;
    this.jamOnNextPulseArmed = false;
    this.eventBus.emit(new SendDefenseFactoryCommandIntentEvent("jam_breaker"));
    this.markCoachmarkComplete("jamBreaker");
    logHudTelemetry(
      trigger === "auto"
        ? "hud_command_jam_next_autofired"
        : "hud_command_jam_breaker",
    );
    void recordVaultFrontRuntimeEvent({
      event: trigger === "auto" ? "command_jam_auto" : "command_jam_manual",
      rewardVariant: this.runtimeRewardVariant,
      hudVariant: this.runtimeHudVariant,
      value: 1,
    });
  }

  private toggleJamOnNextPulse(): void {
    const ticks = this.game.ticks();
    if (ticks < this.jamBreakerCooldownUntilTick && !this.jamOnNextPulseArmed) {
      return;
    }
    this.jamOnNextPulseArmed = !this.jamOnNextPulseArmed;
    logHudTelemetry("hud_command_jam_next_toggle", {
      armed: this.jamOnNextPulseArmed,
    });
    void recordVaultFrontRuntimeEvent({
      event: this.jamOnNextPulseArmed
        ? "command_jam_next_arm"
        : "command_jam_next_disarm",
      rewardVariant: this.runtimeRewardVariant,
      hudVariant: this.runtimeHudVariant,
      value: 1,
    });
  }

  private maybeTriggerAutoJamOnPulse(): void {
    const ticks = this.game.ticks();
    if (
      !this.jamOnNextPulseArmed &&
      this.quickRolePreset === "control" &&
      ticks >= this.jamBreakerCooldownUntilTick
    ) {
      this.jamOnNextPulseArmed = true;
    }
    if (!this.jamOnNextPulseArmed) return;
    if (ticks < this.jamBreakerCooldownUntilTick) return;
    const me = this.game.myPlayer();
    if (!me || !this.latestVaultStatus) return;
    const enemyPulseActive = this.latestVaultStatus.beacons.some((beacon) => {
      if (beacon.maskedUntilTick <= ticks) return false;
      const player = this.game.playerBySmallID(beacon.playerID);
      if (!player || !player.isPlayer()) return false;
      return player.smallID() !== me.smallID() && !me.isFriendly(player);
    });
    if (!enemyPulseActive) return;
    this.sendJamBreakerCommand("auto");
  }

  private expandAdvancedCommands(): void {
    this.advancedCommandsExpanded = !this.advancedCommandsExpanded;
    logHudTelemetry("hud_advanced_commands_expand", {
      expanded: this.advancedCommandsExpanded,
    });
  }

  private setQuickRolePreset(preset: "aggro" | "economy" | "control"): void {
    if (this.quickRolePreset === preset) return;
    this.quickRolePreset = preset;
    localStorage.setItem("vaultfront.quickRolePreset", preset);
    if (
      preset === "control" &&
      this.game.ticks() >= this.jamBreakerCooldownUntilTick
    ) {
      this.jamOnNextPulseArmed = true;
    }
    logHudTelemetry("hud_quick_role_preset", { preset });
  }

  private sendRolePing(
    ping: "escort_convoy" | "intercept_lane" | "pulse_soon",
  ) {
    this.eventBus.emit(new SendVaultRolePingIntentEvent(ping));
    logHudTelemetry("hud_role_ping", { ping });
  }

  private shouldTrimUnderusedCommands(): boolean {
    const matches = Number(
      localStorage.getItem("vaultfront.kpi.matches") ?? "0",
    );
    if (matches < 3) return false;
    if (this.coachmarksEnabled) return false;
    const shieldUses = Number(
      localStorage.getItem("vaultfront.kpi.hud.hud_command_shield") ?? "0",
    );
    const rerouteUses = Number(
      localStorage.getItem("vaultfront.kpi.hud.hud_command_reroute_safest") ??
        localStorage.getItem("vaultfront.kpi.hud.hud_command_reroute") ??
        "0",
    );
    const jamUses = Number(
      localStorage.getItem("vaultfront.kpi.hud.hud_command_jam_breaker") ?? "0",
    );
    const pingUses = Number(
      localStorage.getItem("vaultfront.kpi.hud.hud_role_ping") ?? "0",
    );
    const combined = shieldUses + rerouteUses + jamUses + pingUses;
    return combined < 8;
  }

  private renderNextGoalTracker() {
    if (!this.nextMatchGoal && !this.nextMatchGoalKey) return "";
    return html`
      <div
        class="mt-1.5 border border-amber-300/45 rounded-md bg-amber-900/25 p-1.5 text-[10px] lg:text-[11px]"
      >
        <div class="font-semibold text-amber-200">Convoy Mastery</div>
        <div
          class="${
            this.nextMatchGoalCompleted ? "text-emerald-200" : "text-amber-50"
          } mt-1"
        >
          ${this.nextMatchGoalCompleted ? "[x] " : ""}${this.nextMatchGoal}
        </div>
      </div>
    `;
  }

  private renderOnboarding() {
    if (!this.shouldShowOnboarding()) return "";
    const lockRequired =
      this.tutorialLockActive &&
      (!this.onboardingProgress.vaultCaptured ||
        !this.onboardingProgress.convoyAction);

    const steps = FIRST_EXTRACTION_STEPS.map((step) => ({
      done: this.onboardingProgress[step.key],
      label: step.label,
    }));
    const activeIndex = steps.findIndex((step) => !step.done);

    return html`
      <div
        class="mt-1.5 border border-emerald-400/50 rounded-md bg-emerald-950/35 p-1.5 text-[10px] lg:text-[11px]"
      >
        <div class="flex items-center justify-between">
          <div class="font-semibold text-emerald-200">
            ${FIRST_EXTRACTION_TITLE}
          </div>
          ${
            lockRequired
              ? html`<div class="text-[10px] text-emerald-200/90">
                  Locked until first vault + convoy interaction
                </div>`
              : html`<button
                  class="text-emerald-300/80 hover:text-emerald-200 text-[10px]"
                  @click=${() => this.dismissOnboarding()}
                >
                  Hide
                </button>`
          }
        </div>
        <div class="mt-1.5 space-y-1">
          ${steps.map(
            (step, index) => html`
              <div
                class="${
                  step.done
                    ? "text-emerald-300"
                    : index === activeIndex
                      ? "text-white"
                      : "text-slate-300"
                }"
              >
                ${step.done ? "[x]" : index === activeIndex ? ">" : "-"}
                ${step.label}
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private resourceFocusMultipliers(focus: number): {
    troopMultiplier: number;
    goldMultiplier: number;
  } {
    const clamped = Math.max(0, Math.min(100, focus));
    const goldMultiplier = 0.5 + clamped / 100;
    const troopMultiplier = 1.5 - clamped / 100;
    return { troopMultiplier, goldMultiplier };
  }

  private renderTroopBar() {
    const base = Math.max(this._maxTroops, 1);
    const greenPercentRaw = (this._troops / base) * 100;
    const orangePercentRaw = (this._attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return html`
      <div
        class="w-full h-6 lg:h-8 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative"
      >
        <div class="h-full flex">
          ${
            greenPercent > 0
              ? html`<div
                  class="h-full bg-green-500 ${
                    this.reducedMotion ? "" : "transition-[width] duration-200"
                  }"
                  style="width: ${greenPercent}%;"
                ></div>`
              : ""
          }
          ${
            orangePercent > 0
              ? html`<div
                  class="h-full bg-orange-400 ${
                    this.reducedMotion ? "" : "transition-[width] duration-200"
                  }"
                  style="width: ${orangePercent}%;"
                ></div>`
              : ""
          }
        </div>
        <div
          class="absolute inset-0 flex items-center justify-between px-1.5 lg:px-2 text-xs lg:text-sm font-bold leading-none pointer-events-none"
          translate="no"
        >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(this._troops)}</span
          >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(this._maxTroops)}</span
          >
        </div>
        <div
          class="absolute inset-0 flex items-center justify-center gap-0.5 pointer-events-none"
          translate="no"
        >
          <img
            src=${soldierIcon}
            alt=""
            aria-hidden="true"
            width="12"
            height="12"
            class="lg:w-4 lg:h-4 brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
          />
          <span
            class="text-[10px] lg:text-xs font-bold drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ${
              this._troopRateIsIncreasing ? "text-green-400" : "text-orange-400"
            }"
            >+${renderTroops(this.troopRate)}/s</span
          >
        </div>
      </div>
    `;
  }

  private toggleHudEditMode(): void {
    this.hudEditMode = !this.hudEditMode;
    if (this.hudEditMode) this.hudEditExpanded = true;
    this.persistHudLayout(
      { editMode: this.hudEditMode },
      "hud_edit_mode_toggle",
    );
  }

  private toggleHudEditExpanded(): void {
    this.hudEditExpanded = !this.hudEditExpanded;
  }

  private applyHudPreset(preset: HudPreset): void {
    const patch =
      preset === "compact"
        ? {
            preset,
            uiScale: 0.9,
            controlPanelCompact: true,
            leftDockExpanded: false,
          }
        : preset === "mobile"
          ? {
              preset,
              uiScale: 0.85,
              controlPanelCompact: true,
              leftDockExpanded: false,
            }
          : {
              preset,
              uiScale: 1,
              controlPanelCompact: false,
              leftDockExpanded: true,
            };
    this.persistHudLayout(patch, "hud_preset_apply");
    logHudTelemetry("hud_preset_apply", { preset });
  }

  private onHudScaleInput(e: Event): void {
    const nextScale = Number((e.target as HTMLInputElement).value);
    this.hudScale = applyGlobalHudScale(nextScale);
    this.persistHudLayout({ uiScale: this.hudScale }, "hud_scale_change");
  }

  private resetHudLayout(): void {
    this.panelOffsetX = 0;
    this.panelOffsetY = 0;
    this.hudCompactMode = false;
    this.hudScale = applyGlobalHudScale(1);
    this.persistHudLayout(
      {
        controlPanelOffsetX: 0,
        controlPanelOffsetY: 0,
        leftDockOffsetX: 0,
        leftDockOffsetY: 0,
        rightDockOffsetX: 0,
        rightDockOffsetY: 0,
        controlPanelCompact: false,
        uiScale: 1,
      },
      "hud_layout_reset",
    );
  }

  private onPanelDragStart = (event: PointerEvent): void => {
    if (!this.hudEditMode) return;
    event.preventDefault();
    this.draggingPanel = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragBaseX = this.panelOffsetX;
    this.dragBaseY = this.panelOffsetY;
    window.addEventListener("pointermove", this.onPanelDragMove);
    window.addEventListener("pointerup", this.onPanelDragEnd);
  };

  private onPanelDragMove = (event: PointerEvent): void => {
    if (!this.draggingPanel) return;
    this.panelOffsetX = this.dragBaseX + (event.clientX - this.dragStartX);
    this.panelOffsetY = this.dragBaseY + (event.clientY - this.dragStartY);
  };

  private onPanelDragEnd = (): void => {
    if (!this.draggingPanel) return;
    this.draggingPanel = false;
    this.persistHudLayout(
      {
        controlPanelOffsetX: Math.round(this.panelOffsetX),
        controlPanelOffsetY: Math.round(this.panelOffsetY),
      },
      "hud_panel_drag",
    );
    window.removeEventListener("pointermove", this.onPanelDragMove);
    window.removeEventListener("pointerup", this.onPanelDragEnd);
  };

  private renderHudEditControls() {
    const expanded = this.hudEditExpanded || this.hudEditMode;
    return html`
      <div
        class="mt-1.5 rounded border border-cyan-300/30 bg-slate-950/35 p-1.5 text-[10px] lg:text-[11px]"
      >
        <div class="flex items-center justify-between">
          <div class="text-cyan-200 font-semibold">HUD Edit</div>
          <div class="flex items-center gap-1">
            <button
              class="rounded border border-slate-300/35 px-1 py-0.5 text-slate-100 hover:bg-slate-500/20"
              @click=${() => this.toggleHudEditExpanded()}
            >
              ${expanded ? "Collapse" : "Open"}
            </button>
            <button
              class="rounded border border-cyan-300/35 px-1 py-0.5 text-cyan-100 hover:bg-cyan-500/20"
              @click=${() => this.toggleHudEditMode()}
            >
              ${this.hudEditMode ? "Done" : "Edit"}
            </button>
          </div>
        </div>
        ${
          expanded
            ? html`
                <div class="mt-1.5 space-y-1.5">
                  <div class="flex flex-wrap gap-1">
                    ${(["compact", "competitive", "mobile"] as HudPreset[]).map(
                      (preset) => html`
                        <button
                          class="rounded border px-1.5 py-0.5 ${
                            this.hudPreset === preset
                              ? "border-amber-300/60 bg-amber-400/20 text-amber-100"
                              : "border-slate-400/40 text-slate-100 hover:bg-slate-600/30"
                          }"
                          @click=${() => this.applyHudPreset(preset)}
                        >
                          ${preset}
                        </button>
                      `,
                    )}
                  </div>
                  <div>
                    <div class="flex justify-between text-cyan-100/85">
                      <span>UI Scale</span>
                      <span>${this.hudScale.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.8"
                      max="1.2"
                      step="0.05"
                      .value=${String(this.hudScale)}
                      @input=${(e: Event) => this.onHudScaleInput(e)}
                      class="w-full accent-cyan-400"
                    />
                  </div>
                  <div class="flex gap-1">
                    <button
                      class="rounded border border-cyan-300/35 px-1.5 py-0.5 text-cyan-100 hover:bg-cyan-500/20"
                      @click=${() => this.toggleVaultDebug()}
                      title="Toggle persistent VaultFront debug logs and in-HUD QA checklist"
                    >
                      ${
                        this.vaultDebugActive
                          ? "Vault Debug On"
                          : "Vault Debug Off"
                      }
                    </button>
                    <button
                      class="rounded border border-cyan-300/35 px-1.5 py-0.5 text-cyan-100 hover:bg-cyan-500/20"
                      @pointerdown=${this.onPanelDragStart}
                    >
                      Drag Panel
                    </button>
                    <button
                      class="rounded border border-slate-300/35 px-1.5 py-0.5 text-slate-100 hover:bg-slate-500/25"
                      @click=${() => this.resetHudLayout()}
                    >
                      Reset Layout
                    </button>
                  </div>
                </div>
              `
            : html`<div class="mt-1 text-slate-200/70">
                Layout controls hidden during play. Open when you need to adjust
                placement.
              </div>`
        }
      </div>
    `;
  }

  private floatingVaultHudTopPx(): number {
    if (this.viewportWidth() < 980) return 168;
    if (this.viewportWidth() < 1200) return 146;
    return 142;
  }

  private floatingVaultHudWidthPx(): number {
    return ControlPanel.FLOATING_VAULT_HUD_WIDTH_PX;
  }

  private floatingVaultHudRightPx(): number {
    return 8;
  }

  private shouldCollapseVaultHud(): boolean {
    return (
      this.heavyCombatActive &&
      !this.vaultHudHoverExpanded &&
      !this.vaultHudPinnedExpanded
    );
  }

  private toggleVaultHudPin(): void {
    this.vaultHudPinnedExpanded = !this.vaultHudPinnedExpanded;
    logHudTelemetry("hud_vault_panel_pin_toggle", {
      pinned: this.vaultHudPinnedExpanded,
    });
  }

  private renderFloatingVaultHud() {
    if (!this._isVisible) return "";
    if (this.latestVaultStatus === null) {
      return html`
        <div
          class="fixed right-2 z-[1180] w-[min(92vw,344px)] pointer-events-auto"
          style="top: ${this.floatingVaultHudTopPx()}px; zoom: ${
            this.hudScale
          };"
        >
          ${this.renderVaultDebugWaitingCard()} ${this.renderVaultDebugPanel()}
        </div>
      `;
    }
    const collapsed = this.shouldCollapseVaultHud();
    return html`
      <div
        class="fixed right-2 z-[1180] w-[min(92vw,344px)] pointer-events-auto"
        style="top: ${this.floatingVaultHudTopPx()}px; zoom: ${this.hudScale};"
        @mouseenter=${() => (this.vaultHudHoverExpanded = true)}
        @mouseleave=${() => (this.vaultHudHoverExpanded = false)}
      >
        ${
          collapsed
            ? html`<button
                class="vf-hud-surface rounded-lg px-2 py-1 text-[11px] text-cyan-100 hover:bg-slate-800/90"
                title="Heavy combat detected. Tap to expand Vault HUD."
                @click=${() => (this.vaultHudPinnedExpanded = true)}
              >
                Vault HUD (collapsed)
              </button>`
            : html`<div class="relative">
                <button
                  class="absolute right-1 top-1 z-[1] rounded border border-cyan-300/45 bg-slate-900/75 px-1 py-0.5 text-[10px] text-cyan-100 hover:bg-slate-800/90"
                  @click=${() => this.toggleVaultHudPin()}
                  title="Pin/unpin Vault HUD during combat"
                >
                  ${this.vaultHudPinnedExpanded ? "Unpin" : "Pin"}
                </button>
                ${this.renderVaultHud()} ${this.renderVaultDebugPanel()}
              </div>`
        }
      </div>
    `;
  }

  render() {
    return html`
      ${this.renderFloatingVaultHud()}
      <div
        class="relative pointer-events-auto ${
          this._isVisible
            ? "vf-hud-dock relative z-[60] w-full lg:max-w-[312px] text-xs lg:text-sm p-1.5 pr-1.5 lg:p-2.5 sm:rounded-tr-lg min-[1200px]:rounded-lg"
            : "hidden"
        }"
        style="transform: translate(${this.panelOffsetX}px, ${
          this.panelOffsetY
        }px) scale(${this.hudScale}); transform-origin: bottom left;"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="flex gap-2 lg:gap-3 items-center">
          <!-- Gold: 1/4 -->
          <div
            class="vf-hud-meter flex items-center justify-center p-1 lg:p-1.5 lg:gap-1 font-bold text-yellow-300 text-xs lg:text-sm w-1/5 lg:w-auto shrink-0"
            translate="no"
          >
            <img
              src=${goldCoinIcon}
              width="13"
              height="13"
              class="lg:w-4 lg:h-4"
            />
            <span class="px-0.5">${renderNumber(this._gold)}</span>
          </div>
          <!-- Troop bar: 2/4 -->
          <div class="w-3/5 lg:flex-1">${this.renderTroopBar()}</div>
          <!-- Attack ratio: 1/4 -->
          <div
            class="relative w-1/5 shrink-0 flex items-center justify-center gap-1 cursor-pointer lg:hidden"
            @touchstart=${(e: TouchEvent) => this.handleAttackTouchStart(e)}
          >
            <div class="flex flex-col items-center w-10 shrink-0">
              <div
                class="flex items-center gap-0.5 text-white text-xs font-bold tabular-nums"
                translate="no"
              >
                <img
                  src=${swordIcon}
                  alt=""
                  aria-hidden="true"
                  width="10"
                  height="10"
                  class="brightness-0 invert sepia saturate-[10000%] hue-rotate-[0deg]"
                  style="filter: brightness(0) saturate(100%) invert(36%) sepia(95%) saturate(5500%) hue-rotate(350deg) brightness(95%) contrast(95%);"
                />
                ${(this.attackRatio * 100).toFixed(0)}%
              </div>
              <div class="text-[10px] text-red-400 tabular-nums" translate="no">
                (${renderTroops(
                  (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
                )})
              </div>
            </div>
            <!-- Small red vertical bar indicator -->
            <div class="shrink-0">
              <div
                class="w-1.5 h-8 bg-white/20 rounded-full relative overflow-hidden"
              >
                <div
                  class="absolute bottom-0 w-full bg-red-500 rounded-full transition-all duration-200"
                  style="height: ${this.attackRatio * 100}%"
                ></div>
              </div>
            </div>
          </div>
        </div>
        ${
          this._touchDragging
            ? html`
                <div
                  class="absolute bottom-full right-0 flex flex-col items-center pointer-events-auto z-[10000] bg-gray-800/70 backdrop-blur-xs rounded-tl-lg sm:rounded-lg p-2 w-12"
                  style="height: 50vh;"
                  @touchstart=${(e: TouchEvent) => this.handleBarTouch(e)}
                >
                  <span
                    class="text-red-400 text-sm font-bold mb-1"
                    translate="no"
                    >${(this.attackRatio * 100).toFixed(0)}%</span
                  >
                  <div
                    class="attack-drag-bar flex-1 w-3 bg-white/20 rounded-full relative overflow-hidden"
                  >
                    <div
                      class="absolute bottom-0 w-full bg-red-500 rounded-full"
                      style="height: ${this.attackRatio * 100}%"
                    ></div>
                  </div>
                </div>
              `
            : ""
        }
        <!-- Attack ratio bar (desktop, always visible) -->
        <div class="hidden lg:block mt-2">
          <div
            class="flex items-center justify-between text-sm font-bold mb-1"
            translate="no"
          >
            <span class="text-white flex items-center gap-1"
              ><img
                src=${swordIcon}
                alt=""
                aria-hidden="true"
                width="14"
                height="14"
                style="filter: brightness(0) saturate(100%) invert(36%) sepia(95%) saturate(5500%) hue-rotate(350deg) brightness(95%) contrast(95%);"
              />Attack Ratio</span
            >
            <span class="text-white tabular-nums"
              >${(this.attackRatio * 100).toFixed(0)}%
              (${renderTroops(
                (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
              )})</span
            >
          </div>
          <input
            id="attack-ratio"
            type="range"
            min="1"
            max="100"
            .value=${String(Math.round(this.attackRatio * 100))}
            @input=${(e: Event) => this.handleRatioSliderInput(e)}
            class="w-full h-2 accent-red-500 cursor-pointer"
          />
        </div>
        <div class="mt-2">
          <div
            class="flex items-center justify-between text-sm font-bold mb-1"
            translate="no"
          >
            <span class="text-white">Gold Production Emphasis</span>
            <span class="text-white tabular-nums"
              >${this.resourceFocus}% Gold / ${100 - this.resourceFocus}%
              Troops</span
            >
          </div>
          <div
            class="flex items-center justify-between text-[11px] lg:text-xs text-gray-300 mb-1 tabular-nums"
            translate="no"
          >
            <span>+${renderNumber(this.goldRate)}/s gold</span>
            <span>+${renderTroops(this.troopRate)}/s troops</span>
          </div>
          <input
            id="resource-focus"
            type="range"
            min="0"
            max="100"
            .value=${String(this.resourceFocus)}
            @input=${(e: Event) => this.handleResourceFocusSliderInput(e)}
            class="w-full h-2 accent-yellow-400 cursor-pointer"
          />
        </div>
        ${this.renderOnboarding()} ${this.renderHudEditControls()}
        ${this.hudCompactMode ? "" : this.renderNextGoalTracker()}
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
