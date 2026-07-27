/**
 * TournamentModal — tournament browser, registration, and bracket viewer.
 *
 * Tabs:
 *   - Browse: list of open tournaments with register buttons
 *   - My Bracket: live bracket view for any tournament the player is in
 *   - Create: organizer form for creating a new tournament
 *
 * Usage:
 *   <tournament-modal></tournament-modal>
 *   document.querySelector('tournament-modal').open(persistentId, eloRating)
 */

import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getApiBase } from "./Api";
import { getAuthHeader, getPlayToken } from "./Auth";

interface Tournament {
  id: string;
  name: string;
  mapName: string;
  maxPlayers: number;
  status: string;
  createdBy: string;
  createdAt: number;
}

interface TournamentSlot {
  tournamentId: string;
  persistentId: string;
  seed: number;
  eloAtEntry: number;
}

interface TournamentMatch {
  id: number;
  tournamentId: string;
  round: number;
  matchIndex: number;
  playerA: string | null;
  playerB: string | null;
  winnerId: string | null;
  status: string;
}

interface BracketView {
  tournament: Tournament;
  rounds: TournamentMatch[][];
  slots: TournamentSlot[];
  operations?: {
    status: string;
    registeredPlayers: number;
    missingSlots: number;
    nextAction: string;
    nextMatchId: number | null;
    overlayUrl: string;
  };
}

type Tab = "browse" | "bracket" | "create";

@customElement("tournament-modal")
export class TournamentModal extends LitElement {
  @state() private isOpen = false;
  @state() private tab: Tab = "browse";
  @state() private persistentId = "";
  @state() private eloRating = 1200;
  @state() private tournaments: Tournament[] = [];
  @state() private activeBracket: BracketView | null = null;
  @state() private loading = false;
  @state() private error = "";
  @state() private successMsg = "";

  // Create form
  @state() private createName = "";
  @state() private createMap = "";
  @state() private createMax = 8;

  createRenderRoot() {
    return this;
  }

  async open(persistentId: string, eloRating = 1200): Promise<void> {
    this.persistentId = persistentId;
    this.eloRating = eloRating;
    this.isOpen = true;
    this.error = "";
    this.successMsg = "";
    await this.loadTournaments();
  }

  close(): void {
    this.isOpen = false;
  }

  private async loadTournaments(): Promise<void> {
    this.loading = true;
    try {
      const res = await fetch(`${getApiBase()}/api/tournaments`);
      if (res.ok) this.tournaments = (await res.json()) as Tournament[];
    } catch {
      this.tournaments = [];
    }
    this.loading = false;
  }

  private async loadBracket(tournamentId: string): Promise<void> {
    this.loading = true;
    try {
      const res = await fetch(
        `${getApiBase()}/api/tournaments/${encodeURIComponent(tournamentId)}/bracket`,
      );
      if (res.ok) this.activeBracket = (await res.json()) as BracketView;
    } catch {
      this.activeBracket = null;
    }
    this.loading = false;
  }

