import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { GameView } from "../../core/game/GameView";
import {
  claimSeasonMilestone,
  fetchAchievements,
  fetchDailyChallenge,
  fetchMatchProgressionDividend,
  fetchSeasonProgress,
  fetchVaultFrontContracts,
  type CertifiedProgressionDividend,
  type DailyChallenge,
} from "../Api";
import { getPersistentID } from "../Auth";
import {
  persistConvoyMastery,
  readConvoyMastery,
  selectConvoyMastery,
} from "../ConvoyMastery";
import type { Layer } from "../graphics/layers/Layer";

@customElement("progression-debrief")
export class ProgressionDebrief extends LitElement implements Layer {
  public game: GameView;

  @state() private visible = false;
  @state() private loading = false;
  @state() private eloText = "";
  @state() private milestoneText = "";
  @state() private achievementText = "";
  @state() private masteryText = "";
  @state() private masteryEvidence = "";
  @state() private certification: "pending" | "verified" | "degraded" =
    "pending";
  @state() private claimableMilestoneId: string | null = null;
  @state() private claimStatus = "";
  @state() private doctrineName = "";
  @state() private doctrineRole = "";
  @state() private doctrineBrief = "";
  @state() private doctrineId: DailyChallenge["doctrines"]["activeId"] = null;

  private requested = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveWait: (() => void) | null = null;
  private cancelled = false;
  private generation = 0;

  createRenderRoot() {
    return this;
  }

  bindGame(game: GameView): void {
    this.cancelPendingWork();
    this.generation += 1;
    this.game = game;
    this.cancelled = false;
    this.requested = false;
    this.visible = false;
    this.loading = false;
    this.eloText = "";
    this.milestoneText = "";
    this.achievementText = "";
    this.masteryText = "";
    this.masteryEvidence = "";
    this.certification = "pending";
    this.claimableMilestoneId = null;
    this.claimStatus = "";
    this.doctrineId = null;
    this.doctrineName = "";
    this.doctrineRole = "";
    this.doctrineBrief = "";
  }

