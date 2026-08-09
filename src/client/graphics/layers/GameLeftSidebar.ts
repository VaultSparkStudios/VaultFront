import { Colord } from "colord";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameMode, Team } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import {
  fetchVaultFrontDockAssignment,
  recordVaultFrontDockEvent,
} from "../../Api";
import { Platform } from "../../Platform";
import { getTranslatedPlayerTeamLabel, translateText } from "../../Utils";
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
import { SpawnBarVisibleEvent } from "./SpawnTimer";
import { viewportWidth } from "./ViewportMode";
import leaderboardRegularIcon from "/images/LeaderboardIconRegularWhite.svg?url";
import leaderboardSolidIcon from "/images/LeaderboardIconSolidWhite.svg?url";
import teamRegularIcon from "/images/TeamIconRegularWhite.svg?url";
import teamSolidIcon from "/images/TeamIconSolidWhite.svg?url";

@customElement("game-left-sidebar")
export class GameLeftSidebar extends LitElement implements Layer {
  @state()
  private isLeaderboardShow = false;
  @state()
  private isTeamLeaderboardShow = false;
  @state()
  private isVisible = false;
  @state()
  private isPlayerTeamLabelVisible = false;
  @state()
  private playerTeam: Team | null = null;
  @state()
  private spawnBarVisible = false;
  @state()
  private immunityBarVisible = false;
  @state()
  private isDockExpanded = false;
  @state()
  private hudEditMode = false;
  @state()
  private hudScale = 1;
  @state()
  private dockOffsetX = 0;
  @state()
  private dockOffsetY = 0;
  @state()
  private dockVariant: "top" | "stack" = "top";