  private async register(tournamentId: string): Promise<void> {
    this.error = "";
    this.successMsg = "";
    try {
      const res = await fetch(
        `${getApiBase()}/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              (await getAuthHeader()) || `Bearer ${await getPlayToken()}`,
          },
          body: JSON.stringify({
            persistentId: this.persistentId,
            eloRating: this.eloRating,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        this.error =
          (data as { error: string }).error ?? "Registration failed.";
        return;
      }
      this.successMsg =
        "Registered! Check back when the organizer starts the bracket.";
      await this.loadTournaments();
    } catch {
      this.error = "Network error.";
    }
  }

  private async createTournament(): Promise<void> {
    this.error = "";
    if (!this.createName.trim()) {
      this.error = "Tournament name is required.";
      return;
    }
    try {
      const res = await fetch(`${getApiBase()}/api/tournaments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            (await getAuthHeader()) || `Bearer ${await getPlayToken()}`,
        },
        body: JSON.stringify({
          name: this.createName.trim(),
          mapName: this.createMap.trim(),
          maxPlayers: this.createMax,
          createdBy: this.persistentId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error =
          (data as { error: string }).error ?? "Failed to create tournament.";
        return;
      }
      this.successMsg = `Tournament "${(data as Tournament).name}" created!`;
      this.createName = "";
      this.createMap = "";
      this.createMax = 8;
      this.tab = "browse";
      await this.loadTournaments();
    } catch {
      this.error = "Network error.";
    }
  }

  private async seedTournament(tournamentId: string): Promise<void> {
    this.error = "";
    this.successMsg = "";
    try {
      const res = await fetch(
        `${getApiBase()}/api/tournaments/${encodeURIComponent(tournamentId)}/seed`,
        {
          method: "POST",
          headers: {
            Authorization:
              (await getAuthHeader()) || `Bearer ${await getPlayToken()}`,
          },
        },
      );
      const data = await res.json();
      if (!res.ok) {
        this.error = (data as { error: string }).error ?? "Seed failed.";
        return;
      }
      this.successMsg = "Bracket seeded. First-round matches are live.";
      await this.loadBracket(tournamentId);
    } catch {
      this.error = "Network error.";
    }
  }

  private async reportWinner(
    matchId: number,
    _winnerId: string,
  ): Promise<void> {
    const gameId = window.prompt("Archived certified game ID");
    if (!gameId?.trim()) return;
    this.error = "";
    this.successMsg = "";
    try {
      const res = await fetch(
        `${getApiBase()}/api/tournaments/matches/${matchId}/report`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              (await getAuthHeader()) || `Bearer ${await getPlayToken()}`,
          },
          body: JSON.stringify({ gameId: gameId.trim() }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        this.error =
          (data as { error: string }).error ?? "Could not report result.";
        return;
      }
      this.successMsg = "Result reported. Bracket advanced.";
      if (this.activeBracket)
        await this.loadBracket(this.activeBracket.tournament.id);
    } catch {
      this.error = "Network error.";
    }
  }

  render() {
    if (!this.isOpen) return nothing;

    return html`
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div
          class="bg-gray-900 text-white rounded-lg shadow-2xl w-full max-w-2xl mx-4 overflow-hidden"
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between px-5 py-4 border-b border-gray-700"
          >
            <h2 class="text-lg font-bold">Tournaments</h2>
            <button
              @click=${() => this.close()}
              class="text-gray-400 hover:text-white bg-transparent border-0 cursor-pointer text-xl leading-none"
            >
              ✕
            </button>
          </div>

          <!-- Tabs -->
          <div class="flex border-b border-gray-700">
            ${(["browse", "bracket", "create"] as Tab[]).map(
              (t) => html`
                <button
                  @click=${async () => {
                    this.tab = t;
                    if (t === "browse") await this.loadTournaments();
                  }}
                  class="flex-1 py-2 text-sm font-medium cursor-pointer border-0 ${
                    this.tab === t
                      ? "bg-blue-500/20 text-blue-400 border-b-2 border-blue-400"
                      : "bg-transparent text-gray-400 hover:text-white"
                  }"
                >
                  ${
                    t === "browse"
                      ? "Browse"
                      : t === "bracket"
                        ? "Bracket"
                        : "Create"
                  }
                </button>
              `,
            )}
          </div>

          <!-- Content -->
          <div class="p-5 max-h-[28rem] overflow-y-auto">
            ${
              this.error
                ? html`<p class="text-red-400 text-sm mb-3">${this.error}</p>`
                : nothing
            }
            ${
              this.successMsg
                ? html`<p class="text-green-400 text-sm mb-3">
                    ${this.successMsg}
                  </p>`
                : nothing
            }
            ${
              this.loading
                ? html`<p class="text-gray-400 text-center py-8">Loading…</p>`
                : this.tab === "browse"
                  ? this.renderBrowse()
                  : this.tab === "bracket"
                    ? this.renderBracket()
                    : this.renderCreate()
            }
          </div>
        </div>
      </div>
    `;
  }