  tick(): void {
    if (this.requested || !this.game) return;
    const wins = this.game.updatesSinceLastTick()?.[GameUpdateType.Win];
    if (!wins || wins.length === 0) return;
    this.requested = true;
    this.visible = true;
    this.loading = true;
    const gameId = this.game.gameID();
    const generation = this.generation;
    void this.pollProgressionDividend(gameId, generation);
  }
  private wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        this.refreshTimer = null;
        this.resolveWait = null;
        resolve();
      };
      this.resolveWait = finish;
      this.refreshTimer = setTimeout(finish, delayMs);
    });
  }

  private cancelPendingWork(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.resolveWait?.();
    this.resolveWait = null;
  }
  async pollProgressionDividend(
    gameId: string,
    generation = this.generation,
  ): Promise<void> {
    const delays = [0, 100, 200, 400, 800, 800];
    for (const delay of delays) {
      if (this.cancelled || generation !== this.generation) return;
      if (delay > 0) await this.wait(delay);
      if (this.cancelled || generation !== this.generation) return;
      const receipt = await fetchMatchProgressionDividend(gameId);
      if (this.cancelled || generation !== this.generation) return;
      if (receipt) {
        this.applyDividend(receipt);
        await this.refreshDoctrine(generation);
        return;
      }
    }
    if (this.cancelled || generation !== this.generation) return;
    this.certification = "degraded";
    await this.refreshProgression(generation);
  }
  private applyDividend(receipt: CertifiedProgressionDividend): void {
    const { dividend } = receipt;
    const eloDelta = dividend.delta.eloRating;
    const afterElo = dividend.after?.eloRating ?? dividend.before?.eloRating;
    this.eloText = `${eloDelta >= 0 ? "+" : ""}${eloDelta} rating${afterElo === undefined ? "" : ` · ${afterElo}`}`;
    const nextMilestone = dividend.seasonPass?.milestones
      .filter((entry) => !entry.claimed)
      .sort((a, b) => b.pct - a.pct)[0];
    if (nextMilestone) {
      this.milestoneText = `${nextMilestone.milestone.title} ${nextMilestone.progress}/${nextMilestone.target}`;
    }
    const claimable = dividend.seasonPass?.milestones.find(
      (entry) => entry.unlocked && !entry.claimed,
    );
    this.claimableMilestoneId = claimable?.milestone.id ?? null;
    this.achievementText = `+${dividend.achievementsUnlocked.length} achievements`;
    const pressureContribution = dividend.match.vaultPressureContributions;
    if (dividend.dailyMastery) {
      this.masteryText = `${dividend.dailyMastery.challengeId} ${dividend.dailyMastery.progress}/${dividend.dailyMastery.target}`;
      this.masteryEvidence = `Certified match dividend · ${receipt.durability} · ${receipt.receiptDigest.slice(0, 18)}…`;
    } else {
      this.masteryText = "Replay the decisive convoy pattern";
      this.masteryEvidence = `Certified match dividend · ${receipt.durability}`;
    }
    if (pressureContribution > 0) {
      this.masteryEvidence += ` · ${pressureContribution} team Pressure ${pressureContribution === 1 ? "delivery" : "deliveries"}`;
    }
    this.certification = "verified";
    this.loading = false;
  }

  private applyDoctrine(challenge: DailyChallenge | null): void {
    const active = challenge?.doctrines.catalog.find(
      (doctrine) => doctrine.id === challenge.doctrines.activeId,
    );
    this.doctrineId = active?.id ?? null;
    this.doctrineName = active?.name ?? "";
    this.doctrineRole = active?.role ?? "";
    this.doctrineBrief = active?.brief ?? "";
  }

  private async refreshDoctrine(generation: number): Promise<void> {
    const challenge = await fetchDailyChallenge();
    if (this.cancelled || generation !== this.generation) return;
    this.applyDoctrine(challenge);
  }

  async refreshProgression(generation = this.generation): Promise<void> {
    const persistentId = getPersistentID();
    const [contracts, season, achievements, challenge] = await Promise.all([
      fetchVaultFrontContracts(),
      fetchSeasonProgress(persistentId),
      fetchAchievements(persistentId),
      fetchDailyChallenge(),
    ]);
    if (this.cancelled || generation !== this.generation) return;

    if (contracts) {
      this.eloText =
        contracts.eloLabel +
        " " +
        contracts.eloRating +
        " · " +
        contracts.matchesPlayed +
        " matches";
    }
    const nextMilestone = season?.milestones
      .filter((entry) => !entry.claimed)
      .sort((a, b) => b.pct - a.pct)[0];
    if (nextMilestone) {
      this.milestoneText =
        nextMilestone.milestone.title +
        " " +
        nextMilestone.progress +
        "/" +
        nextMilestone.target;
    }
    const unlocked = achievements?.achievements.filter(
      (entry) => entry.unlockedAt !== null,
    ).length;
    if (unlocked !== undefined) {
      this.achievementText =
        unlocked + "/" + achievements!.achievements.length + " achievements";
    }
    const saved = readConvoyMastery();
    const mastery = selectConvoyMastery({
      savedGoal: saved ? { text: saved.text, goalKey: saved.goalKey } : null,
      milestones: season?.milestones,
      achievements: achievements?.achievements,
      contracts,
    });
    persistConvoyMastery(mastery);
    this.masteryText = mastery.text;
    this.masteryEvidence = mastery.evidence;
    this.applyDoctrine(challenge);
    this.loading = false;
  }
  private async claimReadyMilestone(): Promise<void> {
    if (!this.claimableMilestoneId) return;
    const claimed = await claimSeasonMilestone(
      getPersistentID(),
      this.claimableMilestoneId,
    );
    this.claimStatus = claimed ? "Reward claimed" : "Claim unavailable";
    if (claimed) this.claimableMilestoneId = null;
  }

  private requestMasteryRematch(): void {
    const saved = readConvoyMastery();
    const doctrine = this.doctrineId
      ? {
          id: this.doctrineId,
          name: this.doctrineName,
          role: this.doctrineRole,
          brief: this.doctrineBrief,
          effectPolicy: "coaching-and-identity-only" as const,
        }
      : null;
    persistConvoyMastery({
      text: this.masteryText,
      goalKey: saved?.goalKey ?? "",
      source: "recap",
      evidence: this.masteryEvidence,
      selectedAt: Date.now(),
      sourceGameId: this.game?.gameID(),
      doctrine,
    });
    this.dispatchEvent(
      new CustomEvent("vaultfront-mastery-rematch", {
        detail: {
          goal: this.masteryText,
          evidence: this.masteryEvidence,
          doctrine,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dismiss(): void {
    this.visible = false;
  }

  dispose(): void {
    this.cancelled = true;
    this.generation += 1;
    this.cancelPendingWork();
    this.visible = false;
    this.loading = false;
  }

  disconnectedCallback(): void {
    this.dispose();
    super.disconnectedCallback();
  }

  render() {
    if (!this.visible) return html``;
    return html`
      <aside
        class="fixed bottom-4 left-1/2 z-[9600] w-[min(92vw,420px)] -translate-x-1/2 rounded-lg border border-amber-300/45 bg-slate-950/95 p-3 text-slate-100 shadow-2xl"
        aria-label="Progression Debrief"
      >
        <div class="flex items-center justify-between gap-3">
          <div
            class="text-xs font-bold uppercase tracking-[0.14em] text-amber-300"
          >
            Progression Debrief
          </div>
          <div
            class="text-[10px] uppercase tracking-wide ${this.certification === "verified" ? "text-green-300" : this.certification === "degraded" ? "text-amber-300" : "text-slate-400"}"
          >
            ${this.certification}
          </div>
          <button
            class="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-white/10 hover:text-white"
            @click=${this.dismiss}
            aria-label="Dismiss progression debrief"
          >
            ✕
          </button>
        </div>
        ${
          this.loading
            ? html`<div class="mt-2 text-sm text-slate-300">
                Finalizing match rewards…
              </div>`
            : html`<div class="mt-2">
                <div
                  class="rounded border border-cyan-300/30 bg-cyan-950/25 p-2"
                >
                  <div
                    class="text-xs font-bold uppercase tracking-wide text-cyan-200"
                  >
                    Convoy Mastery
                  </div>
                  <div class="mt-1 text-sm font-semibold text-white">
                    ${this.masteryText}
                  </div>
                  <div class="mt-0.5 text-xs text-cyan-100/75">
                    ${this.masteryEvidence}
                  </div>
                </div>
                ${
                  this.doctrineId
                    ? html`<div
                        class="mt-2 rounded border border-emerald-300/30 bg-emerald-950/25 p-2"
                        data-doctrine-id=${this.doctrineId}
                      >
                        <div
                          class="text-[10px] font-bold uppercase tracking-wide text-emerald-200"
                        >
                          Active Doctrine · ${this.doctrineName}
                        </div>
                        <div class="mt-0.5 text-xs text-emerald-100">
                          ${this.doctrineRole} · ${this.doctrineBrief}
                        </div>
                        <div class="mt-0.5 text-[10px] text-slate-400">
                          Coaching identity only · never combat power
                        </div>
                      </div>`
                    : null
                }
                <div
                  class="mt-2 grid gap-1 text-xs text-slate-300 sm:grid-cols-3"
                >
                  <div>${this.eloText || "Rating unchanged"}</div>
                  <div>${this.milestoneText || "Season track ready"}</div>
                  <div>${this.achievementText || "Achievements ready"}</div>
                </div>
                <div class="mt-2 flex flex-wrap gap-2">
                  ${
                    this.claimableMilestoneId
                      ? html`<button
                          class="rounded border border-amber-300/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-300/10"
                          @click=${this.claimReadyMilestone}
                        >
                          Claim ready reward
                        </button>`
                      : html``
                  }
                  <button
                    class="rounded border border-cyan-300/40 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10"
                    @click=${this.requestMasteryRematch}
                  >
                    Rematch with this mastery goal
                  </button>
                  ${
                    this.claimStatus
                      ? html`<span class="self-center text-xs text-slate-300"
                          >${this.claimStatus}</span
                        >`
                      : html``
                  }
                </div>
              </div>`
        }
      </aside>
    `;
  }
}
