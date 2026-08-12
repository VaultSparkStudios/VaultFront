import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  PlayerGame,
  PlayerStatsTree,
  UserMeResponse,
} from "../core/ApiSchemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { workerGamePath } from "../core/RuntimeUrls";
import { fetchPlayerById, getUserMe } from "./Api";
import { logOut, obeliskLogin } from "./Auth";
import "./components/baseComponents/stats/DiscordUserHeader";
import "./components/baseComponents/stats/GameList";
import "./components/baseComponents/stats/PlayerStatsTable";
import "./components/baseComponents/stats/PlayerStatsTree";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/Difficulties";
import "./components/PatternButton";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends BaseModal {
  @state() private isLoadingUser: boolean = false;

  private userMeResponse: UserMeResponse | null = null;
  private statsTree: PlayerStatsTree | null = null;
  private recentGames: PlayerGame[] = [];

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        this.userMeResponse = customEvent.detail as UserMeResponse;
        if (this.userMeResponse?.player?.publicId === undefined) {
          this.statsTree = null;
          this.recentGames = [];
        }
      } else {
        this.statsTree = null;
        this.recentGames = [];
        this.requestUpdate();
      }
    });
  }

  private hasAnyStats(): boolean {
    if (!this.statsTree) return false;
    // Check if statsTree has any data
    return (
      Object.keys(this.statsTree).length > 0 &&
      Object.values(this.statsTree).some(
        (gameTypeStats) =>
          gameTypeStats && Object.keys(gameTypeStats).length > 0,
      )
    );
  }

  render() {
    const content = this.isLoadingUser
      ? this.renderLoadingSpinner(
          translateText("account_modal.fetching_account"),
        )
      : this.renderInner();

    if (this.inline) {
      return this.isLoadingUser
        ? html`<div class="${this.modalContainerClass}">
            ${modalHeader({
              title: translateText("account_modal.title"),
              onBack: () => this.close(),
              ariaLabel: translateText("common.back"),
            })}
            ${content}
          </div>`
        : content;
    }

    return html`
      <o-modal
        id="account-modal"
        title=""
        ?hideCloseButton=${true}
        ?inline=${this.inline}
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  private renderInner() {
    const isLoggedIn = !!this.userMeResponse?.user;
    const title = translateText("account_modal.title");
    const publicId = this.userMeResponse?.player?.publicId ?? "";
    const displayId = publicId || translateText("account_modal.not_found");

    return html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title,
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
          rightContent: isLoggedIn
            ? html`
                <div class="flex items-center gap-2">
                  <span
                    class="text-xs text-blue-400 font-bold uppercase tracking-wider"
                    >${translateText("account_modal.personal_player_id")}</span
                  >
                  <copy-button
                    .lobbyId=${publicId}
                    .copyText=${publicId}
                    .displayText=${displayId}
                  ></copy-button>
                </div>
              `
            : undefined,
        })}

        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1">
          ${isLoggedIn ? this.renderAccountInfo() : this.renderLoginOptions()}
        </div>
      </div>
    `;
  }

  private renderAccountInfo() {
    const me = this.userMeResponse?.user;
    const isLinked = me?.discord ?? me?.email;

    if (!isLinked) {
      return this.renderLoginOptions();
    }

    return html`
      <div class="p-6">
        <div class="flex flex-col gap-6">
          <!-- Top Row: Connected As -->
          <div class="bg-white/5 rounded-xl border border-white/10 p-6">
            <div class="flex flex-col items-center gap-4">
              <div
                class="text-xs text-white/40 uppercase tracking-widest font-bold border-b border-white/5 pb-2 px-8"
              >
                ${translateText("account_modal.connected_as")}
              </div>
              <div class="flex items-center gap-8 justify-center flex-wrap">
                <discord-user-header
                  .data=${this.userMeResponse?.user?.discord ?? null}
                ></discord-user-header>
                ${this.renderLoggedInAs()}
              </div>
            </div>
          </div>

          <!-- Middle Row: Stats Section -->
          ${
            this.hasAnyStats()
              ? html`<div
                  class="bg-white/5 rounded-xl border border-white/10 p-6"
                >
                  <h3
                    class="text-lg font-bold text-white mb-4 flex items-center gap-2"
                  >
                    <span class="text-blue-400">📊</span>
                    ${translateText("account_modal.stats_overview")}
                  </h3>
                  <player-stats-tree-view
                    .statsTree=${this.statsTree}
                  ></player-stats-tree-view>
                </div>`
              : ""
          }

          <!-- Bottom Row: Recent Games Section -->
          <div class="bg-white/5 rounded-xl border border-white/10 p-6">
            <h3
              class="text-lg font-bold text-white mb-4 flex items-center gap-2"
            >
              <span class="text-blue-400">🎮</span>
              ${translateText("game_list.recent_games")}
            </h3>
            <game-list
              .games=${this.recentGames}
              .onViewGame=${(id: string) => void this.viewGame(id)}
            ></game-list>
          </div>
        </div>
      </div>
    `;
  }

  private renderLoggedInAs(): TemplateResult {
    const me = this.userMeResponse?.user;
    if (me?.discord) {
      return html`
        <div class="flex flex-col items-center gap-3 w-full">
          ${this.renderLogoutButton()}
        </div>
      `;
    } else if (me?.email) {
      return html`
        <div class="flex flex-col items-center gap-3 w-full">
          <div class="text-white text-lg font-medium">
            ${translateText("account_modal.linked_account", {
              account_name: me.email,
            })}
          </div>
          ${this.renderLogoutButton()}
        </div>
      `;
    }
    return html``;
  }

  private async viewGame(gameId: string): Promise<void> {
    this.close();
    const config = await getServerConfigFromClient();
    const encodedGameId = encodeURIComponent(gameId);
    const newUrl = workerGamePath(config.workerPath(gameId), gameId);

    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(
      new CustomEvent("join-changed", { detail: { gameId: encodedGameId } }),
    );
  }

  private renderLogoutButton(): TemplateResult {
    return html`
      <button
        @click="${this.handleLogout}"
        class="px-6 py-2 text-sm font-bold text-white uppercase tracking-wider bg-red-600/80 hover:bg-red-600 border border-red-500/50 rounded-lg transition-all shadow-lg hover:shadow-red-900/40"
      >
        ${translateText("account_modal.log_out")}
      </button>
    `;
  }

  private renderLoginOptions() {
    return html`
      <div class="flex items-center justify-center p-6 min-h-full">
        <div
          class="w-full max-w-md bg-white/5 rounded-2xl border border-white/10 p-8 text-center"
        >
          <div
            class="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/10 shadow-inner"
            aria-hidden="true"
          >
            <span class="text-3xl">🛡️</span>
          </div>
          <h3 class="text-xl font-bold text-white mb-3">VaultSpark Passport</h3>
          <p class="text-white/60 text-sm leading-relaxed mb-7">
            One secure identity across VaultSpark. Obelisk handles passkeys,
            account creation, and recovery on the hosted Gate; VaultFront never
            receives your credentials.
          </p>
          <button
            @click="${this.handleObeliskLogin}"
            class="min-h-12 w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 rounded-xl transition-all shadow-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            Continue with Obelisk
          </button>
          <p class="mt-5 text-xs text-white/40">
            New here? Account creation is included after you continue.
          </p>
        </div>
      </div>
    `;
  }

  private handleObeliskLogin() {
    obeliskLogin();
  }

  protected onOpen(): void {
    this.isLoadingUser = true;

    void getUserMe()
      .then((userMe) => {
        if (userMe) {
          this.userMeResponse = userMe;
          if (this.userMeResponse?.player?.publicId) {
            this.loadPlayerProfile(this.userMeResponse.player.publicId);
          }
        }
        this.isLoadingUser = false;
        this.requestUpdate();
      })
      .catch((err) => {
        console.warn("Failed to fetch user info in AccountModal.open():", err);
        this.isLoadingUser = false;
        this.requestUpdate();
      });
    this.requestUpdate();
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  private async handleLogout() {
    await logOut();
    this.close();
    // Refresh the page after logout to update the UI state
    window.location.reload();
  }

  private async loadPlayerProfile(publicId: string): Promise<void> {
    try {
      const data = await fetchPlayerById(publicId);
      if (!data) {
        this.requestUpdate();
        return;
      }

      this.recentGames = data.games;
      this.statsTree = data.stats;

      this.requestUpdate();
    } catch (err) {
      console.warn("Failed to load player data:", err);
      this.requestUpdate();
    }
  }
}
