import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { crazyGamesSDK } from "src/client/CrazyGamesSDK";
import { PauseGameIntentEvent } from "src/client/Transport";
import { EventBus } from "../../../core/EventBus";
import { appRootPath } from "../../../core/RuntimeUrls";
import {
  GameUpdateType,
  VaultFrontActivityUpdate,
  VaultFrontStatusUpdate,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import {
  applyVaultFrontBrandTheme,
  VaultFrontBrandTheme,
} from "../../BrandTheme";
import { AlternateViewEvent, RefreshGraphicsEvent } from "../../InputHandler";
import { translateText } from "../../Utils";
import SoundManager from "../../sound/SoundManager";
import { Layer } from "./Layer";
import structureIcon from "/images/CityIconWhite.svg?url";
import cursorPriceIcon from "/images/CursorPriceIconWhite.svg?url";
import darkModeIcon from "/images/DarkModeIconWhite.svg?url";
import emojiIcon from "/images/EmojiIconWhite.svg?url";
import exitIcon from "/images/ExitIconWhite.svg?url";
import explosionIcon from "/images/ExplosionIconWhite.svg?url";
import mouseIcon from "/images/MouseIconWhite.svg?url";
import ninjaIcon from "/images/NinjaIconWhite.svg?url";
import settingsIcon from "/images/SettingIconWhite.svg?url";
import sirenIcon from "/images/SirenIconWhite.svg?url";
import treeIcon from "/images/TreeIconWhite.svg?url";
import musicIcon from "/images/music.svg?url";

export class ShowSettingsModalEvent {
  constructor(
    public readonly isVisible: boolean = true,
    public readonly shouldPause: boolean = false,
    public readonly isPaused: boolean = false,
  ) {}
}

@customElement("settings-modal")
export class SettingsModal extends LitElement implements Layer {
  public eventBus: EventBus;
  public userSettings: UserSettings;
  public game?: GameView;

  @state()
  private isVisible: boolean = false;

  @state()
  private alternateView: boolean = false;

  @state()
  private activeTab: "basic" | "rules" = "basic";

  @state()
  private latestVaultStatus: VaultFrontStatusUpdate | null = null;

  @state()
  private recentVaultActivity: VaultFrontActivityUpdate[] = [];

  @query(".modal-overlay")
  private modalOverlay!: HTMLElement;

  @property({ type: Boolean })
  shouldPause = false;

  @property({ type: Boolean })
  wasPausedWhenOpened = false;

  init() {
    SoundManager.setBackgroundMusicVolume(
      this.userSettings.backgroundMusicVolume(),
    );
    SoundManager.setSoundEffectsVolume(this.userSettings.soundEffectsVolume());
    this.eventBus.on(ShowSettingsModalEvent, (event) => {
      this.isVisible = event.isVisible;
      this.shouldPause = event.shouldPause;
      this.wasPausedWhenOpened = event.isPaused;
      this.pauseGame(true);
    });
  }

  getTickIntervalMs(): number {
    return 200;
  }

  tick(): void {
    if (!this.game) return;

    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    const statusUpdates = updates[
      GameUpdateType.VaultFrontStatus
    ] as VaultFrontStatusUpdate[];
    if (statusUpdates.length > 0) {
      this.latestVaultStatus = statusUpdates[statusUpdates.length - 1];
    }

    const activityUpdates = updates[
      GameUpdateType.VaultFrontActivity
    ] as VaultFrontActivityUpdate[];
    if (activityUpdates.length > 0) {
      this.recentVaultActivity = [
        ...this.recentVaultActivity,
        ...activityUpdates,
      ].slice(-8);
    }

    if (this.isVisible && this.activeTab === "rules") {
      this.requestUpdate();
    }
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("click", this.handleOutsideClick, true);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("click", this.handleOutsideClick, true);
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleOutsideClick = (event: MouseEvent) => {
    if (
      this.isVisible &&
      this.modalOverlay &&
      event.target === this.modalOverlay
    ) {
      this.closeModal();
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.isVisible && event.key === "Escape") {
      this.closeModal();
    }
  };

  public openModal() {
    this.isVisible = true;
    this.requestUpdate();
  }

  public closeModal() {
    this.isVisible = false;
    this.requestUpdate();
    this.pauseGame(false);
  }

  private pauseGame(pause: boolean) {
    if (this.shouldPause && !this.wasPausedWhenOpened) {
      if (pause) {
        crazyGamesSDK.gameplayStop();
      } else {
        crazyGamesSDK.gameplayStart();
      }
      this.eventBus.emit(new PauseGameIntentEvent(pause));
    }
  }

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onToggleEmojisButtonClick() {
    this.userSettings.toggleEmojis();
    this.requestUpdate();
  }

  private onToggleStructureSpritesButtonClick() {
    this.userSettings.toggleStructureSprites();
    this.requestUpdate();
  }

  private onToggleSpecialEffectsButtonClick() {
    this.userSettings.toggleFxLayer();
    this.requestUpdate();
  }

  private onToggleAlertFrameButtonClick() {
    this.userSettings.toggleAlertFrame();
    this.requestUpdate();
  }

  private onToggleDarkModeButtonClick() {
    this.userSettings.toggleDarkMode();
    this.eventBus.emit(new RefreshGraphicsEvent());
    this.requestUpdate();
  }

  private onToggleRandomNameModeButtonClick() {
    this.userSettings.toggleRandomName();
    this.requestUpdate();
  }

  private onToggleLeftClickOpensMenu() {
    this.userSettings.toggleLeftClickOpenMenu();
    this.requestUpdate();
  }

  private onToggleCursorCostLabelButtonClick() {
    this.userSettings.toggleCursorCostLabel();
    this.requestUpdate();
  }

  private onTogglePerformanceOverlayButtonClick() {
    this.userSettings.togglePerformanceOverlay();
    this.requestUpdate();
  }

  private onExitButtonClick() {
    // redirect to the home page
    window.location.href = appRootPath();
  }

  private onVolumeChange(event: Event) {
    const volume = parseFloat((event.target as HTMLInputElement).value) / 100;
    this.userSettings.setBackgroundMusicVolume(volume);
    SoundManager.setBackgroundMusicVolume(volume);
    this.requestUpdate();
  }

  private onSoundEffectsVolumeChange(event: Event) {
    const volume = parseFloat((event.target as HTMLInputElement).value) / 100;
    this.userSettings.setSoundEffectsVolume(volume);
    SoundManager.setSoundEffectsVolume(volume);
    this.requestUpdate();
  }

  private onSetBrandTheme(theme: VaultFrontBrandTheme) {
    this.userSettings.setBrandTheme(theme);
    applyVaultFrontBrandTheme(theme);
    this.requestUpdate();
  }

  private switchTab(tab: "basic" | "rules") {
    this.activeTab = tab;
    this.requestUpdate();
  }

  private tr(key: string, fallback: string): string {
    const translated = translateText(key);
    return translated === key ? fallback : translated;
  }

  private renderVaultFrontRules() {
    const status = this.latestVaultStatus;
    const myPlayer = this.game?.myPlayer();
    const mySmallID = myPlayer?.smallID();
    const myBeacon =
      status?.beacons.find((entry) => entry.playerID === mySmallID) ?? null;
    const siteCount = status?.sites.length ?? 0;
    const convoyCount = status?.convoys.length ?? 0;
    const maskTicksLeft = myBeacon
      ? Math.max(0, myBeacon.maskedUntilTick - (this.game?.ticks() ?? 0))
      : 0;

    return html`
      <div class="p-4 flex flex-col gap-3 text-white/90">
        <div
          class="rounded-sm border border-yellow-400/40 bg-yellow-400/10 p-3"
        >
          <div class="font-semibold text-yellow-100">Live Resource Focus</div>
          <div class="text-sm text-slate-200 mt-1">
            The in-game Resource Focus slider shifts income between gold and
            troop generation on a 0-100 scale while the match is running.
          </div>
        </div>

        <div class="rounded-sm border border-cyan-400/40 bg-cyan-400/10 p-3">
          <div class="font-semibold text-cyan-200">Vault Sites</div>
          <div class="text-sm text-slate-200 mt-1">
            Hold a marked vault tile for ~9s to launch an extraction Vault
            Convoy. Captured vaults go on cooldown (~65s) and generate passive
            gold every 60s while you keep control.
          </div>
          <div class="text-xs text-cyan-100/90 mt-2">
            Live: ${siteCount} sites, ${convoyCount} active Vault Convoys
          </div>
        </div>

        <div class="rounded-sm border border-blue-400/40 bg-blue-400/10 p-3">
          <div class="font-semibold text-blue-200">Defense Factories</div>
          <div class="text-sm text-slate-200 mt-1">
            Build a Defense Factory (same cost and slot as Factory). It charges
            over time and pulses automatically, hiding your troop total and
            attack troop data from other players for a short window.
          </div>
          <div class="text-xs text-blue-100/90 mt-2">
            ${
              myBeacon
                ? `Charge: ${Math.floor(myBeacon.charge)}/100 | Pulse hidden window: ${Math.ceil(maskTicksLeft / 10)}s`
                : "Build a Defense Factory to start intel masking pulses."
            }
          </div>
        </div>

        <div
          class="rounded-sm border border-fuchsia-400/40 bg-fuchsia-400/10 p-3"
        >
          <div class="font-semibold text-fuchsia-200">Vault Convoy Combat</div>
          <div class="text-sm text-slate-200 mt-1">
            Vault Convoys are visible in motion on their route and can be
            intercepted mid-route when enemies control your travel lanes.
          </div>
        </div>

        <div class="rounded-sm border border-amber-400/40 bg-amber-400/10 p-3">
          <div class="font-semibold text-amber-200">Map Legend</div>
          <div class="text-sm text-slate-200 mt-1">
            Vault circles, Vault Convoy routes, passive-income timers, and
            Defense Factory pulse fields are drawn directly on the map.
          </div>
        </div>

        <div
          class="rounded-sm border border-emerald-400/40 bg-emerald-400/10 p-3"
        >
          <div class="font-semibold text-emerald-200">
            Next Renewable Resource Concepts
          </div>
          <div class="text-sm text-slate-200 mt-1">
            Salvage Nodes: periodic steel income for faster structure upgrades.
          </div>
          <div class="text-sm text-slate-200">
            Fuel Wells: temporary movement-speed boosts for Vault Convoys and
            warships.
          </div>
          <div class="text-sm text-slate-200">
            Signal Arrays: map vision bursts and faster Defense Factory charge
            while controlled.
          </div>
        </div>

        <div class="rounded-sm border border-slate-500/40 bg-slate-900/50 p-3">
          <div class="font-semibold text-slate-100">
            Recent VaultFront Activity
          </div>
          <div class="mt-2 text-xs text-slate-300 space-y-1">
            ${
              this.recentVaultActivity.length === 0
                ? html`<div>No activity recorded yet.</div>`
                : this.recentVaultActivity.map(
                    (entry) => html`<div>- ${entry.label}</div>`,
                  )
            }
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.isVisible) {
      return null;
    }

    return html`
      <div
        class="modal-overlay fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-4"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="bg-slate-800 border border-slate-600 rounded-lg max-w-md w-full max-h-[80vh] overflow-y-auto"
        >
          <div
            class="flex items-center justify-between p-4 border-b border-slate-600"
          >
            <div class="flex items-center gap-2">
              <img
                src=${settingsIcon}
                alt="settings"
                width="24"
                height="24"
                class="align-middle"
              />
              <h2 class="text-xl font-semibold text-white">
                ${
                  this.activeTab === "basic"
                    ? translateText("user_setting.tab_basic")
                    : "VaultFront Rules"
                }
              </h2>
            </div>
            <button
              class="text-slate-400 hover:text-white text-2xl font-bold leading-none"
              @click=${this.closeModal}
            >
              x
            </button>
          </div>

          <div class="px-4 pt-3 flex gap-2 border-b border-slate-700/70">
            <button
              class="px-3 py-1.5 text-xs rounded-sm border transition-colors ${
                this.activeTab === "basic"
                  ? "bg-slate-700 text-white border-slate-500"
                  : "bg-slate-800/60 text-slate-300 border-slate-600 hover:bg-slate-700"
              }"
              @click=${() => this.switchTab("basic")}
            >
              ${translateText("user_setting.tab_basic")}
            </button>
            <button
              class="px-3 py-1.5 text-xs rounded-sm border transition-colors ${
                this.activeTab === "rules"
                  ? "bg-slate-700 text-white border-slate-500"
                  : "bg-slate-800/60 text-slate-300 border-slate-600 hover:bg-slate-700"
              }"
              @click=${() => this.switchTab("rules")}
            >
              VaultFront Rules
            </button>
          </div>

          ${
            this.activeTab === "basic"
              ? html`<div class="p-4 flex flex-col gap-3">
                  <div
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                  >
                    <img
                      src=${musicIcon}
                      alt="musicIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.background_music_volume")}
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        .value=${this.userSettings.backgroundMusicVolume() * 100}
                        @input=${this.onVolumeChange}
                        class="w-full border border-slate-500 rounded-lg"
                      />
                    </div>
                    <div class="text-sm text-slate-400">
                      ${Math.round(
                        this.userSettings.backgroundMusicVolume() * 100,
                      )}%
                    </div>
                  </div>

                  <div
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                  >
                    <img
                      src=${musicIcon}
                      alt="soundEffectsIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.sound_effects_volume")}
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        .value=${this.userSettings.soundEffectsVolume() * 100}
                        @input=${this.onSoundEffectsVolumeChange}
                        class="w-full border border-slate-500 rounded-lg"
                      />
                    </div>
                    <div class="text-sm text-slate-400">
                      ${Math.round(this.userSettings.soundEffectsVolume() * 100)}%
                    </div>
                  </div>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onTerrainButtonClick}"
                  >
                    <img
                      src=${treeIcon}
                      alt="treeIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.toggle_terrain")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.toggle_view_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.alternateView
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onToggleEmojisButtonClick}"
                  >
                    <img
                      src=${emojiIcon}
                      alt="emojiIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.emojis_label")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.emojis_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.userSettings.emojis()
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onToggleDarkModeButtonClick}"
                  >
                    <img
                      src=${darkModeIcon}
                      alt="darkModeIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.dark_mode_label")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.dark_mode_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.userSettings.darkMode()
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <div
                    class="flex gap-3 items-start w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                  >
                    <img
                      src=${settingsIcon}
                      alt="brandThemeIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${this.tr(
                          "user_setting.brand_theme_label",
                          "Brand Theme",
                        )}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${this.tr(
                          "user_setting.brand_theme_desc",
                          "Choose the in-game VaultFront visual palette.",
                        )}
                      </div>
                      <div class="mt-2 flex gap-2">
                        ${(
                          [
                            "vaultfront",
                            "light",
                            "competitive",
                          ] as VaultFrontBrandTheme[]
                        ).map(
                          (theme) => html`
                            <button
                              class="px-2 py-1 text-xs rounded border ${
                                this.userSettings.brandTheme() === theme
                                  ? "border-amber-300/60 bg-amber-500/20 text-amber-100"
                                  : "border-slate-500 text-slate-200 hover:bg-slate-600/40"
                              }"
                              @click=${() => this.onSetBrandTheme(theme)}
                            >
                              ${
                                theme === "vaultfront"
                                  ? this.tr(
                                      "user_setting.brand_theme_vaultfront",
                                      "Dark",
                                    )
                                  : theme === "light"
                                    ? this.tr(
                                        "user_setting.brand_theme_light",
                                        "Light",
                                      )
                                    : this.tr(
                                        "user_setting.brand_theme_competitive",
                                        "Competitive",
                                      )
                              }
                            </button>
                          `,
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onToggleSpecialEffectsButtonClick}"
                  >
                    <img
                      src=${explosionIcon}
                      alt="specialEffects"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.special_effects_label")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.special_effects_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.userSettings.fxLayer()
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onToggleAlertFrameButtonClick}"
                  >
                    <img
                      src=${sirenIcon}
                      alt="alertFrame"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.alert_frame_label")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.alert_frame_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.userSettings.alertFrame()
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onToggleStructureSpritesButtonClick}"
                  >
                    <img
                      src=${structureIcon}
                      alt="structureSprites"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.structure_sprites_label")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.structure_sprites_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.userSettings.structureSprites()
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onToggleCursorCostLabelButtonClick}"
                  >
                    <img
                      src=${cursorPriceIcon}
                      alt="cursorCostLabel"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.cursor_cost_label_label")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.cursor_cost_label_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.userSettings.cursorCostLabel()
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onToggleRandomNameModeButtonClick}"
                  >
                    <img
                      src=${ninjaIcon}
                      alt="ninjaIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.anonymous_names_label")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.anonymous_names_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.userSettings.anonymousNames()
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onToggleLeftClickOpensMenu}"
                  >
                    <img
                      src=${mouseIcon}
                      alt="mouseIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.left_click_menu")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.left_click_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.userSettings.leftClickOpensMenu()
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <button
                    class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                    @click="${this.onTogglePerformanceOverlayButtonClick}"
                  >
                    <img
                      src=${settingsIcon}
                      alt="performanceIcon"
                      width="20"
                      height="20"
                    />
                    <div class="flex-1">
                      <div class="font-medium">
                        ${translateText("user_setting.performance_overlay_label")}
                      </div>
                      <div class="text-sm text-slate-400">
                        ${translateText("user_setting.performance_overlay_desc")}
                      </div>
                    </div>
                    <div class="text-sm text-slate-400">
                      ${
                        this.userSettings.performanceOverlay()
                          ? translateText("user_setting.on")
                          : translateText("user_setting.off")
                      }
                    </div>
                  </button>

                  <div class="border-t border-slate-600 pt-3 mt-4">
                    <button
                      class="flex gap-3 items-center w-full text-left p-3 hover:bg-red-600/20 rounded-sm text-red-400 transition-colors"
                      @click="${this.onExitButtonClick}"
                    >
                      <img
                        src=${exitIcon}
                        alt="exitIcon"
                        width="20"
                        height="20"
                      />
                      <div class="flex-1">
                        <div class="font-medium">
                          ${translateText("user_setting.exit_game_label")}
                        </div>
                        <div class="text-sm text-slate-400">
                          ${translateText("user_setting.exit_game_info")}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>`
              : this.renderVaultFrontRules()
          }
        </div>
      </div>
    `;
  }
}
