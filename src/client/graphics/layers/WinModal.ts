import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  getGamesPlayed,
  isInIframe,
  translateText,
  TUTORIAL_VIDEO_URL,
} from "../../../client/Utils";
import { ColorPalette, Pattern } from "../../../core/CosmeticSchemas";
import { EventBus } from "../../../core/EventBus";
import { RankedType } from "../../../core/game/Game";
import type { WinUpdate } from "../../../core/game/GameUpdates";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { appRelativePath, appRootPath } from "../../../core/RuntimeUrls";
import type { AllPlayersStats, Winner } from "../../../core/Schemas";
import {
  castMutatorVote,
  type CoachDebriefMoment,
  createRematch,
  fetchCoachDebrief,
  fetchDynastyStory,
  fetchMatchRecap,
  fetchMutatorVoteStatus,
  fetchVaultFrontContracts,
  fetchVaultFrontRecapAssignment,
  fetchWinFortune,
  type FortuneItem,
  getUserMe,
  type MutatorVoteCandidate,
  recordVaultFrontOutcomeTelemetry,
  recordVaultFrontPlaytestPulse,
  recordVaultFrontRecapEvent,
  type RematchStatus,
  ReplayHighlight,
  requestReplayHighlight,
  shareMatchInvite,
  shareReplayHighlight,
  VaultFrontSeasonContractState,
} from "../../Api";
import "../../components/PatternButton";
import { type MasteryGoalKey, persistConvoyMastery } from "../../ConvoyMastery";
import {
  fetchCosmetics,
  handlePurchase,
  patternRelationship,
} from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { Platform } from "../../Platform";
import { SendWinnerEvent } from "../../Transport";
import { Layer } from "./Layer";
import { GoToPositionEvent } from "./Leaderboard";

interface RecapCard {
  key: "vault" | "convoy" | "pulse" | "focus";
  title: string;
  myValue: string;
  winnerValue: string;
  deltaText: string;
  positive: boolean;
  ratio: number;
}

interface SeasonalContract {
  title: string;
  description: string;
  progress: number;
  target: number;
}

interface ReplayMoment {
  id: string;
  label: string;
  tile: number | null;
  scope: "personal" | "team" | "global";
}

