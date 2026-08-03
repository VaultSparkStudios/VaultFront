/**
 * SeasonPassTrack — horizontal season milestone strip.
 * Mount in PlayPage below map picker. Call loadForPlayer() to populate.
 */

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  claimSeasonMilestone,
  fetchSeasonProgress,
  type SeasonEntitlement,
  type SeasonMilestoneProgress,
} from "./Api";

export function seasonProgressArc(progress: number, target: number) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.max(
    0,
    Math.min(100, target > 0 ? (progress / target) * 100 : 0),
  );
  return {
    percent,
    radius,
    circumference,
    dash: (percent / 100) * circumference,
  };
}

@customElement("season-pass-track")
export class SeasonPassTrack extends LitElement {
  @state() private milestones: SeasonMilestoneProgress[] = [];
  @state() private loading = false;
  @state() private currentSeason = "";
  @state() private durability: "postgres" | "process-local" | "" = "";
  @state() private entitlements: SeasonEntitlement[] = [];
  @state() private claimingId: string | null = null;

  private persistentId = "";

  static styles = css`
    :host {
      display: block;
      font-family: "Overpass", sans-serif;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .season-label {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: #64748b;
    }
    .season-id {
      font-size: 0.72rem;
      color: #475569;
    }
    .evidence {
      margin-left: auto;
      font-size: 0.64rem;
      color: #047857;
    }
    .track {
      display: flex;
      align-items: center;
      overflow-x: auto;
      padding-bottom: 6px;
      gap: 0;
    }
    .entitlements {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .entitlement {
      border: 1px solid rgba(52, 211, 153, 0.32);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 0.66rem;
      color: #047857;
      background: rgba(52, 211, 153, 0.08);
    }
    .milestone {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-shrink: 0;
      position: relative;
    }
    .connector {
      width: 40px;
      height: 3px;
      background: rgba(71, 85, 105, 0.4);
      flex-shrink: 0;
      margin-top: -18px;
    }
    .connector.done {
      background: rgba(251, 191, 36, 0.6);
    }
    .node {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
      border: 2px solid rgba(71, 85, 105, 0.5);
      background: rgba(15, 23, 42, 0.8);
      cursor: default;
      transition:
        transform 0.15s,
        box-shadow 0.15s;
      position: relative;
    }
    .node.unlocked {
      border-color: rgba(251, 191, 36, 0.7);
      background: rgba(30, 20, 0, 0.8);
      box-shadow: 0 0 10px rgba(251, 191, 36, 0.25);
    }
    .node.claimable {
      border-color: rgba(52, 211, 153, 0.8);
      background: rgba(0, 30, 20, 0.8);
      box-shadow: 0 0 10px rgba(52, 211, 153, 0.4);
      cursor: pointer;
      animation: pulse-glow 1.5s ease-in-out infinite;
    }
    @keyframes pulse-glow {
      0%,
      100% {
        box-shadow: 0 0 8px rgba(52, 211, 153, 0.3);
      }
      50% {
        box-shadow: 0 0 18px rgba(52, 211, 153, 0.7);
      }
    }
    .node:hover.claimable {
      transform: scale(1.12);
    }
    .node-label {
      font-size: 0.6rem;
      color: #475569;
      text-align: center;
      max-width: 52px;
      margin-top: 4px;
      line-height: 1.3;
    }
    .node-label.unlocked {
      color: #92400e;
    }
    .node-label.claimable {
      color: #065f46;
    }
    .progress-arc {
      position: absolute;
      top: -3px;
      left: -3px;
      width: 42px;
      height: 42px;
      pointer-events: none;
    }
    .empty {
      color: #64748b;
      font-size: 0.82rem;
      padding: 12px 0;
    }
  `;

  async loadForPlayer(persistentId: string): Promise<void> {
    this.persistentId = persistentId;
    this.loading = true;
    const data = await fetchSeasonProgress(persistentId);
    if (data) {
      this.currentSeason = data.seasonId ?? "";
      this.milestones = data.milestones;
      this.durability = data.durability ?? "";
      this.entitlements = data.entitlements ?? [];
    }
    this.loading = false;
  }

