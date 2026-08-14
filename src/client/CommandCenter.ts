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
        class="h-full overflow-y-auto custom-scrollbar"
        aria-labelledby="command-center-title"
        data-vf-command-center
        style="background:radial-gradient(circle at top,color-mix(in srgb,var(--vf-warm) 12%,transparent),transparent 42%),linear-gradient(180deg,var(--vf-bg-deep),var(--vf-bg-mid));color:var(--vf-panel-text)"
      >
        <div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
          <header
            class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
              <p
                class="mb-2 text-xs font-bold uppercase tracking-[0.24em]"
                style="color:var(--vf-warm)"
              >
                Live progression surface
              </p>
              <h1
                id="command-center-title"
                class="text-3xl font-black tracking-tight sm:text-4xl"
              >
                Command Center
              </h1>
              <p
                class="mt-2 max-w-2xl text-sm leading-relaxed"
                style="color:var(--vf-panel-muted)"
              >
                One operational view for achievements, season momentum, clan
                coordination, and tournament play.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              ${
                this.persistentId
                  ? html`<span
                      class="rounded-full border px-3 py-1.5 text-xs font-semibold"
                      style="border-color:var(--vf-border-soft);background:color-mix(in srgb,var(--vf-accent) 12%,transparent);color:var(--vf-accent)"
                    >
                      Synced${
                        this.lastHydratedAt
                          ? ` · ${new Date(this.lastHydratedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                          : ""
                      }
                    </span>`
                  : html`<button
                      class="min-h-11 rounded-lg border px-4 py-2 text-sm font-bold transition"
                      style="border-color:var(--vf-border-strong);background:color-mix(in srgb,var(--vf-warm) 12%,transparent);color:var(--vf-warm)"
                      @click=${() => window.showPage?.("page-account")}
                    >
                      Sign in to synchronize
                    </button>`
              }
            </div>
          </header>

          <div class="mb-6 grid gap-3 sm:grid-cols-2">
            <button
              class="group rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              style="border-color:var(--vf-border-soft);background:color-mix(in srgb,var(--vf-accent) 10%,var(--vf-glass));color:var(--vf-panel-text)"
              ?disabled=${!this.persistentId}
              @click=${this.openClans}
            >
              <span
                class="text-xs font-bold uppercase tracking-widest"
                style="color:var(--vf-accent)"
                >Squad network</span
              >
              <span class="mt-2 block text-xl font-black">Open Clans</span>
              <span
                class="mt-1 block text-sm"
                style="color:var(--vf-panel-muted)"
                >Create, join, and compare coordinated crews.</span
              >
            </button>
            <button
              class="group rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              style="border-color:var(--vf-border-soft);background:color-mix(in srgb,var(--vf-warm) 10%,var(--vf-glass));color:var(--vf-panel-text)"
              ?disabled=${!this.persistentId}
              @click=${this.openTournaments}
            >
              <span
                class="text-xs font-bold uppercase tracking-widest"
                style="color:var(--vf-warm)"
                >Competitive operations</span
              >
              <span class="mt-2 block text-xl font-black"
                >Open Tournaments</span
              >
              <span
                class="mt-1 block text-sm"
                style="color:var(--vf-panel-muted)"
                >Register, seed, and follow the live bracket.</span
              >
            </button>
          </div>

          <div
            class="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]"
          >
            <article
              class="rounded-2xl border p-4 sm:p-6"
              style="border-color:var(--vf-border-soft);background:var(--vf-glass)"
            >
              <achievements-panel></achievements-panel>
            </article>
            <article
              class="rounded-2xl border p-4 sm:p-6"
              style="border-color:var(--vf-border-soft);background:var(--vf-glass)"
            >
              <season-pass-track></season-pass-track>
            </article>
            <article
              class="rounded-2xl border p-4 sm:p-6 xl:col-span-2"
              style="border-color:var(--vf-border-soft);background:var(--vf-glass)"
            >
              <fortune-collection-panel></fortune-collection-panel>
            </article>
          </div>

          <details
            class="mt-6 rounded-2xl border p-4"
            style="border-color:var(--vf-border-soft);background:color-mix(in srgb,var(--vf-glass) 86%,transparent)"
          >
            <summary
              class="cursor-pointer text-sm font-bold"
              style="color:var(--vf-panel-text)"
            >
              Feature liveness evidence
            </summary>
            <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              ${featureLivenessGraph
                .filter((node) => node.audience === "player")
                .map(
                  (node) =>
                    html`<div
                      class="rounded-lg border p-3"
                      style="border-color:var(--vf-border-soft);background:color-mix(in srgb,var(--vf-bg-mid) 65%,transparent)"
                    >
                      <div
                        class="text-sm font-bold"
                        style="color:var(--vf-panel-text)"
                      >
                        ${node.label}
                      </div>
                      <div
                        class="mt-1 text-xs leading-relaxed"
                        style="color:var(--vf-panel-muted)"
                      >
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