@customElement("win-modal")
export class WinModal extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  @state()
  showButtons = false;

  @state()
  private isWin = false;

  @state()
  private isRankedGame = false;

  @state()
  private patternContent: TemplateResult | null = null;

  @state()
  private recapCards: RecapCard[] = [];

  @state()
  private recapReason = "";

  @state()
  private actionableHint = "";

  @state()
  private momentRewards: string[] = [];

  @state()
  private recapActionPlan: string[] = [];

  private actionableGoalKey:
    "vault_first" | "convoy_impact" | "pulse_chain" | "focus_stable" | "" = "";

  @state()
  private nextGoalSaved = false;

  @state()
  private seasonalContracts: SeasonalContract[] = [];

  @state()
  private rivalryRevengeDelta = 0;

  @state()
  private replayMoments: ReplayMoment[] = [];

  @state()
  private recapCtaVariant: "goal_focus" | "requeue_focus" = "goal_focus";

  private _title: string;

  private rand = Math.random();
  private kpiRecorded = false;
  private recapExposureTracked = false;
  private recapGoalClicked = false;
  private recapRequeueClicked = false;
  private rivalChallengeExposureTracked = false;
  private outcomePosted = false;
  private behindAtMinute8 = false;
  private matchLengthSeconds = 0;

  // Achievement spotlight — populated by queueAchievementSpotlight() before show()
  @state()
  private spotlightAchievement: {
    name: string;
    description: string;
    iconEmoji?: string;
  } | null = null;
  @state()
  private showSpotlight = false;

  @state()
  private shareCopied = false;

  @state()
  private rematchPending = false;

  @state()
  private rematchResult: RematchStatus | null = null;

  @state()
  private rematchError: string | null = null;

  @state()
  private highlightCopied = false;

  @state()
  private replayHighlight: ReplayHighlight | null = null;

  @state()
  private playStyleLabel: string | null = null;

  @state()
  private playStyleBars: Array<{ label: string; pct: number; color: string }> =
    [];

  @state()
  private microFeedbackSent: "epic" | "balanced" | "off" | null = null;

  @state()
  private mutatorVoteCandidates: MutatorVoteCandidate[] = [];

  @state()
  private mutatorVoteSentKey: string | null = null;

  @state()
  private eloData: {
    previous: number;
    current: number;
    label: string;
    animated: number;
    tierChanged: boolean;
  } | null = null;

  @state()
  private shareCardCopied = false;

  @state()
  private fortuneItem: FortuneItem | null = null;

  @state()
  private fortuneRevealed = false;

  @state()
  private matchRecap: string | null = null;

  @state()
  private coachDebriefMoments: CoachDebriefMoment[] | null = null;

  @state()
  private coachDebriefLoading = false;

  @state()
  private activeTab: "recap" | "coach" | "fortune" = "recap";

  @state()
  private dynastyStory: string | null = null;

  @state()
  private dynastyStoryTyped = "";

  private dynastyStoryTyperTimer: ReturnType<typeof setTimeout> | null = null;

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
  }

  render() {
    return html`
      <div
        class="${
          this.isVisible
            ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-6 shrink-0 rounded-lg z-9999 shadow-2xl backdrop-blur-xs text-white w-87.5 max-w-[90%] md:w-175"
            : "hidden"
        }"
      >
        ${
          this.showSpotlight && this.spotlightAchievement
            ? html`
                <div
                  class="flex flex-col items-center justify-center py-8 gap-4 animate-pulse"
                >
                  <div class="text-6xl">
                    ${this.spotlightAchievement.iconEmoji ?? "🏆"}
                  </div>
                  <div
                    class="text-amber-300 text-xs font-semibold tracking-widest uppercase"
                  >
                    Achievement Unlocked
                  </div>
                  <div class="text-white text-2xl font-bold text-center">
                    ${this.spotlightAchievement.name}
                  </div>
                  <div class="text-slate-300 text-sm text-center max-w-xs">
                    ${this.spotlightAchievement.description}
                  </div>
                </div>
              `
            : html`
                <h2 class="m-0 mb-4 text-[26px] text-center text-white">
                  ${this._title || ""}
                </h2>
                ${this.renderRecapSection()} ${this.innerHtml()}
              `
        }
        ${this.showButtons ? this.renderMicroFeedback() : null}
        ${
          this.showButtons && this.mutatorVoteCandidates.length > 0
            ? this.renderMutatorVote()
            : null
        }
        <div class="${this.showButtons ? "flex flex-col gap-2" : "hidden"}">
          <div class="flex justify-between gap-2.5">
            <button
              @click=${this._handleExit}
              class="flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px"
            >
              ${translateText("win_modal.exit")}
            </button>
            ${
              this.isRankedGame
                ? html`
                    <button
                      @click=${this._handleRequeue}
                      class="flex-1 px-3 py-3 text-base cursor-pointer bg-purple-600 text-white border-0 rounded-sm transition-all duration-200 hover:bg-purple-500 hover:-translate-y-px active:translate-y-px"
                    >
                      ${translateText("win_modal.requeue")}
                    </button>
                  `
                : null
            }
            <button
              @click=${this.hide}
              class="flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px"
            >
              ${
                this.game?.myPlayer()?.isAlive()
                  ? translateText("win_modal.keep")
                  : translateText("win_modal.spectate")
              }
            </button>
          </div>
          <div class="flex justify-between gap-2.5">
            <button
              @click=${this._handleShare}
              class="flex-1 px-3 py-2 text-sm cursor-pointer bg-green-600/70 text-white border-0 rounded-sm transition-all duration-200 hover:bg-green-600/90 hover:-translate-y-px active:translate-y-px"
            >
              ${this.shareCopied ? "Link copied!" : "Share Match"}
            </button>
            <button
              @click=${this._handleRematch}
              class="flex-1 px-3 py-2 text-sm cursor-pointer bg-orange-500/70 text-white border-0 rounded-sm transition-all duration-200 hover:bg-orange-500/90 hover:-translate-y-px active:translate-y-px disabled:cursor-wait disabled:opacity-60"
              ?disabled=${this.rematchPending}
            >
              ${
                this.rematchPending
                  ? "Creating rematch…"
                  : this.rematchResult
                    ? "Open rematch lobby"
                    : this.rematchError
                      ? "Retry rematch"
                      : "Rematch"
              }
            </button>
            <button
              @click=${this._handleShareHighlight}
              class="flex-1 px-3 py-2 text-sm cursor-pointer bg-indigo-600/70 text-white border-0 rounded-sm transition-all duration-200 hover:bg-indigo-600/90 hover:-translate-y-px active:translate-y-px"
            >
              ${this.highlightCopied ? "Clip copied!" : "Share Clip"}
            </button>
            ${
              this.replayHighlight
                ? html`<a
                    href=${this.replayHighlight.shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex-1 px-3 py-2 text-sm cursor-pointer bg-violet-600/70 text-white border-0 rounded-sm transition-all duration-200 hover:bg-violet-600/90 hover:-translate-y-px text-center no-underline"
                    title="${this.replayHighlight.ogTitle}"
                  >
                    ▶ Watch Highlight<br /><span
                      class="text-[10px] text-violet-200/80"
                      >${this.replayHighlight.topMoment}</span
                    >
                  </a>`
                : ""
            }
          </div>
          ${
            this.rematchResult
              ? html`<a
                  href=${this.rematchResult.joinUrl}
                  class="block text-xs text-center text-orange-200 underline underline-offset-2"
                  >Rematch lobby ready · join before it expires</a
                >`
              : this.rematchError
                ? html`<p class="text-xs text-center text-red-300" role="alert">
                    ${this.rematchError}
                  </p>`
                : ""
          }
          <div class="flex justify-end">
            <button
              @click=${this._handleShareCard}
              class="px-3 py-1.5 text-xs cursor-pointer bg-teal-600/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-teal-600/90"
            >
              ${this.shareCardCopied ? "Card saved!" : "Save Result Card"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderMicroFeedback() {
    if (this.microFeedbackSent) {
      return html`
        <div class="text-center text-slate-400 text-xs py-2">
          Thanks for the feedback!
        </div>
      `;
    }
    const send = (signal: "epic" | "balanced" | "off") => {
      this.microFeedbackSent = signal;
      this.requestUpdate();
      // Best-effort fire-and-forget; failure is acceptable for telemetry
      void recordVaultFrontRecapEvent({
        event: `match_feedback_${signal}`,
        variant: this.recapCtaVariant,
        value: 1,
      });
      void recordVaultFrontPlaytestPulse({
        surface: "match",
        event: `feedback_${signal}`,
      });
    };
    return html`
      <div class="flex justify-center gap-3 py-2 border-t border-white/10 mt-2">
        <button
          @click=${() => send("epic")}
          class="px-3 py-1.5 text-sm bg-transparent border border-amber-500/40 text-amber-300 rounded-md cursor-pointer hover:bg-amber-500/20 transition-colors"
          title="Epic match"
        >
          🔥 Epic
        </button>
        <button
          @click=${() => send("balanced")}
          class="px-3 py-1.5 text-sm bg-transparent border border-slate-500/40 text-slate-300 rounded-md cursor-pointer hover:bg-slate-500/20 transition-colors"
          title="Felt balanced"
        >
          ⚖️ Balanced
        </button>
        <button
          @click=${() => send("off")}
          class="px-3 py-1.5 text-sm bg-transparent border border-slate-500/40 text-slate-400 rounded-md cursor-pointer hover:bg-slate-500/20 transition-colors"
          title="Something was off"
        >
          😤 Off
        </button>
      </div>
    `;
  }

  private renderMutatorVote() {
    if (this.mutatorVoteSentKey) {
      const voted = this.mutatorVoteCandidates.find(
        (c) => c.key === this.mutatorVoteSentKey,
      );
      return html`
        <div
          class="border-t border-slate-600/40 mt-2 pt-2 text-center vote-confirmed-anim"
        >
          <style>
            @keyframes vote-confirmed-pulse {
              0% {
                background: rgba(34, 197, 94, 0.25);
              }
              60% {
                background: rgba(34, 197, 94, 0.08);
              }
              100% {
                background: transparent;
              }
            }
            .vote-confirmed-anim {
              animation: vote-confirmed-pulse 1.2s ease-out forwards;
              border-radius: 8px;
              padding: 8px;
            }
          </style>
          <div class="text-xs text-green-400 font-semibold mb-0.5">
            ✓ Vote cast!
          </div>
          <div class="text-xs text-slate-300">
            <span class="text-amber-300 font-semibold"
              >${voted?.name ?? this.mutatorVoteSentKey}</span
            >
            — you'll see it in action next week if it wins.
          </div>
        </div>
      `;
    }

    const vote = async (key: string) => {
      this.mutatorVoteSentKey = key;
      this.requestUpdate();
      const user = await getUserMe().catch(() => null);
      const voterId =
        user !== null && user !== false ? user.player.publicId : undefined;
      await castMutatorVote(key, voterId);
    };

    return html`
      <div class="border-t border-slate-600/40 mt-2 pt-2">
        <div class="flex items-center justify-center gap-1.5 mb-2">
          <span
            class="text-xs font-semibold text-purple-300 tracking-wide uppercase"
            >⚡ Vote: Next Week's Mutator</span
          >
        </div>
        <div class="grid grid-cols-2 gap-2">
          ${this.mutatorVoteCandidates.slice(0, 2).map(
            (c) => html`
              <button
                @click=${() => vote(c.key)}
                class="flex flex-col items-center gap-1 px-3 py-2.5 bg-purple-900/20 border border-purple-500/40 text-purple-200 rounded-lg cursor-pointer hover:bg-purple-500/30 hover:border-purple-400/70 hover:scale-[1.02] transition-all text-xs font-medium"
              >
                <span class="text-sm">${c.name}</span>
              </button>
            `,
          )}
        </div>
        ${
          this.mutatorVoteCandidates.length > 2
            ? html`
                <div class="flex justify-center mt-1.5 gap-2">
                  ${this.mutatorVoteCandidates
                    .slice(2)
                    .map(
                      (c) => html`
                        <button
                          @click=${() => vote(c.key)}
                          class="px-3 py-1.5 text-xs bg-transparent border border-purple-500/30 text-purple-400 rounded-md cursor-pointer hover:bg-purple-500/15 transition-colors"
                        >
                          ${c.name}
                        </button>
                      `,
                    )}
                </div>
              `
            : null
        }
      </div>
    `;
  }

  private renderRecapSection() {
    if (this.recapCards.length === 0) return null;
    const requeuePrimary =
      this.recapCtaVariant === "requeue_focus" && this.isRankedGame;

    return html`
      <div class="mb-4 rounded-sm border border-slate-500/50 bg-black/25 p-3">
        <div class="text-base font-semibold text-cyan-100 mb-2">
          VaultFront Match Recap
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          ${this.recapCards.map(
            (card) => html`
              <div
                class="rounded-sm border ${
                  card.positive
                    ? "border-emerald-400/50 bg-emerald-900/25"
                    : "border-rose-400/50 bg-rose-900/20"
                } p-2"
              >
                <div class="text-xs uppercase tracking-wide text-slate-300">
                  ${card.title}
                </div>
                <div class="text-sm text-white mt-0.5">
                  You: ${card.myValue} | Winners: ${card.winnerValue}
                </div>
                <div
                  class="text-xs mt-1 ${
                    card.positive ? "text-emerald-200" : "text-rose-200"
                  }"
                >
                  ${card.deltaText}
                </div>
              </div>
            `,
          )}
        </div>

        <div class="mt-2 text-sm text-slate-100">${this.recapReason}</div>
        ${
          this.momentRewards.length > 0
            ? html`<div
                class="mt-2 rounded-sm border border-cyan-400/35 bg-cyan-900/20 p-2"
              >
                <div class="text-xs uppercase tracking-wide text-cyan-200">
                  Moment Rewards
                </div>
                <div class="mt-1 flex flex-wrap gap-1.5">
                  ${this.momentRewards.map(
                    (moment) =>
                      html`<span
                        class="rounded border border-cyan-300/35 bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-50"
                        >${moment}</span
                      >`,
                  )}
                </div>
              </div>`
            : ""
        }

        <div
          class="mt-2 rounded-sm border border-amber-400/40 bg-amber-900/25 p-2"
        >
          <div class="text-xs uppercase tracking-wide text-amber-200">
            Next Match Hint
          </div>
          <div class="text-sm text-amber-100 mt-1">${this.actionableHint}</div>
          ${
            this.recapActionPlan.length > 0
              ? html`<div
                  class="mt-2 rounded-sm border border-amber-300/25 bg-black/15 p-2 text-[12px] text-amber-50"
                >
                  <div
                    class="text-[11px] uppercase tracking-wide text-amber-200"
                  >
                    Next Match Script
                  </div>
                  <div class="mt-1 space-y-1">
                    ${this.recapActionPlan.map(
                      (step, index) => html`<div>${index + 1}. ${step}</div>`,
                    )}
                  </div>
                </div>`
              : ""
          }
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              class="px-3 py-1.5 text-sm cursor-pointer border-0 rounded-sm transition-colors ${
                requeuePrimary
                  ? "bg-fuchsia-500/80 text-white hover:bg-fuchsia-400"
                  : "bg-amber-500/70 text-black hover:bg-amber-400"
              }"
              @click=${
                requeuePrimary
                  ? this.onRecapPrimaryRequeueClick
                  : this.saveNextMatchGoal
              }
            >
              ${
                requeuePrimary
                  ? "Queue Next Ranked Match"
                  : this.nextGoalSaved
                    ? "Goal Saved"
                    : "Set As Next Match Goal"
              }
            </button>
            ${
              requeuePrimary
                ? html`
                    <button
                      class="px-3 py-1.5 text-sm cursor-pointer bg-amber-500/70 text-black border-0 rounded-sm hover:bg-amber-400 transition-colors"
                      @click=${this.saveNextMatchGoal}
                    >
                      ${this.nextGoalSaved ? "Goal Saved" : "Save Goal Instead"}
                    </button>
                  `
                : null
            }
          </div>
        </div>

        ${this.renderRivalChallenge()} ${this.renderSeasonalContracts()}
        ${this.renderReplayMoments()} ${this.renderEloSection()}
        ${this.renderPlayStyleCard()} ${this.renderDynastyStory()}
        ${this.renderAITabSection()}
      </div>
    `;
  }

  private renderFortuneCard() {
    if (!this.fortuneItem) return null;
    const rarityColors: Record<string, string> = {
      legendary: "border-amber-400/80 bg-amber-900/30",
      rare: "border-violet-400/70 bg-violet-900/25",
      common: "border-slate-400/40 bg-slate-900/20",
    };
    const cls = rarityColors[this.fortuneItem.rarity] ?? rarityColors.common;
    return html`
      <div class="mt-2 rounded-sm border ${cls} p-3">
        <div class="text-xs uppercase tracking-wide text-amber-200 mb-1">
          Post-Win Fortune
        </div>
        ${
          this.fortuneRevealed
            ? html`
                <div class="flex items-center gap-3">
                  <div class="text-3xl">
                    ${
                      this.fortuneItem.type === "emoji"
                        ? this.fortuneItem.value
                        : this.fortuneItem.type === "badge"
                          ? "🏅"
                          : "🏆"
                    }
                  </div>
                  <div>
                    <div class="text-sm font-bold text-white">
                      ${this.fortuneItem.name}
                    </div>
                    <div class="text-xs text-slate-300 capitalize">
                      ${this.fortuneItem.rarity} · ${this.fortuneItem.type}
                    </div>
                  </div>
                </div>
              `
            : html`
                <button
                  class="w-full py-2 text-sm bg-amber-500/20 border border-amber-400/40 rounded text-amber-200 cursor-pointer hover:bg-amber-500/35 transition-colors"
                  @click=${() => {
                    this.fortuneRevealed = true;
                    this.requestUpdate();
                  }}
                >
                  ✦ Reveal Fortune
                </button>
              `
        }
      </div>
    `;
  }

  private renderAIMatchStory() {
    if (!this.matchRecap) return null;
    return html`
      <div class="mt-2 rounded-sm border border-cyan-400/35 bg-cyan-900/15 p-3">
        <div class="text-xs uppercase tracking-wide text-cyan-300 mb-1">
          Match Story
        </div>
        <div class="text-sm text-slate-100 leading-relaxed italic">
          ${this.matchRecap}
        </div>
      </div>
    `;
  }

  private renderCoachDebrief() {
    return html`
      <div class="mt-2">
        ${
          this.coachDebriefMoments === null
            ? html`
                <button
                  class="w-full py-2 text-sm bg-indigo-500/20 border border-indigo-400/40 rounded text-indigo-200 cursor-pointer hover:bg-indigo-500/35 transition-colors"
                  @click=${() => {
                    this._loadCoachDebrief();
                    this.requestUpdate();
                  }}
                  ?disabled=${this.coachDebriefLoading}
                >
                  ${
                    this.coachDebriefLoading
                      ? "Loading coach debrief…"
                      : "🎯 Get AI Coach Debrief"
                  }
                </button>
              `
            : this.coachDebriefMoments.length === 0
              ? html`<div class="text-xs text-slate-500 text-center py-2">
                  No debrief moments available.
                </div>`
              : html`
                  <div class="space-y-2">
                    ${this.coachDebriefMoments.map(
                      (m) => html`
                        <div
                          class="rounded border border-indigo-400/30 bg-indigo-900/15 p-2"
                        >
                          <div
                            class="text-xs uppercase tracking-wide text-indigo-300 mb-0.5"
                          >
                            ${m.decision}
                          </div>
                          <div class="text-sm text-slate-100">${m.optimal}</div>
                          ${
                            m.why
                              ? html`<div class="text-xs text-indigo-200 mt-1">
                                  Why: ${m.why}
                                </div>`
                              : ""
                          }
                        </div>
                      `,
                    )}
                  </div>
                `
        }
      </div>
    `;
  }

  private renderAITabSection() {
    const hasAI =
      this.matchRecap !== null ||
      this.fortuneItem !== null ||
      this.coachDebriefMoments !== null ||
      this.coachDebriefLoading;
    if (!hasAI && !this.isWin) return null;

    const tabs: Array<{ key: "recap" | "coach" | "fortune"; label: string }> = [
      { key: "recap", label: "📖 Story" },
      { key: "coach", label: "🎯 Coach" },
      { key: "fortune", label: "✦ Fortune" },
    ];

    return html`
      <div class="mt-3 border-t border-slate-600/30 pt-2">
        <div class="flex gap-1.5 mb-2">
          ${tabs.map(
            (t) => html`
              <button
                class="px-3 py-1 text-xs rounded cursor-pointer transition-colors border ${
                  this.activeTab === t.key
                    ? "bg-slate-600/50 border-slate-400/50 text-white"
                    : "bg-transparent border-slate-600/30 text-slate-400 hover:text-slate-200"
                }"
                @click=${() => {
                  this.activeTab = t.key;
                  this.requestUpdate();
                  if (t.key === "coach" && this.coachDebriefMoments === null) {
                    this._loadCoachDebrief();
                  }
                }}
              >
                ${t.label}
              </button>
            `,
          )}
        </div>
        ${this.activeTab === "recap" ? this.renderAIMatchStory() : ""}
        ${this.activeTab === "coach" ? this.renderCoachDebrief() : ""}
        ${this.activeTab === "fortune" ? this.renderFortuneCard() : ""}
      </div>
    `;
  }

  private renderEloSection() {
    if (!this.isRankedGame || !this.eloData) return null;
    const { previous, current, label, animated, tierChanged } = this.eloData;
    const delta = current - previous;
    const isGain = delta >= 0;
    const deltaText = isGain ? `+${delta}` : `${delta}`;
    const deltaColor = isGain ? "text-emerald-400" : "text-rose-400";
    return html`
      <div
        class="mt-2 rounded-sm border border-indigo-400/40 bg-indigo-900/20 p-3 flex items-center justify-between gap-2 ${
          tierChanged ? "animate-pulse" : ""
        }"
      >
        <div class="flex flex-col gap-0.5">
          <div class="text-xs uppercase tracking-wide text-indigo-300">
            Ranked ${label}
          </div>
          <div class="text-xl font-bold text-white tabular-nums">
            ${Math.round(animated)}
          </div>
        </div>
        <div
          class="text-sm font-bold ${deltaColor} tabular-nums ${
            tierChanged ? "text-base" : ""
          }"
        >
          ${deltaText}
          ${
            tierChanged
              ? html`<span class="text-amber-300 ml-1">Tier Up!</span>`
              : ""
          }
        </div>
      </div>
    `;
  }

  private renderPlayStyleCard() {
    if (!this.playStyleLabel || this.playStyleBars.length === 0) return null;
    return html`
      <div
        class="mt-2 rounded-sm border border-violet-400/40 bg-violet-900/20 p-2"
      >
        <div class="text-xs uppercase tracking-wide text-violet-200">
          Play Style: ${this.playStyleLabel}
        </div>
        <div class="mt-2 space-y-1">
          ${this.playStyleBars.map(
            (bar) => html`
              <div class="flex items-center gap-2">
                <div class="w-20 text-xs text-slate-300 shrink-0">
                  ${bar.label}
                </div>
                <div
                  class="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden"
                >
                  <div
                    class="${bar.color} h-full rounded-full transition-all"
                    style="width:${bar.pct}%"
                  ></div>
                </div>
                <div class="w-8 text-right text-xs text-slate-400">
                  ${bar.pct}%
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderDynastyStory() {
    if (!this.dynastyStory) return null;
    const shareText = `${this.dynastyStory.split(".")[0]}. #VaultFront`;
    return html`
      <div
        class="mt-2 rounded-sm border border-amber-400/40 bg-amber-900/15 p-3"
      >
        <div
          class="text-xs uppercase tracking-wide text-amber-300 mb-1 flex items-center justify-between"
        >
          <span>Clan Legacy</span>
          <button
            class="text-xs px-2 py-0.5 bg-amber-500/20 border border-amber-400/30 rounded text-amber-200 hover:bg-amber-500/40 transition-colors cursor-pointer"
            @click=${() => {
              void navigator.clipboard.writeText(shareText);
            }}
          >
            Share
          </button>
        </div>
        <div class="text-sm text-slate-200 leading-relaxed">
          ${this.dynastyStoryTyped}${
            this.dynastyStoryTyped.length < (this.dynastyStory?.length ?? 0)
              ? html`<span class="animate-pulse">▌</span>`
              : ""
          }
        </div>
      </div>
    `;
  }

  private renderSeasonalContracts() {
    if (this.seasonalContracts.length === 0) return null;

    return html`
      <div
        class="mt-2 rounded-sm border border-indigo-400/45 bg-indigo-900/20 p-2"
      >
        <div class="text-xs uppercase tracking-wide text-indigo-200 mb-1">
          Seasonal Skill Contracts
        </div>
        <div class="space-y-2">
          ${this.seasonalContracts.map((contract) => {
            const ratio = Math.max(
              0,
              Math.min(
                1,
                contract.target > 0 ? contract.progress / contract.target : 0,
              ),
            );
            return html`
              <div>
                <div class="text-sm text-white">${contract.title}</div>
                <div class="text-xs text-slate-200">
                  ${contract.description}
                </div>
                <div class="mt-1 h-1.5 rounded bg-white/20 overflow-hidden">
                  <div
                    class="h-full bg-indigo-300"
                    style="width: ${ratio * 100}%"
                  ></div>
                </div>
                <div class="text-[11px] text-indigo-100 mt-0.5">
                  ${contract.progress}/${contract.target}
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  private renderRivalChallenge() {
    if (this.rivalryRevengeDelta <= 0) return null;
    const objective =
      this.rivalryRevengeDelta === 1
        ? "Run it back and intercept that rival's first Vault Convoy."
        : "Press the rematch before the grudge cools and chain another counter-intercept.";
    return html`
      <div
        class="mt-2 rounded-sm border border-orange-400/50 bg-orange-950/35 p-2"
      >
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-xs uppercase tracking-wide text-orange-200">
              Rival Challenge
            </div>
            <div class="text-sm text-orange-50 mt-1">
              ${this.rivalryRevengeDelta} revenge
              ${this.rivalryRevengeDelta === 1 ? "counter" : "counters"} banked.
              ${objective}
            </div>
          </div>
          <div
            class="shrink-0 rounded border border-orange-300/35 bg-orange-500/20 px-2 py-1 text-center"
          >
            <div class="text-[10px] uppercase tracking-wide text-orange-200">
              Streak
            </div>
            <div class="text-lg font-bold text-orange-50">
              ${this.rivalryRevengeDelta}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderReplayMoments() {
    if (this.replayMoments.length === 0) return null;
    return html`
      <div class="mt-2 rounded-sm border border-cyan-400/45 bg-cyan-900/20 p-2">
        <div class="text-xs uppercase tracking-wide text-cyan-200 mb-1">
          Replay Moments
        </div>
        <div class="text-sm text-cyan-50 space-y-1">
          ${this.replayMoments.map(
            (moment) => html`
              <button
                class="w-full text-left rounded px-2 py-1 bg-cyan-500/15 hover:bg-cyan-500/25"
                @click=${() => this.jumpToReplayMoment(moment)}
                ?disabled=${moment.tile === null}
                title=${
                  moment.tile === null
                    ? "No map location available for this moment"
                    : "Jump camera to this replay moment"
                }
              >
                <span
                  class="inline-block mr-1 text-[10px] uppercase tracking-wide text-cyan-200"
                >
                  ${moment.scope}
                </span>
                ${moment.label}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  innerHtml() {
    if (isInIframe()) {
      return this.steamWishlist();
    }

    if (!this.isWin && getGamesPlayed() < 3) {
      return this.renderYoutubeTutorial();
    }
    if (this.rand < 0.25) {
      return this.steamWishlist();
    } else if (this.rand < 0.5) {
      return this.discordDisplay();
    } else {
      return this.renderPatternButton();
    }
  }

  renderYoutubeTutorial() {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.youtube_tutorial")}
        </h3>
        <!-- 56.25% = 9:16 -->
        <div class="relative w-full pb-[56.25%]">
          <iframe
            class="absolute top-0 left-0 w-full h-full rounded-sm"
            src="${this.isVisible ? TUTORIAL_VIDEO_URL : ""}"
            title="YouTube video player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    `;
  }

  renderPatternButton() {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.support_openfront")}
        </h3>
        <p class="text-white mb-3">
          ${translateText("win_modal.territory_pattern")}
        </p>
        <div class="flex justify-center">${this.patternContent}</div>
      </div>
    `;
  }

  async loadPatternContent() {
    const me = await getUserMe();
    const patterns = await fetchCosmetics();

    const purchasablePatterns: {
      pattern: Pattern;
      colorPalette: ColorPalette;
    }[] = [];

    for (const pattern of Object.values(patterns?.patterns ?? {})) {
      for (const colorPalette of pattern.colorPalettes ?? []) {
        if (
          patternRelationship(pattern, colorPalette, me, null) === "purchasable"
        ) {
          const palette = patterns?.colorPalettes?.[colorPalette.name];
          if (palette) {
            purchasablePatterns.push({
              pattern,
              colorPalette: palette,
            });
          }
        }
      }
    }

    if (purchasablePatterns.length === 0) {
      this.patternContent = html``;
      return;
    }

    // Shuffle the array and take patterns based on screen size
    const shuffled = [...purchasablePatterns].sort(() => Math.random() - 0.5);
    const maxPatterns = Platform.isMobileWidth ? 1 : 3;
    const selectedPatterns = shuffled.slice(
      0,
      Math.min(maxPatterns, shuffled.length),
    );

    this.patternContent = html`
      <div class="flex gap-4 flex-wrap justify-start">
        ${selectedPatterns.map(
          ({ pattern, colorPalette }) => html`
            <pattern-button
              .pattern=${pattern}
              .colorPalette=${colorPalette}
              .requiresPurchase=${true}
              .onSelect=${(p: Pattern | null) => {}}
              .onPurchase=${(p: Pattern, colorPalette: ColorPalette | null) =>
                handlePurchase(p, colorPalette)}
            ></pattern-button>
          `,
        )}
      </div>
    `;
  }

  steamWishlist(): TemplateResult {
    return html`<p class="m-0 mb-5 text-center bg-black/30 p-2.5 rounded-sm">
      <a
        href="https://store.steampowered.com/app/3560670"
        target="_blank"
        rel="noopener noreferrer"
        class="text-[#4a9eff] underline font-medium transition-colors duration-200 text-2xl hover:text-[#6db3ff]"
      >
        ${translateText("win_modal.wishlist")}
      </a>
    </p>`;
  }

  discordDisplay(): TemplateResult {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.join_discord")}
        </h3>
        <p class="text-white mb-3">
          ${translateText("win_modal.discord_description")}
        </p>
        <a
          href="https://discord.com/invite/openfront"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-block px-6 py-3 bg-indigo-600 text-white rounded-sm font-semibold transition-all duration-200 hover:bg-indigo-700 hover:-translate-y-px no-underline"
        >
          ${translateText("win_modal.join_server")}
        </a>
      </div>
    `;
  }

  /**
   * Call before show() to queue a first-unlock achievement spotlight.
   * The spotlight will be shown for 3s before the score reveal.
   */
  queueAchievementSpotlight(data: {
    name: string;
    description: string;
    iconEmoji?: string;
  }): void {
    this.spotlightAchievement = data;
  }

  async show() {
    crazyGamesSDK.gameplayStop();
    await this.loadPatternContent();
    await this.resolveRecapVariant();
    this.replayMoments = this.loadReplayMoments();
    // Check if this is a ranked game
    this.isRankedGame =
      this.game.config().gameConfig().rankedType === RankedType.OneVOne;

    // Achievement spotlight: pause 3s before main reveal if a new achievement unlocked
    if (this.spotlightAchievement) {
      this.showSpotlight = true;
      this.isVisible = true;
      this.requestUpdate();
      await new Promise<void>((res) => setTimeout(res, 3200));
      this.showSpotlight = false;
      this.spotlightAchievement = null;
      this.requestUpdate();
    }

    this.isVisible = true;
    this.requestUpdate();
    setTimeout(() => {
      this.showButtons = true;
      this.requestUpdate();
    }, 3000);
    setTimeout(() => {
      void this.postOutcomeTelemetry();
    }, 15000);

    // Fetch mutator vote candidates in background
    void fetchMutatorVoteStatus().then((status) => {
      if (status?.open && status.candidates.length > 0) {
        this.mutatorVoteCandidates = status.candidates;
        this.requestUpdate();
      }
    });

    // Fetch replay highlight in background
    const gameId = this.game?.gameID();
    if (gameId) {
      void requestReplayHighlight(gameId).then((h) => {
        if (h) {
          this.replayHighlight = h;
          this.requestUpdate();
          // Wire autoHighlightTick into ReplayPanel for "Best Moment" button
          if (h.autoHighlightTick !== undefined) {
            const panel = document.querySelector("replay-panel") as
              | (HTMLElement & {
                  autoHighlightTick?: number | null;
                  highlightShareUrl?: string;
                })
              | null;
            if (panel) {
              panel.autoHighlightTick = h.autoHighlightTick;
              panel.highlightShareUrl = h.shareUrl;
            }
          }
        }
      });
    }

    // Fetch dynasty story if player belongs to a clan
    void getUserMe().then(async (me) => {
      const clanId =
        me &&
        typeof me === "object" &&
        "user" in me &&
        me.user &&
        typeof me.user === "object" &&
        "clanId" in me.user
          ? (me.user as { clanId?: string }).clanId
          : undefined;
      if (!clanId) return;
      const story = await fetchDynastyStory(clanId);
      if (!story) return;
      this.dynastyStory = story;
      this.dynastyStoryTyped = "";
      this.requestUpdate();
      // Typewriter effect: 10ms per char
      let i = 0;
      const type = () => {
        if (i >= story.length) return;
        this.dynastyStoryTyped = story.slice(0, ++i);
        this.requestUpdate();
        this.dynastyStoryTyperTimer = setTimeout(type, 10);
      };
      type();
    });

    // Non-ranked: trigger fortune + recap after short settle delay
    if (!this.isRankedGame) {
      setTimeout(() => {
        this._triggerFortuneAndRecap();
      }, 1200);
    }

    // Fetch Elo after short delay so the server has time to record match result
    if (this.isRankedGame) {
      setTimeout(() => {
        void fetchVaultFrontContracts().then((snapshot) => {
          if (!snapshot) return;
          const prevElo = parseInt(
            localStorage.getItem("vaultfront.lastElo") ?? "1200",
            10,
          );
          const current = snapshot.eloRating;
          const tierChanged =
            Math.floor(prevElo / 200) !== Math.floor(current / 200);
          const start = prevElo;
          const end = current;
          this.eloData = {
            previous: prevElo,
            current,
            label: snapshot.eloLabel,
            animated: start,
            tierChanged,
          };
          this.requestUpdate();
          localStorage.setItem("vaultfront.lastElo", String(current));

          // Animate the counter from previous to current
          const duration = 1200;
          const startTime = performance.now();
          const step = (now: number) => {
            const t = Math.min((now - startTime) / duration, 1);
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            this.eloData = {
              ...this.eloData!,
              animated: start + (end - start) * eased,
            };
            this.requestUpdate();
            if (t < 1) {
              requestAnimationFrame(step);
            } else {
              // Elo animation complete — trigger fortune draw
              this._triggerFortuneAndRecap();
            }
          };
          requestAnimationFrame(step);
        });
      }, 3000);
    }
  }

  hide() {
    void this.postOutcomeTelemetry();
    this.isVisible = false;
    this.showButtons = false;
    this.mutatorVoteCandidates = [];
    this.mutatorVoteSentKey = null;
    this.dynastyStory = null;
    this.dynastyStoryTyped = "";
    if (this.dynastyStoryTyperTimer !== null) {
      clearTimeout(this.dynastyStoryTyperTimer);
      this.dynastyStoryTyperTimer = null;
    }
    this.eloData = null;
    this.requestUpdate();
  }

  private saveNextMatchGoal = () => {
    if (!this.actionableHint) return;
    persistConvoyMastery({
      text: this.actionableHint,
      goalKey: this.actionableGoalKey as MasteryGoalKey,
      source: "recap",
      evidence: "Selected from your weakest certified match dimension",
      selectedAt: Date.now(),
    });
    this.nextGoalSaved = true;
    this.recapGoalClicked = true;
    this.recordRivalChallengePulse("rival_goal_saved");
    void recordVaultFrontRecapEvent({
      event: "recap_goal_saved",
      variant: this.recapCtaVariant,
      value: 1,
    });
    void this.postOutcomeTelemetry();
  };

  private _handleExit() {
    void this.postOutcomeTelemetry();
    this.hide();
    window.location.href = appRootPath();
  }

  private _handleRequeue() {
    this.recapRequeueClicked = true;
    this.recordRivalChallengePulse("rival_requeue_clicked");
    void recordVaultFrontRecapEvent({
      event: "recap_requeue_click",
      variant: this.recapCtaVariant,
      value: 1,
    });
    void this.postOutcomeTelemetry();
    this.hide();
    // Navigate to homepage and open matchmaking modal
    window.location.href = appRelativePath("?requeue");
  }

  private _triggerFortuneAndRecap(): void {
    const gameId = this.game?.gameID();
    if (!gameId) return;

    void getUserMe().then((me) => {
      const persistentId =
        me && typeof me === "object" && "player" in me
          ? ((me as { player?: { publicId?: string } }).player?.publicId ?? "")
          : "";

      void fetchWinFortune(persistentId, gameId).then((result) => {
        if (result) {
          this.fortuneItem = result.item;
          this.requestUpdate();
        }
      });

      void fetchMatchRecap(
        gameId,
        "unknown",
        "intercept,convoy,surge",
        this.matchLengthSeconds,
      ).then((recap) => {
        if (recap) {
          this.matchRecap = recap;
          this.requestUpdate();
        }
      });
    });
  }

  private _loadCoachDebrief(): void {
    if (this.coachDebriefMoments !== null || this.coachDebriefLoading) return;
    const gameId = this.game?.gameID();
    if (!gameId) return;
    this.coachDebriefLoading = true;
    void getUserMe().then(async (me) => {
      const persistentId =
        me && typeof me === "object" && "player" in me
          ? ((me as { player?: { publicId?: string } }).player?.publicId ?? "")
          : "";
      const moments = await fetchCoachDebrief({
        persistentId,
        gameId,
        matchStats: {
          won: this.isWin,
          style: this.playStyleLabel ?? "Balanced",
        },
      });
      this.coachDebriefMoments = moments ?? [];
      this.coachDebriefLoading = false;
      this.requestUpdate();
    });
  }

  private _handleShare = async () => {
    const gameId = this.game?.gameID();
    if (!gameId) return;
    await shareMatchInvite(gameId);
    this.shareCopied = true;
    setTimeout(() => {
      this.shareCopied = false;
    }, 3000);
  };

  private _handleRematch = async () => {
    const gameId = this.game?.gameID();
    if (!gameId || this.rematchPending) return;
    if (this.rematchResult) {
      window.location.href = this.rematchResult.joinUrl;
      return;
    }

    this.rematchPending = true;
    this.rematchError = null;
    const result = await createRematch(gameId);
    this.rematchPending = false;
    if (!result) {
      this.rematchError =
        "Rematch lobby could not be created. Your previous match is unchanged; retry when ready.";
      return;
    }

    this.rematchResult = result;
    this.recordRivalChallengePulse("rival_rematch_requested");
  };

  private _handleShareHighlight = async () => {
    const gameId = this.game?.gameID();
    if (!gameId) return;
    await shareReplayHighlight(gameId);
    this.highlightCopied = true;
    setTimeout(() => {
      this.highlightCopied = false;
    }, 3000);
  };

  private _handleShareCard = async () => {
    const isWin = this.isWin;
    const eloDelta = this.eloData
      ? this.eloData.current - this.eloData.previous
      : null;
    const eloLabel = this.eloData?.label ?? "";
    const topCard = this.recapCards[0];
    const topStat = topCard
      ? `${topCard.title}: ${topCard.myValue}`
      : "VaultFront match";

    try {
      const canvas = new OffscreenCanvas(480, 240);
      const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;

      // Background
      ctx.fillStyle = isWin ? "#1e3a2f" : "#2d1a1a";
      ctx.fillRect(0, 0, 480, 240);

      // Accent stripe
      ctx.fillStyle = isWin ? "#22c55e" : "#ef4444";
      ctx.fillRect(0, 0, 8, 240);

      // Outcome
      ctx.font = "bold 36px sans-serif";
      ctx.fillStyle = isWin ? "#4ade80" : "#f87171";
      ctx.fillText(isWin ? "VICTORY" : "DEFEAT", 28, 60);

      // Elo delta
      if (eloDelta !== null) {
        ctx.font = "bold 22px sans-serif";
        ctx.fillStyle = eloDelta >= 0 ? "#86efac" : "#fca5a5";
        ctx.fillText(
          `${eloDelta >= 0 ? "+" : ""}${eloDelta} Elo · ${eloLabel}`,
          28,
          96,
        );
      }

      // Top stat
      ctx.font = "16px sans-serif";
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(topStat, 28, 130);

      // Brand
      ctx.font = "bold 14px sans-serif";
      ctx.fillStyle = "#60a5fa";
      ctx.fillText("VaultFront", 28, 220);

      const blob = await canvas.convertToBlob({ type: "image/png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vaultfront-result.png";
      a.click();
      URL.revokeObjectURL(url);

      this.shareCardCopied = true;
      setTimeout(() => {
        this.shareCardCopied = false;
      }, 3000);
    } catch {
      // OffscreenCanvas not supported — silent fail
    }
  };

  private onRecapPrimaryRequeueClick = () => {
    this.recapRequeueClicked = true;
    void recordVaultFrontRecapEvent({
      event: "recap_primary_requeue_click",
      variant: this.recapCtaVariant,
      value: 1,
    });
    this._handleRequeue();
  };

  private recordRivalChallengePulse(
    event:
      | "rival_challenge_shown"
      | "rival_goal_saved"
      | "rival_requeue_clicked"
      | "rival_rematch_requested",
  ): void {
    if (this.rivalryRevengeDelta <= 0) return;
    void recordVaultFrontPlaytestPulse({
      surface: "retention",
      event,
      value: 1,
    });
  }

  init() {}

  tick() {
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this._title = translateText("win_modal.died");
      this.recapCards = [];
      this.recapReason = "";
      this.actionableHint = "";
      this.seasonalContracts = [];
      this.playStyleLabel = null;
      this.playStyleBars = [];
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // ...
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
          this.isWin = true;
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
          this.isWin = false;
        }
        this.recomputeRecap(wu);
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "nation") {
        this._title = translateText("win_modal.nation_won", {
          nation: wu.winner[1],
        });
        this.isWin = false;
        this.recomputeRecap(wu);
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
          this.isWin = true;
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.name(),
          });
          this.isWin = false;
        }
        this.recomputeRecap(wu);
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      }
    });
  }

  renderLayer(/* context: CanvasRenderingContext2D */) {}

  shouldTransform(): boolean {
    return false;
  }

  private async resolveRecapVariant(): Promise<void> {
    const assignment = await fetchVaultFrontRecapAssignment();
    if (assignment !== false) {
      this.recapCtaVariant = assignment.variant;
    } else {
      this.recapCtaVariant =
        Math.random() < 0.5 ? "goal_focus" : "requeue_focus";
    }
    if (!this.recapExposureTracked) {
      this.recapExposureTracked = true;
      void recordVaultFrontRecapEvent({
        event: `recap_exposure_${this.recapCtaVariant}`,
        variant: this.recapCtaVariant,
        value: 1,
      });
    }
  }

  private hudCountersForCurrentMatch(): {
    vaultNoticeJumps: number;
    objectiveRailClicks: number;
    timelineJumps: number;
  } {
    const startAt =
      Date.now() - Math.max(60_000, this.matchLengthSeconds * 1000);
    const streamRaw = sessionStorage.getItem("vaultfront.hud.telemetry.stream");
    if (!streamRaw) {
      return {
        vaultNoticeJumps: 0,
        objectiveRailClicks: 0,
        timelineJumps: 0,
      };
    }
    try {
      const events = JSON.parse(streamRaw) as Array<{
        at: number;
        action: string;
      }>;
      return events.reduce(
        (acc, item) => {
          if ((item.at ?? 0) < startAt) return acc;
          if (item.action === "hud_vault_notice_jump") {
            acc.vaultNoticeJumps += 1;
          } else if (item.action === "hud_objective_rail_click") {
            acc.objectiveRailClicks += 1;
          } else if (item.action === "hud_timeline_jump") {
            acc.timelineJumps += 1;
          }
          return acc;
        },
        {
          vaultNoticeJumps: 0,
          objectiveRailClicks: 0,
          timelineJumps: 0,
        },
      );
    } catch {
      return {
        vaultNoticeJumps: 0,
        objectiveRailClicks: 0,
        timelineJumps: 0,
      };
    }
  }

  private async postOutcomeTelemetry(): Promise<void> {
    if (this.outcomePosted || this.matchLengthSeconds <= 0) return;
    const gameId = this.game?.gameID();
    if (!gameId) return;
    const ok = await recordVaultFrontOutcomeTelemetry({
      gameId,
      recapCtaVariant: this.recapCtaVariant,
      recapCtaClicked: this.recapGoalClicked || this.recapRequeueClicked,
      requeueClicked: this.recapRequeueClicked,
      hud: this.hudCountersForCurrentMatch(),
    });
    if (ok) {
      this.outcomePosted = true;
    }
  }

  private toBigInt(v: unknown): bigint {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.floor(v));
    if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
    return 0n;
  }

  private fmt(value: bigint | number): string {
    const asNumber = typeof value === "bigint" ? Number(value) : value;
    return Number.isFinite(asNumber) ? asNumber.toLocaleString() : "0";
  }

  private winnerClientIDs(winner: Winner | undefined): string[] {
    if (!winner) return [];
    if (winner[0] === "player") return [winner[1]];
    if (winner[0] === "team") {
      return winner.slice(2) as string[];
    }
    return [];
  }

  private sumVaultMetric(
    stats: AllPlayersStats,
    clientIDs: string[],
    key: string,
  ): bigint {
    return clientIDs.reduce((acc, id) => {
      const raw = (
        stats[id]?.vaultfront as Record<string, unknown> | undefined
      )?.[key];
      return acc + this.toBigInt(raw);
    }, 0n);
  }

  private focusDiscipline(changes: bigint, samples: bigint): number {
    const s = Number(samples);
    if (!Number.isFinite(s) || s <= 0) return 0;
    const c = Number(changes);
    const instability = (c * 1000) / s;
    return Math.max(0, Math.round(100 - Math.min(95, instability)));
  }

  private computeMomentRewards(
    myStats: AllPlayersStats[string] | undefined,
  ): string[] {
    const intercepts = Number(
      this.toBigInt(myStats?.vaultfront?.vaultConvoysIntercepted),
    );
    const delivered = Number(
      this.toBigInt(myStats?.vaultfront?.vaultConvoysDelivered),
    );
    const lost = Number(this.toBigInt(myStats?.vaultfront?.vaultConvoysLost));
    const pulses = Number(
      this.toBigInt(myStats?.vaultfront?.defenseFactoryPulseUptimeTicks),
    );
    const captures = Number(this.toBigInt(myStats?.vaultfront?.vaultCaptures));
    const cleanChains = Number(
      this.toBigInt(myStats?.vaultfront?.cleanExecutionStreaks),
    );
    const squadCompletions = Number(
      this.toBigInt(myStats?.vaultfront?.squadObjectiveCompletions),
    );
    const rewards: string[] = [];
    if (this.behindAtMinute8 && intercepts >= 1) {
      rewards.push("Clutch Intercept");
    }
    if (intercepts >= 3 || (intercepts >= 2 && captures >= 2)) {
      rewards.push("Deny Streak");
    }
    if (delivered >= 2 && lost === 0) {
      rewards.push("Convoy Guardian");
    }
    if (pulses >= 240) {
      rewards.push("Pulse Controller");
    }
    if (cleanChains > 0) {
      rewards.push("Clean Chain");
    }
    if (squadCompletions > 0) {
      rewards.push("Squad Sync");
    }
    return rewards.slice(0, 3);
  }

  private updateAdaptiveNudgeSignal(
    goalKey:
      "vault_first" | "convoy_impact" | "pulse_chain" | "focus_stable" | "",
    weak: boolean,
  ): void {
    if (!goalKey) return;
    const key = `vaultfront.nudge.fail.${goalKey}`;
    const current = Number(localStorage.getItem(key) ?? "0");
    const next = weak ? current + 1 : Math.max(0, current - 1);
    localStorage.setItem(key, String(next));
    if (next >= 2) {
      localStorage.setItem("vaultfront.adaptiveNudgeKey", goalKey);
    }
  }

  private buildActionPlan(weakness: RecapCard): string[] {
    const hud = this.hudCountersForCurrentMatch();
    const steps =
      weakness.key === "vault"
        ? [
            "Path to the nearest contestable vault before 2:30 instead of waiting for passive income.",
            "Hold the first capture through one passive payout before rotating out.",
          ]
        : weakness.key === "convoy"
          ? [
              "Use Shield on first contact for your next convoy instead of saving it for later.",
              "If you have no convoy, move to the shortest enemy route and play for one intercept.",
            ]
          : weakness.key === "pulse"
            ? [
                "Place a Defense Factory before the first major convoy race.",
                "Save Jam Breaker for a live enemy pulse, then chain your own pulse window behind it.",
              ]
            : [
                "Lock one Resource Focus setting per phase instead of flipping during every fight.",
                "Only change focus after a vault payout, clean disengage, or clear macro reset.",
              ];

    if (hud.vaultNoticeJumps + hud.objectiveRailClicks === 0) {
      steps.unshift(
        "Use the Vault notice or objective rail once early to snap the camera to the first swing objective.",
      );
    }
    if (this.behindAtMinute8) {
      const recoveryStep =
        "If you fall behind again, intercept once before forcing another straight capture race.";
      if (steps.length >= 3) {
        steps[steps.length - 1] = recoveryStep;
      } else {
        steps.push(recoveryStep);
      }
    }
    return steps.slice(0, 3);
  }

  private recomputeRecap(wu: WinUpdate) {
    const myClientID = this.game.myPlayer()?.clientID();
    if (!myClientID) {
      this.recapCards = [];
      this.actionableHint = "";
      this.recapActionPlan = [];
      this.recapReason = "";
      this.momentRewards = [];
      this.seasonalContracts = [];
      this.rivalryRevengeDelta = 0;
      this.matchLengthSeconds = 0;
      this.playStyleLabel = null;
      this.playStyleBars = [];
      return;
    }

    this.recapExposureTracked = false;
    this.recapGoalClicked = false;
    this.recapRequeueClicked = false;
    this.rivalChallengeExposureTracked = false;
    this.outcomePosted = false;

    const allStats = wu.allPlayersStats;
    const winnerIDs = this.winnerClientIDs(wu.winner);
    const benchmarkIDs =
      winnerIDs.length > 0
        ? winnerIDs
        : Object.keys(allStats).filter((k) => k !== myClientID);
    const myStats = allStats[myClientID];
    this.behindAtMinute8 =
      Number(this.toBigInt(myStats?.vaultfront?.minute8Behind)) > 0;
    this.matchLengthSeconds = Math.max(
      0,
      Math.floor(
        (this.game.ticks() - this.game.config().numSpawnPhaseTurns()) / 10,
      ),
    );
    if (!this.kpiRecorded) {
      this.recordKpis(myStats);
      this.kpiRecorded = true;
      sessionStorage.setItem("vaultfront.matchEndedAt", String(Date.now()));
    }

    const myVaultCaptures = this.toBigInt(myStats?.vaultfront?.vaultCaptures);
    const winnerVaultCaptures = this.sumVaultMetric(
      allStats,
      benchmarkIDs,
      "vaultCaptures",
    );

    const myConvoyImpact =
      this.toBigInt(myStats?.vaultfront?.vaultConvoysDelivered) +
      this.toBigInt(myStats?.vaultfront?.vaultConvoysIntercepted) -
      this.toBigInt(myStats?.vaultfront?.vaultConvoysLost);
    const winnerConvoyImpact =
      this.sumVaultMetric(allStats, benchmarkIDs, "vaultConvoysDelivered") +
      this.sumVaultMetric(allStats, benchmarkIDs, "vaultConvoysIntercepted") -
      this.sumVaultMetric(allStats, benchmarkIDs, "vaultConvoysLost");

    const myPulseTicks = this.toBigInt(
      myStats?.vaultfront?.defenseFactoryPulseUptimeTicks,
    );
    const winnerPulseTicks = this.sumVaultMetric(
      allStats,
      benchmarkIDs,
      "defenseFactoryPulseUptimeTicks",
    );

    const myFocusChanges = this.toBigInt(myStats?.vaultfront?.focusChanges);
    const myFocusSamples = this.toBigInt(myStats?.vaultfront?.focusSamples);
    const winnerFocusChanges = this.sumVaultMetric(
      allStats,
      benchmarkIDs,
      "focusChanges",
    );
    const winnerFocusSamples = this.sumVaultMetric(
      allStats,
      benchmarkIDs,
      "focusSamples",
    );
    const myDiscipline = this.focusDiscipline(myFocusChanges, myFocusSamples);
    const winnerDiscipline = this.focusDiscipline(
      winnerFocusChanges,
      winnerFocusSamples,
    );

    const cards: RecapCard[] = [
      this.buildCard(
        "vault",
        "Vault Control",
        myVaultCaptures,
        winnerVaultCaptures,
      ),
      this.buildCard(
        "convoy",
        "Vault Convoy Impact",
        myConvoyImpact,
        winnerConvoyImpact,
      ),
      this.buildCard(
        "pulse",
        "Pulse Uptime",
        myPulseTicks / 10n,
        winnerPulseTicks / 10n,
        "s",
      ),
      this.buildCard(
        "focus",
        "Focus Discipline",
        BigInt(myDiscipline),
        BigInt(winnerDiscipline),
        "%",
      ),
    ];
    this.recapCards = cards;

    const weakness = [...cards].sort((a, b) => a.ratio - b.ratio)[0];
    this.actionableHint =
      weakness.key === "vault"
        ? "Secure one vault before minute 4 and hold it for at least one passive payout."
        : weakness.key === "convoy"
          ? "Shield your next Vault Convoy through friendly lanes or intercept one enemy Vault Convoy."
          : weakness.key === "pulse"
            ? "Build a Defense Factory earlier and aim to chain two pulse windows."
            : "Set Resource Focus once per phase and avoid rapid slider flips.";
    this.actionableGoalKey =
      weakness.key === "vault"
        ? "vault_first"
        : weakness.key === "convoy"
          ? "convoy_impact"
          : weakness.key === "pulse"
            ? "pulse_chain"
            : "focus_stable";
    this.nextGoalSaved = false;
    this.momentRewards = this.computeMomentRewards(myStats);
    this.updateAdaptiveNudgeSignal(
      this.actionableGoalKey,
      weakness.ratio < 0.95,
    );

    const strengths = cards
      .filter((card) => card.positive)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 2)
      .map((c) => c.title.toLowerCase());
    const gaps = cards
      .filter((card) => !card.positive)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 2)
      .map((c) => c.title.toLowerCase());
    this.recapReason =
      this.isWin && strengths.length > 0
        ? `Win reason: edge in ${strengths.join(" and ")}.`
        : !this.isWin && gaps.length > 0
          ? `Loss reason: deficits in ${gaps.join(" and ")}.`
          : "Result was close on the tracked objective metrics.";

    this.rivalryRevengeDelta = Math.max(
      0,
      Number(localStorage.getItem("vaultfront.rivalryRevengeCount") ?? "0"),
    );
    localStorage.removeItem("vaultfront.rivalryRevengeCount");
    if (this.rivalryRevengeDelta > 0 && !this.rivalChallengeExposureTracked) {
      this.rivalChallengeExposureTracked = true;
      this.recordRivalChallengePulse("rival_challenge_shown");
    }
    setTimeout(() => void this.refreshCertifiedSeasonalContracts(), 750);

    this.computePlayStyle(myStats);
  }

  private computePlayStyle(
    myStats:
      import("../../../core/Schemas").AllPlayersStats[string] | undefined,
  ) {
    const vf = myStats?.vaultfront;
    const n = (v: bigint | undefined) =>
      v === null || v === undefined ? 0 : Number(v);

    const conquestCount = myStats?.conquests ? myStats.conquests.length : 0;
    const aggression = n(vf?.vaultCaptures) + conquestCount;
    const economy = n(vf?.vaultConvoysDelivered) + n(vf?.vaultPassivePayouts);
    const deception =
      n(vf?.cleanExecutionStreaks) +
      n(myStats?.betrayals) +
      n(vf?.jamBreakerUses);
    const resilience =
      n(vf?.defenseFactoryPulseUptimeTicks) / 600 + n(vf?.convoyEscortCommands);

    const total = Math.max(1, aggression + economy + deception + resilience);
    const a = aggression / total;
    const e = economy / total;
    const d = deception / total;
    const r = resilience / total;

    const label =
      a >= 0.4
        ? "Iron Fist"
        : e >= 0.4
          ? "Convoy Lord"
          : d >= 0.35
            ? "Shadow Broker"
            : r >= 0.35
              ? "Fortress"
              : "Balanced";

    this.playStyleLabel = label;
    this.playStyleBars = [
      { label: "Aggression", pct: Math.round(a * 100), color: "bg-rose-500" },
      { label: "Economy", pct: Math.round(e * 100), color: "bg-emerald-500" },
      {
        label: "Deception",
        pct: Math.round(d * 100),
        color: "bg-purple-500",
      },
      {
        label: "Resilience",
        pct: Math.round(r * 100),
        color: "bg-sky-500",
      },
    ];
  }

  private buildCard(
    key: RecapCard["key"],
    title: string,
    mine: bigint,
    winners: bigint,
    unit = "",
  ): RecapCard {
    const diff = mine - winners;
    const positive = diff >= 0n;
    const ratio =
      winners > 0n ? Number(mine) / Number(winners) : mine > 0n ? 1 : 0;
    const delta = positive ? `+${this.fmt(diff)}` : this.fmt(diff);
    return {
      key,
      title,
      myValue: `${this.fmt(mine)}${unit}`,
      winnerValue: `${this.fmt(winners)}${unit}`,
      deltaText: `Delta ${delta}${unit}`,
      positive,
      ratio,
    };
  }

  private async refreshCertifiedSeasonalContracts(): Promise<void> {
    const serverState = await fetchVaultFrontContracts();
    if (!serverState) return;
    this.seasonalContracts = this.contractCardsFromState(serverState);
    this.requestUpdate();
  }

  private contractCardsFromState(
    state: VaultFrontSeasonContractState,
  ): SeasonalContract[] {
    return [
      {
        title: "Interception Timing",
        description: "Intercept Vault Convoys at vulnerable route windows.",
        progress: state.interceptionTiming,
        target: 12,
      },
      {
        title: "Objective Denial",
        description:
          "Deny enemy objectives through vault captures + interceptions.",
        progress: state.objectiveDenial,
        target: 20,
      },
      {
        title: "Comeback Execution",
        description: "Lose a convoy, then deliver one in the same match.",
        progress: state.comebackExecution,
        target: 6,
      },
      {
        title: "Surge Execution",
        description: "Activate Surge from certified match outcomes.",
        progress: state.surgeExecution,
        target: 8,
      },
    ];
  }

  private jumpToReplayMoment(moment: ReplayMoment): void {
    if (moment.tile === null) return;
    this.eventBus.emit(
      new GoToPositionEvent(this.game.x(moment.tile), this.game.y(moment.tile)),
    );
    this.hide();
  }

  private loadReplayMoments(): ReplayMoment[] {
    const key = "vaultfront.matchTimeline";
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    let events: Array<{
      tick: number;
      activity: string;
      tile?: number;
      label: string;
      sourcePlayerID?: number | null;
      targetPlayerID?: number | null;
    }> = [];
    try {
      events = JSON.parse(raw) as Array<{
        tick: number;
        activity: string;
        tile?: number;
        label: string;
        sourcePlayerID?: number | null;
        targetPlayerID?: number | null;
      }>;
    } catch {
      return [];
    }

    const importantOrder: Record<string, number> = {
      comeback_surge: 5,
      convoy_intercepted: 4,
      vault_captured: 3,
      jam_breaker: 3,
      convoy_rerouted: 2,
      convoy_delivered: 2,
      beacon_pulse: 2,
    };

    const me = this.game.myPlayer();
    const myID = me?.smallID();
    const isFriendly = (id: number | null | undefined): boolean => {
      if (id === undefined || id === null || !me) return false;
      const player = this.game.playerBySmallID(id);
      if (!player || !player.isPlayer()) return false;
      return player.smallID() === me.smallID() || me.isFriendly(player);
    };

    const ranked = [...events]
      .filter((e) => importantOrder[e.activity] !== undefined)
      .sort((a, b) => {
        const scoreA = importantOrder[a.activity] ?? 0;
        const scoreB = importantOrder[b.activity] ?? 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b.tick - a.tick;
      })
      .map((e) => {
        let scope: ReplayMoment["scope"] = "global";
        if (
          myID !== undefined &&
          (e.sourcePlayerID === myID || e.targetPlayerID === myID)
        ) {
          scope = "personal";
        } else if (
          isFriendly(e.sourcePlayerID) ||
          isFriendly(e.targetPlayerID)
        ) {
          scope = "team";
        }
        const seconds = Math.max(
          0,
          Math.floor((e.tick - this.game.config().numSpawnPhaseTurns()) / 10),
        );
        const mm = Math.floor(seconds / 60)
          .toString()
          .padStart(2, "0");
        const ss = (seconds % 60).toString().padStart(2, "0");
        return {
          id: `${e.tick}-${e.activity}-${e.label}`,
          label: `[${mm}:${ss}] ${e.label}`,
          tile: e.tile ?? null,
          scope,
          tick: e.tick,
          score: importantOrder[e.activity] ?? 0,
        };
      });

    const personal = ranked
      .filter((m) => m.scope === "personal")
      .sort((a, b) => b.score - a.score || b.tick - a.tick)
      .slice(0, 2);
    const team = ranked
      .filter((m) => m.scope === "team")
      .sort((a, b) => b.score - a.score || b.tick - a.tick)
      .slice(0, 2);
    const global = ranked
      .filter((m) => m.scope === "global")
      .sort((a, b) => b.score - a.score || b.tick - a.tick)
      .slice(0, 1);

    const combined = [...personal, ...team, ...global]
      .filter(
        (value, index, arr) =>
          arr.findIndex((m) => m.id === value.id) === index,
      )
      .sort((a, b) => a.tick - b.tick)
      .slice(0, 5)
      .map((m) => ({
        id: m.id,
        label: m.label,
        tile: m.tile,
        scope: m.scope,
      }));

    return combined;
  }

  private addKpiCounter(key: string, delta: number) {
    const prev = Number(localStorage.getItem(key) ?? "0");
    localStorage.setItem(key, String(prev + delta));
  }

  private recordKpis(myStats: AllPlayersStats[string] | undefined) {
    const vf = myStats?.vaultfront as Record<string, unknown> | undefined;
    const mySmallID = this.game.myPlayer()?.smallID();
    this.addKpiCounter("vaultfront.kpi.matches", 1);
    this.addKpiCounter(
      "vaultfront.kpi.vaultInteractions",
      Number(this.toBigInt(vf?.vaultInteractions)),
    );
    this.addKpiCounter(
      "vaultfront.kpi.convoyIntercepts",
      Number(this.toBigInt(vf?.vaultConvoysIntercepted)),
    );
    const minute8Behind = Number(this.toBigInt(vf?.minute8Behind));
    if (minute8Behind > 0) {
      this.addKpiCounter("vaultfront.kpi.minute8BehindMatches", 1);
      if (this.isWin) {
        this.addKpiCounter("vaultfront.kpi.comebackWinsFromBehind", 1);
      }
    }

    if (mySmallID !== undefined) {
      const raw = sessionStorage.getItem("vaultfront.matchTimeline");
      if (raw) {
        try {
          const events = JSON.parse(raw) as Array<{
            tick: number;
            activity: string;
            sourcePlayerID: number | null;
            targetPlayerID: number | null;
          }>;
          const first = events
            .filter(
              (e) =>
                e.activity === "convoy_intercepted" &&
                (e.sourcePlayerID === mySmallID ||
                  e.targetPlayerID === mySmallID),
            )
            .sort((a, b) => a.tick - b.tick)[0];
          if (first) {
            const seconds = Math.max(
              0,
              Math.floor(
                (first.tick - this.game.config().numSpawnPhaseTurns()) / 10,
              ),
            );
            this.addKpiCounter("vaultfront.kpi.firstInterceptTimeSum", seconds);
            this.addKpiCounter("vaultfront.kpi.firstInterceptSamples", 1);
          }
        } catch {
          // ignore malformed timeline cache
        }
      }
    }
  }
}