  private async _claim(milestoneId: string) {
    if (!this.persistentId || this.claimingId) return;
    this.claimingId = milestoneId;
    await claimSeasonMilestone(this.persistentId, milestoneId);
    await this.loadForPlayer(this.persistentId);
    this.claimingId = null;
  }

  private rewardIcon(type: string, value: string): string {
    if (type === "emoji") return value;
    if (type === "badge") return "🏅";
    if (type === "title") return "👑";
    return "🎁";
  }

  render() {
    if (this.loading)
      return html`<div class="empty">Loading season track…</div>`;
    if (this.milestones.length === 0)
      return html`<div class="empty">Season pass not available.</div>`;

    return html`
      <div class="header">
        <span class="season-label">Season Pass</span>
        <span class="season-id">${this.currentSeason}</span>
        <span
          class="evidence"
          title="Progress is derived from certified match results"
        >
          ${this.durability === "postgres" ? "Durable ledger" : "Local session ledger"}
        </span>
      </div>
      <div class="track">
        ${this.milestones.map((m, i) => {
          const claimable = m.unlocked && !m.claimed;
          const nodeClass = m.claimed
            ? "unlocked"
            : claimable
              ? "claimable"
              : "";
          const labelClass = m.claimed
            ? "unlocked"
            : claimable
              ? "claimable"
              : "";
          const icon = this.rewardIcon(
            m.milestone.reward.type,
            m.milestone.reward.value,
          );
          const arc = seasonProgressArc(m.progress, m.target);
          return html`
            ${
              i > 0
                ? html`<div class="connector ${m.claimed ? "done" : ""}"></div>`
                : ""
            }
            <div class="milestone">
              <div
                class="node ${nodeClass}"
                title="${m.milestone.title} — ${m.milestone.description}"
                @click=${claimable ? () => this._claim(m.milestone.id) : null}
              >
                ${
                  m.claimed
                    ? icon
                    : claimable
                      ? html`<span style="filter: brightness(1.4)"
                          >${icon}</span
                        >`
                      : html`
                          <svg
                            class="progress-arc"
                            viewBox="0 0 42 42"
                            xmlns="http://www.w3.org/2000/svg"
                            role="img"
                            aria-label="${Math.round(
                              arc.percent,
                            )}% progress toward ${m.milestone.title}"
                          >
                            <circle
                              cx="21"
                              cy="21"
                              r=${arc.radius}
                              fill="none"
                              stroke="rgba(71,85,105,0.3)"
                              stroke-width="2.5"
                            ></circle>
                            <circle
                              cx="21"
                              cy="21"
                              r=${arc.radius}
                              fill="none"
                              stroke="rgba(251,191,36,0.72)"
                              stroke-width="2.5"
                              stroke-dasharray="${arc.dash} ${
                                arc.circumference
                              }"
                              stroke-linecap="round"
                              transform="rotate(-90 21 21)"
                            ></circle>
                          </svg>
                          <span style="opacity:0.5;font-size:0.85rem">🔒</span>
                        `
                }
              </div>
              <div class="node-label ${labelClass}">
                ${m.milestone.title.split(" ").slice(0, 2).join(" ")}
                ${
                  !m.claimed
                    ? html`<br /><span style="font-size:0.58rem"
                          >${m.progress}/${m.target}</span
                        >`
                    : ""
                }
              </div>
            </div>
          `;
        })}
      </div>
      ${
        this.entitlements.length > 0
          ? html`<div class="entitlements" aria-label="Earned season cosmetics">
              ${this.entitlements.map(
                (item) =>
                  html`<span class="entitlement">
                    ${item.type === "title" ? "👑" : "🏅"} ${item.value}
                  </span>`,
              )}
            </div>`
          : ""
      }
    `;
  }
}

if (!customElements.get("season-pass-track")) {
  customElements.define("season-pass-track", SeasonPassTrack);
}