  private renderBrowse() {
    if (!this.tournaments.length) {
      return html`<p class="text-gray-400 text-center py-8">
        No tournaments yet. Create one!
      </p>`;
    }
    return html`
      <div class="space-y-3">
        ${this.tournaments.map(
          (t) => html`
            <div
              class="bg-gray-800 rounded-lg p-4 flex items-center justify-between gap-4"
            >
              <div class="flex-1 min-w-0">
                <p class="font-semibold truncate">${t.name}</p>
                <p class="text-sm text-gray-400">
                  ${t.mapName || "Any map"} · Max ${t.maxPlayers} players
                </p>
                <span
                  class="inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${
                    t.status === "registration"
                      ? "bg-green-600/30 text-green-400"
                      : t.status === "active"
                        ? "bg-blue-600/30 text-blue-400"
                        : "bg-gray-600/30 text-gray-400"
                  }"
                >
                  ${t.status}
                </span>
              </div>
              <div class="flex flex-col gap-1 shrink-0">
                ${
                  t.status === "registration"
                    ? html`
                        <button
                          @click=${() => this.register(t.id)}
                          class="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer border-0"
                        >
                          Register
                        </button>
                      `
                    : nothing
                }
                <button
                  @click=${async () => {
                    this.tab = "bracket";
                    await this.loadBracket(t.id);
                  }}
                  class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded cursor-pointer border-0"
                >
                  Bracket
                </button>
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private renderBracket() {
    if (!this.activeBracket) {
      return html`
        <p class="text-gray-400 text-center py-8">
          Select a tournament from Browse to view its bracket.
        </p>
      `;
    }

    const { tournament, rounds, operations } = this.activeBracket;

    return html`
      <div>
        <h3 class="font-bold text-base mb-1">${tournament.name}</h3>
        <div class="flex items-start justify-between gap-3 mb-4">
          <p class="text-sm text-gray-400">
            ${tournament.mapName || "Any map"} · Status:
            <span
              class="${
                tournament.status === "active"
                  ? "text-blue-400"
                  : tournament.status === "complete"
                    ? "text-green-400"
                    : "text-gray-400"
              }"
              >${tournament.status}</span
            >
          </p>
          ${
            tournament.status === "registration"
              ? html`
                  <button
                    @click=${() => this.seedTournament(tournament.id)}
                    class="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer border-0 shrink-0"
                  >
                    Seed bracket
                  </button>
                `
              : nothing
          }
        </div>
        ${
          operations
            ? html`
                <div
                  class="mb-4 rounded bg-slate-950/60 border border-blue-500/30 p-3 text-xs text-slate-300"
                >
                  <div class="flex items-center justify-between gap-3 mb-2">
                    <span class="font-semibold text-blue-300"
                      >Operator brief</span
                    >
                    <span class="text-slate-400"
                      >${operations.registeredPlayers}/${tournament.maxPlayers}
                      players</span
                    >
                  </div>
                  <p class="text-slate-200 mb-2">${operations.nextAction}</p>
                  <div class="flex flex-wrap gap-2 text-[11px] text-slate-400">
                    <span>Missing slots: ${operations.missingSlots}</span>
                    <span
                      >Next match:
                      ${
                        operations.nextMatchId === null
                          ? "none"
                          : `#${operations.nextMatchId}`
                      }</span
                    >
                    <span>Overlay: ${operations.overlayUrl}</span>
                  </div>
                </div>
              `
            : nothing
        }
        <div class="flex gap-6 overflow-x-auto pb-2">
          ${rounds.map(
            (roundMatches, ri) => html`
              <div class="flex-shrink-0 min-w-36">
                <p
                  class="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide"
                >
                  ${
                    ri === rounds.length - 1 && rounds.length > 1
                      ? "Final"
                      : `Round ${ri + 1}`
                  }
                </p>
                <div class="space-y-3">
                  ${roundMatches.map(
                    (m) => html`
                      <div
                        class="bg-gray-800 rounded p-2 text-xs space-y-1 border ${
                          m.status === "complete"
                            ? "border-gray-600"
                            : "border-blue-500/30"
                        }"
                      >
                        <div
                          class="flex items-center justify-between gap-2 ${
                            m.winnerId === m.playerA
                              ? "text-white font-semibold"
                              : "text-gray-400"
                          }"
                        >
                          <span class="truncate max-w-20"
                            >${
                              m.playerA ? m.playerA.slice(0, 10) + "…" : "BYE"
                            }</span
                          >
                          ${
                            m.winnerId === m.playerA
                              ? html`<span class="text-green-400">W</span>`
                              : nothing
                          }
                          ${
                            this.canReportWinner(m, m.playerA)
                              ? html`
                                  <button
                                    @click=${() =>
                                      this.reportWinner(
                                        m.id,
                                        m.playerA as string,
                                      )}
                                    class="text-[10px] bg-green-700 hover:bg-green-600 text-white rounded px-1.5 py-0.5 border-0 cursor-pointer"
                                  >
                                    Win
                                  </button>
                                `
                              : nothing
                          }
                        </div>
                        <div class="border-t border-gray-700"></div>
                        <div
                          class="flex items-center justify-between gap-2 ${
                            m.winnerId === m.playerB
                              ? "text-white font-semibold"
                              : "text-gray-400"
                          }"
                        >
                          <span class="truncate max-w-20"
                            >${
                              m.playerB ? m.playerB.slice(0, 10) + "…" : "BYE"
                            }</span
                          >
                          ${
                            m.winnerId === m.playerB
                              ? html`<span class="text-green-400">W</span>`
                              : nothing
                          }
                          ${
                            this.canReportWinner(m, m.playerB)
                              ? html`
                                  <button
                                    @click=${() =>
                                      this.reportWinner(
                                        m.id,
                                        m.playerB as string,
                                      )}
                                    class="text-[10px] bg-green-700 hover:bg-green-600 text-white rounded px-1.5 py-0.5 border-0 cursor-pointer"
                                  >
                                    Win
                                  </button>
                                `
                              : nothing
                          }
                        </div>
                      </div>
                    `,
                  )}
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private canReportWinner(
    match: TournamentMatch,
    playerId: string | null,
  ): boolean {
    return Boolean(
      playerId &&
      match.status !== "complete" &&
      this.activeBracket?.tournament.status === "active",
    );
  }

  private renderCreate() {
    return html`
      <div class="space-y-4 max-w-sm">
        <h3 class="font-semibold text-sm text-gray-300">New Tournament</h3>
        <div class="space-y-2">
          <input
            type="text"
            placeholder="Tournament name"
            maxlength="64"
            .value=${this.createName}
            @input=${(e: InputEvent) => {
              this.createName = (e.target as HTMLInputElement).value;
            }}
            class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Map name (optional)"
            maxlength="128"
            .value=${this.createMap}
            @input=${(e: InputEvent) => {
              this.createMap = (e.target as HTMLInputElement).value;
            }}
            class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <div class="flex items-center gap-3">
            <label class="text-sm text-gray-400">Max players:</label>
            <select
              .value=${String(this.createMax)}
              @change=${(e: Event) => {
                this.createMax = parseInt(
                  (e.target as HTMLSelectElement).value,
                );
              }}
              class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none"
            >
              ${[4, 8, 16, 32, 64].map(
                (n) =>
                  html`<option value="${n}" ?selected=${n === this.createMax}>
                    ${n}
                  </option>`,
              )}
            </select>
          </div>
          <button
            @click=${() => this.createTournament()}
            class="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded cursor-pointer border-0"
          >
            Create Tournament
          </button>
        </div>
        <p class="text-xs text-gray-500">
          After creating, share the tournament ID with players. Start the
          bracket when ready from the Bracket tab.
        </p>
      </div>
    `;
  }
}