  private playerColor: Colord = new Colord("#FFFFFF");
  public game: GameView;
  public eventBus: EventBus;
  private _shownOnInit = false;
  private nextDockRuleTick = 0;
  private resizeHandler = () => this.applyDockRules(true);
  private lastServerDockEventAt = 0;
  private draggingDock = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragBaseX = 0;
  private dragBaseY = 0;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    this.loadDockLayout();
    applyGlobalHudScale(this.hudScale);
    window.addEventListener("resize", this.resizeHandler);
    window.addEventListener(
      HUD_LAYOUT_EVENT,
      this.onHudLayoutUpdated as EventListener,
    );
    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
    if (this.isTeamGame) {
      this.isPlayerTeamLabelVisible = true;
    }
    // Keep collapsed by default.
    if (Platform.isDesktopWidth) {
      this._shownOnInit = true;
    }
    void this.resolveServerBackedDockVariant().finally(() => {
      logHudTelemetry("hud_ab_dock_exposure", { variant: this.dockVariant });
      logHudTelemetry(`hud_ab_dock_exposure_${this.dockVariant}`);
      this.sendDockEventToServer(`exposure_${this.dockVariant}`);
    });
    this.applyDockRules(true);
    this.requestUpdate();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.resizeHandler);
    window.removeEventListener(
      HUD_LAYOUT_EVENT,
      this.onHudLayoutUpdated as EventListener,
    );
    window.removeEventListener("pointermove", this.onDockDragMove);
    window.removeEventListener("pointerup", this.onDockDragEnd);
  }

  tick() {
    if (!this.playerTeam && this.game.myPlayer()?.team()) {
      this.playerTeam = this.game.myPlayer()!.team();
      if (this.playerTeam) {
        this.playerColor = this.game
          .config()
          .theme()
          .teamColor(this.playerTeam);
        this.requestUpdate();
      }
    }

    if (this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = false;
      this.requestUpdate();
    }

    if (!this.game.inSpawnPhase() && this.isPlayerTeamLabelVisible) {
      this.isPlayerTeamLabelVisible = false;
      this.requestUpdate();
    }

    if ((this.game?.ticks() ?? 0) >= this.nextDockRuleTick) {
      this.nextDockRuleTick = (this.game?.ticks() ?? 0) + 10;
      this.applyDockRules();
    }
  }

  private get barOffset(): number {
    return (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
  }

  private setDockExpanded(expanded: boolean, autoCollapse: boolean): void {
    if (expanded === this.isDockExpanded) return;
    this.isDockExpanded = expanded;
    if (!expanded && autoCollapse) {
      this.isLeaderboardShow = false;
      this.isTeamLeaderboardShow = false;
    }
    this.persistDockLayout({ leftDockExpanded: this.isDockExpanded });
  }

  private toggleDock = (): void => {
    this.setDockExpanded(!this.isDockExpanded, false);
    logHudTelemetry("hud_left_dock_toggle", {
      expanded: this.isDockExpanded,
      variant: this.dockVariant,
    });
    logHudTelemetry(`hud_left_dock_toggle_${this.dockVariant}`);
    this.sendDockEventToServer(`dock_toggle_${this.dockVariant}`);
    this.applyDockRules();
  };

  private toggleLeaderboard = (): void => {
    if (!this.isDockExpanded) this.setDockExpanded(true, false);
    this.isLeaderboardShow = !this.isLeaderboardShow;
    logHudTelemetry("hud_left_leaderboard_toggle", {
      visible: this.isLeaderboardShow,
      variant: this.dockVariant,
    });
    if (this.isLeaderboardShow) {
      logHudTelemetry(`hud_left_leaderboard_open_${this.dockVariant}`);
      this.sendDockEventToServer(`leaderboard_open_${this.dockVariant}`);
    }
    this.applyDockRules();
  };

  private toggleTeamLeaderboard = (): void => {
    if (!this.isDockExpanded) this.setDockExpanded(true, false);
    this.isTeamLeaderboardShow = !this.isTeamLeaderboardShow;
    logHudTelemetry("hud_left_team_leaderboard_toggle", {
      visible: this.isTeamLeaderboardShow,
      variant: this.dockVariant,
    });
    if (this.isTeamLeaderboardShow) {
      logHudTelemetry(`hud_left_team_leaderboard_open_${this.dockVariant}`);
      this.sendDockEventToServer(`team_leaderboard_open_${this.dockVariant}`);
    }
    this.applyDockRules();
  };

  private onHudLayoutUpdated = (event: CustomEvent): void => {
    this.applyDockLayout(event.detail ?? {});
  };

  private applyDockLayout(layout: ReturnType<typeof readHudLayout>): void {
    this.isDockExpanded = layout.leftDockExpanded === true;
    this.hudEditMode = layout.editMode === true;
    this.hudScale = applyGlobalHudScale(layout.uiScale ?? this.hudScale);
    this.dockOffsetX = Number(layout.leftDockOffsetX ?? this.dockOffsetX ?? 0);
    this.dockOffsetY = Number(layout.leftDockOffsetY ?? this.dockOffsetY ?? 0);
    this.dockVariant = layout.dockVariant ?? this.dockVariant;
  }

  private loadDockLayout(): void {
    this.applyDockLayout(readHudLayout());
  }

  private persistDockLayout(patch: Parameters<typeof writeHudLayout>[0]): void {
    const next = writeHudLayout(patch);
    this.applyDockLayout(next);
    dispatchHudLayoutUpdate(next);
  }

  private anyBlockingPanelOpen(): boolean {
    const selectors = [
      "player-panel",
      "settings-modal",
      "win-modal",
      "chat-modal",
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (!element) continue;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return true;
      }
    }
    return false;
  }

  private applyDockRules(forceUpdate = false): void {
    const shouldCollapse =
      viewportWidth() < 1200 || this.anyBlockingPanelOpen();
    if (shouldCollapse && this.isDockExpanded) {
      this.setDockExpanded(false, true);
      if (forceUpdate) this.requestUpdate();
    }
  }

  private setDockVariant(variant: "top" | "stack"): void {
    this.dockVariant = variant;
    this.persistDockLayout({ dockVariant: variant });
    logHudTelemetry("hud_ab_dock_variant_set", { variant });
    logHudTelemetry(`hud_ab_dock_variant_set_${variant}`);
    this.sendDockEventToServer(`variant_set_${variant}`);
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
    this.persistDockLayout({
      leftDockOffsetX: Math.round(this.dockOffsetX),
      leftDockOffsetY: Math.round(this.dockOffsetY),
    });
    logHudTelemetry("hud_left_dock_drag", { variant: this.dockVariant });
    this.sendDockEventToServer(`dock_drag_${this.dockVariant}`);
    window.removeEventListener("pointermove", this.onDockDragMove);
    window.removeEventListener("pointerup", this.onDockDragEnd);
  };

  private async resolveServerBackedDockVariant(): Promise<void> {
    const assignment = await fetchVaultFrontDockAssignment();
    if (assignment !== false) {
      this.dockVariant = assignment.variant;
      this.persistDockLayout({ dockVariant: this.dockVariant });
      return;
    }
    if (!readHudLayout().dockVariant) {
      const assigned: "top" | "stack" = Math.random() < 0.5 ? "top" : "stack";
      const next = writeHudLayout({ dockVariant: assigned });
      dispatchHudLayoutUpdate(next);
      this.dockVariant = assigned;
    }
  }

  private sendDockEventToServer(event: string): void {
    const now = Date.now();
    if (now - this.lastServerDockEventAt < 250) return;
    this.lastServerDockEventAt = now;
    void recordVaultFrontDockEvent({
      event,
      variant: this.dockVariant,
      value: 1,
    });
  }

  private get isTeamGame(): boolean {
    return this.game?.config().gameConfig().gameMode === GameMode.Team;
  }

  render() {
    const expanded = this.isDockExpanded;
    const mobile = viewportWidth() < 1200;
    const topLayout = expanded
      ? `left-1/2 -translate-x-1/2 ${mobile ? "w-[98vw]" : "w-[min(98vw,1220px)]"} rounded-b-lg`
      : "left-0 min-[1200px]:left-4 w-12 rounded-br-lg min-[1200px]:rounded-lg";
    const stackLayout = expanded
      ? "left-0 min-[1200px]:left-4 w-[min(94vw,360px)] rounded-br-lg min-[1200px]:rounded-lg"
      : "left-0 min-[1200px]:left-4 w-12 rounded-br-lg min-[1200px]:rounded-lg";
    const asideLayout = this.dockVariant === "top" ? topLayout : stackLayout;
    const expandedFlow =
      expanded && this.dockVariant === "top"
        ? "flex-row items-start"
        : "flex-col items-stretch";
    return html`
      <aside
        class=${`fixed top-0 min-[1200px]:top-4 z-900 ${
          this.isVisible ? "" : "hidden"
        } ${asideLayout} vf-hud-dock flex ${expanded ? expandedFlow : "flex-col"} gap-2 max-h-[calc(100vh-80px)] overflow-y-auto p-2 ${
          this.isLeaderboardShow || this.isTeamLeaderboardShow
            ? "max-[400px]:w-full max-[400px]:rounded-none"
            : ""
        } transition-all duration-300 ease-out`}
        style="margin-top: ${
          this.barOffset + this.dockOffsetY
        }px; margin-left: ${this.dockOffsetX}px; zoom: ${this.hudScale};"
      >
        <div class="flex items-center gap-2 text-white shrink-0">
          <button
            class="cursor-pointer px-2 py-1.5 bg-slate-800/65 hover:bg-slate-700/75 border rounded-md border-cyan-300/35 text-xs text-cyan-100"
            @click=${this.toggleDock}
            title=${expanded ? "Collapse dock" : "Expand dock"}
          >
            ${expanded ? "<<" : ">>"}
          </button>
          <div
            class="cursor-pointer p-1.5 bg-slate-800/60 hover:bg-slate-700/75 border rounded-md border-cyan-300/30 transition-colors"
            @click=${this.toggleLeaderboard}
            role="button"
            tabindex="0"
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " " || e.code === "Space") {
                e.preventDefault();
                this.toggleLeaderboard();
              }
            }}
          >
            <img
              src=${
                this.isLeaderboardShow
                  ? leaderboardSolidIcon
                  : leaderboardRegularIcon
              }
              alt=${
                translateText("help_modal.icon_alt_player_leaderboard") ||
                "Player Leaderboard Icon"
              }
              width="18"
              height="18"
            />
          </div>
          ${
            this.isTeamGame
              ? html`
                  <div
                    class="cursor-pointer p-1.5 bg-slate-800/60 hover:bg-slate-700/75 border rounded-md border-cyan-300/30 transition-colors"
                    @click=${this.toggleTeamLeaderboard}
                    role="button"
                    tabindex="0"
                    @keydown=${(e: KeyboardEvent) => {
                      if (
                        e.key === "Enter" ||
                        e.key === " " ||
                        e.code === "Space"
                      ) {
                        e.preventDefault();
                        this.toggleTeamLeaderboard();
                      }
                    }}
                  >
                    <img
                      src=${
                        this.isTeamLeaderboardShow
                          ? teamSolidIcon
                          : teamRegularIcon
                      }
                      alt=${
                        translateText("help_modal.icon_alt_team_leaderboard") ||
                        "Team Leaderboard Icon"
                      }
                      width="18"
                      height="18"
                    />
                  </div>
                `
              : null
          }
          ${
            this.hudEditMode
              ? html`
                  <button
                    class="cursor-pointer px-2 py-1.5 bg-cyan-600/35 hover:bg-cyan-600/50 border rounded-md border-cyan-300/55 text-[11px]"
                    @pointerdown=${this.onDockDragStart}
                    title="Drag dock"
                  >
                    Drag
                  </button>
                  <button
                    class="cursor-pointer px-2 py-1.5 bg-slate-700/60 hover:bg-slate-600 border rounded-md border-slate-400 text-[11px]"
                    @click=${() =>
                      this.setDockVariant(
                        this.dockVariant === "top" ? "stack" : "top",
                      )}
                    title="Toggle A/B variant"
                  >
                    ${this.dockVariant === "top" ? "AB:Top" : "AB:Stack"}
                  </button>
                `
              : ""
          }
        </div>
        ${
          expanded && this.isPlayerTeamLabelVisible
            ? html`
                <div
                  class="flex items-center text-white mt-1 shrink-0 text-xs"
                  @contextmenu=${(e: Event) => e.preventDefault()}
                >
                  ${translateText("help_modal.ui_your_team")}
                  <span
                    style="--color: ${this.playerColor.toRgbString()}"
                    class="text-(--color)"
                  >
                    &nbsp;${getTranslatedPlayerTeamLabel(this.playerTeam)}
                    &#10687;
                  </span>
                </div>
              `
            : null
        }
        <div
          class=${`block lg:flex flex-wrap overflow-x-auto min-w-0 ${expanded ? "flex-1 w-full" : "w-full"} transition-all duration-200 ${
            expanded
              ? "opacity-100 mt-0"
              : "opacity-0 max-h-0 overflow-hidden pointer-events-none"
          } ${this.isLeaderboardShow && this.isTeamLeaderboardShow ? "gap-2" : ""}`}
        >
          <leader-board .visible=${this.isLeaderboardShow}></leader-board>
          <team-stats
            class="flex-1"
            .visible=${this.isTeamLeaderboardShow && this.isTeamGame}
          ></team-stats>
        </div>
        <slot></slot>
      </aside>
    `;
  }
}
