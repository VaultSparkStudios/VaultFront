import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { UserMeResponse } from "../core/ApiSchemas";
import "./AbDashboard";
import "./AchievementToast";
import type {
  AchievementToast,
  AchievementToastData,
} from "./AchievementToast";
import "./AchievementsPanel";
import type { AchievementsPanel } from "./AchievementsPanel";
import { getUserMe } from "./Api";
import "./ClanModal";
import type { ClanModal } from "./ClanModal";
import { featureLivenessGraph } from "./FeatureLiveness";
import "./FortuneCollectionPanel";
import type { FortuneCollectionPanel } from "./FortuneCollectionPanel";
import "./SeasonPassTrack";
import type { SeasonPassTrack } from "./SeasonPassTrack";
import "./TournamentModal";
import type { TournamentModal } from "./TournamentModal";

@customElement("command-center")
export class CommandCenter extends LitElement {
  @state() private persistentId = "";
  @state() private loadingIdentity = false;
  @state() private lastHydratedAt: number | null = null;
  private hydrationEpoch = 0;

  private readonly onUserMe = (event: Event) => {
    const response = (event as CustomEvent<UserMeResponse | false>).detail;
    this.setIdentity(response || false);
  };

  private readonly onAchievementUnlocked = (event: Event) => {
    const detail = (event as CustomEvent<AchievementToastData>).detail;
    if (!detail?.name || !detail.description) return;
    document.querySelector<AchievementToast>("achievement-toast")?.show(detail);
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMe);
    document.addEventListener(
      "vaultfront-achievement-unlocked",
      this.onAchievementUnlocked,
    );
  }

  disconnectedCallback(): void {
    document.removeEventListener("userMeResponse", this.onUserMe);
    document.removeEventListener(
      "vaultfront-achievement-unlocked",
      this.onAchievementUnlocked,
    );
    super.disconnectedCallback();
  }

  async open(): Promise<void> {
    if (!this.persistentId && !this.loadingIdentity) {
      this.loadingIdentity = true;
      try {
        this.setIdentity(await getUserMe());
      } finally {
        this.loadingIdentity = false;
      }
    } else if (this.persistentId) {
      await this.hydratePlayerSurfaces(this.persistentId);
    }
  }

  close(): void {
    window.showPage?.("page-play");
  }

  private setIdentity(response: UserMeResponse | false): void {
    const nextId = response ? (response.player?.publicId ?? "") : "";
    this.persistentId = nextId;
    if (nextId) void this.hydratePlayerSurfaces(nextId);
  }

  private async hydratePlayerSurfaces(persistentId: string): Promise<void> {
    const epoch = ++this.hydrationEpoch;
    await this.updateComplete;
    const achievements =
      this.querySelector<AchievementsPanel>("achievements-panel");
    const season = this.querySelector<SeasonPassTrack>("season-pass-track");
    const fortune = this.querySelector<FortuneCollectionPanel>(
      "fortune-collection-panel",
    );
    await Promise.allSettled([
      achievements?.loadForPlayer(persistentId),
      season?.loadForPlayer(persistentId),
      fortune?.loadForPlayer(persistentId),
    ]);
    if (epoch === this.hydrationEpoch) {
      this.lastHydratedAt = Date.now();
    }
  }

  private openClans(): void {
    if (!this.persistentId) return;
    void this.querySelector<ClanModal>("clan-modal")?.open(this.persistentId);
  }

  private openTournaments(): void {
    if (!this.persistentId) return;
    void this.querySelector<TournamentModal>("tournament-modal")?.open(
      this.persistentId,
    );
  }

  render() {
    const hasOperatorToken = new URLSearchParams(window.location.search).has(
      "token",
    );
    return html`
      <section
        class="h-full overflow-y-auto custom-scrollbar bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_42%),linear-gradient(180deg,rgba(2,6,23,0.98),rgba(15,23,42,0.98))] text-white"
        aria-labelledby="command-center-title"
      >
        <div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
          <header
            class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
              <p
                class="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-amber-300"
              >
                Live progression surface
              </p>
              <h1
                id="command-center-title"
                class="text-3xl font-black tracking-tight sm:text-4xl"
              >
                Command Center
              </h1>
              <p class="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                One operational view for achievements, season momentum, clan
                coordination, and tournament play.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              ${
                this.persistentId
                  ? html`<span
                      class="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200"
                    >
                      Synced${
                        this.lastHydratedAt
                          ? ` · ${new Date(this.lastHydratedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                          : ""
                      }
                    </span>`
                  : html`<button
                      class="rounded-lg border border-amber-300/40 bg-amber-300/10 px-4 py-2 text-sm font-bold text-amber-200 transition hover:bg-amber-300/20"
                      @click=${() => window.showPage?.("page-account")}
                    >
                      Sign in to synchronize
                    </button>`
              }
            </div>
          </header>

          <div class="mb-6 grid gap-3 sm:grid-cols-2">
            <button
              class="group rounded-2xl border border-blue-400/25 bg-blue-400/10 p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-300/50 hover:bg-blue-400/15 disabled:cursor-not-allowed disabled:opacity-50"
              ?disabled=${!this.persistentId}
              @click=${this.openClans}
            >
              <span
                class="text-xs font-bold uppercase tracking-widest text-blue-300"
                >Squad network</span
              >
              <span class="mt-2 block text-xl font-black">Open Clans</span>
              <span class="mt-1 block text-sm text-slate-300"
                >Create, join, and compare coordinated crews.</span
              >
            </button>
            <button
              class="group rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 p-5 text-left transition hover:-translate-y-0.5 hover:border-fuchsia-300/50 hover:bg-fuchsia-400/15 disabled:cursor-not-allowed disabled:opacity-50"
              ?disabled=${!this.persistentId}
              @click=${this.openTournaments}
            >
              <span
                class="text-xs font-bold uppercase tracking-widest text-fuchsia-300"
                >Competitive operations</span
              >
              <span class="mt-2 block text-xl font-black"
                >Open Tournaments</span
              >
              <span class="mt-1 block text-sm text-slate-300"
                >Register, seed, and follow the live bracket.</span
              >
            </button>
          </div>

          <div
            class="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]"
          >
            <article
              class="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-6"
            >
              <achievements-panel></achievements-panel>
            </article>
            <article
              class="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-6"
            >
              <season-pass-track></season-pass-track>
            </article>
            <article
              class="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-6 xl:col-span-2"
            >
              <fortune-collection-panel></fortune-collection-panel>
            </article>
          </div>

          <details
            class="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
          >
            <summary class="cursor-pointer text-sm font-bold text-slate-200">
              Feature liveness evidence
            </summary>
            <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              ${featureLivenessGraph
                .filter((node) => node.audience === "player")
                .map(
                  (node) =>
                    html`<div
                      class="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <div class="text-sm font-bold text-white">
                        ${node.label}
                      </div>
                      <div class="mt-1 text-xs leading-relaxed text-slate-400">
                        ${node.journey}
                      </div>
                    </div>`,
                )}
            </div>
          </details>

          ${
            hasOperatorToken
              ? html`<section
                  class="mt-8"
                  aria-label="Operator experiment evidence"
                >
                  <ab-dashboard></ab-dashboard>
                </section>`
              : nothing
          }
        </div>
        <clan-modal></clan-modal>
        <tournament-modal></tournament-modal>
      </section>
    `;
  }
}
