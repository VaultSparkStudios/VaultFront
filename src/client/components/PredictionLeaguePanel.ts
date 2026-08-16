import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { GameView } from "../../core/game/GameView";
import { predictionLeagueContract } from "../../shared/PredictionLeagueContract";
import {
  fetchPredictionConsensus,
  fetchPredictionLeagueStats,
  submitPredictionLeaguePick,
  type PredictionConsensus,
  type PredictionOutcome,
} from "../Api";
import type { Layer } from "../graphics/layers/Layer";

/** Reachable, keyboard-operable prediction surface shown only to spectators. */
@customElement("prediction-league-panel")
export class PredictionLeaguePanel extends LitElement implements Layer {
  public game: GameView;

  @state() private visible = false;
  @state() private pending = false;
  @state() private selected: PredictionOutcome | null = null;
  @state() private notice: string = predictionLeagueContract.notice;
  @state() private accuracy: number | null = null;
  @state() private consensus: PredictionConsensus | null = null;

  private lastSpectatorState = false;

  createRenderRoot() {
    return this;
  }

  tick(): void {
    const player = this.game?.myPlayer?.();
    const spectator = !player || !player.isAlive();
    if (spectator === this.lastSpectatorState) return;
    this.lastSpectatorState = spectator;
    this.visible = spectator;
    if (spectator) void Promise.all([this.loadStats(), this.loadConsensus()]);
  }

  private async loadStats(): Promise<void> {
    const stats = await fetchPredictionLeagueStats();
    this.accuracy = stats?.accuracy ?? null;
  }

  private async loadConsensus(): Promise<void> {
    const gameId = this.game?.gameID?.();
    if (!gameId) return;
    this.consensus = await fetchPredictionConsensus(gameId);
  }

  private async submit(outcome: PredictionOutcome): Promise<void> {
    if (this.pending || this.selected) return;
    const gameId = this.game?.gameID?.();
    if (!gameId) {
      this.notice = "Match identity unavailable";
      return;
    }
    this.pending = true;
    const result = await submitPredictionLeaguePick(gameId, outcome);
    this.pending = false;
    if (result.accepted) {
      this.selected = outcome;
      this.consensus = result.consensus ?? this.consensus;
      this.notice =
        result.durability === "postgres"
          ? "Prediction locked in"
          : "Prediction locked for this server session";
      return;
    }
    this.notice =
      result.reason === "duplicate-or-closed"
        ? "Prediction already placed or match resolved"
        : "Prediction service unavailable";
  }

  render() {
    if (!this.visible) return html``;
    return html`
      <style>
        .prediction-panel {
          position: fixed;
          top: 5rem;
          right: 0.75rem;
          z-index: 920;
          width: min(19rem, calc(100vw - 1.5rem));
          padding: 0.8rem;
          color: #f8fafc;
          background: linear-gradient(
            145deg,
            rgba(15, 23, 42, 0.94),
            rgba(30, 41, 59, 0.88)
          );
          border: 1px solid rgba(94, 234, 212, 0.34);
          border-radius: 0.85rem;
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(12px);
          pointer-events: auto;
        }
        .prediction-heading {
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .prediction-kicker {
          color: #5eead4;
          font-size: 0.62rem;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .prediction-title {
          margin-top: 0.15rem;
          font-size: 0.82rem;
          font-weight: 700;
        }
        .prediction-accuracy {
          color: #facc15;
          font-size: 0.68rem;
          white-space: nowrap;
        }
        .prediction-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.45rem;
          margin-top: 0.65rem;
        }
        .prediction-action {
          min-height: 2.75rem;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 0.55rem;
          color: #e2e8f0;
          background: rgba(255, 255, 255, 0.06);
          font-size: 0.72rem;
          font-weight: 750;
          transition:
            transform 120ms ease,
            border-color 120ms ease,
            background 120ms ease;
        }
        .prediction-action:hover:not(:disabled),
        .prediction-action:focus-visible {
          transform: translateY(-1px);
          border-color: #5eead4;
          background: rgba(45, 212, 191, 0.13);
          outline: none;
        }
        .prediction-action[aria-pressed="true"] {
          border-color: #facc15;
          background: rgba(250, 204, 21, 0.13);
          color: #fef08a;
        }
        .prediction-action:disabled {
          cursor: not-allowed;
          opacity: 0.62;
        }
        .prediction-notice {
          margin-top: 0.5rem;
          color: #94a3b8;
          font-size: 0.64rem;
          line-height: 1.3;
        }
        .prediction-consensus {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.35rem;
          margin-top: 0.55rem;
          font-size: 0.62rem;
          color: #cbd5e1;
        }
        .prediction-meter {
          grid-column: 1 / -1;
          display: flex;
          height: 0.3rem;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
        }
        .prediction-meter-delivery {
          background: #22d3ee;
        }
        .prediction-meter-intercept {
          background: #fb7185;
        }
        @media (max-width: 640px) {
          .prediction-panel {
            top: 3.6rem;
            right: 0.5rem;
            width: min(17rem, calc(100vw - 1rem));
          }
        }
      </style>
      <section
        class="prediction-panel"
        aria-label="Spectator Prediction League"
      >
        <div class="prediction-heading">
          <div>
            <div class="prediction-kicker">Prediction League</div>
            <div class="prediction-title">
              ${predictionLeagueContract.question}
            </div>
          </div>
          ${
            this.accuracy === null
              ? ""
              : html`<span class="prediction-accuracy"
                  >${this.accuracy}% accuracy</span
                >`
          }
        </div>
        <div class="prediction-actions">
          ${(["delivery", "intercept"] as const).map(
            (outcome) => html`
              <button
                class="prediction-action"
                type="button"
                ?disabled=${this.pending || this.selected !== null}
                aria-pressed=${this.selected === outcome}
                @click=${() => this.submit(outcome)}
              >
                ${
                  outcome === "delivery"
                    ? predictionLeagueContract.deliveryChoice
                    : predictionLeagueContract.interceptChoice
                }
              </button>
            `,
          )}
        </div>
        ${
          this.consensus && this.consensus.total > 0
            ? html`
                <div
                  class="prediction-consensus"
                  aria-label="Live crowd consensus"
                >
                  <span>Delivery ${this.consensus.deliveryPct}%</span>
                  <span style="text-align:right"
                    >Intercept ${this.consensus.interceptPct}%</span
                  >
                  <div class="prediction-meter" aria-hidden="true">
                    <div
                      class="prediction-meter-delivery"
                      style="width:${this.consensus.deliveryPct}%"
                    ></div>
                    <div
                      class="prediction-meter-intercept"
                      style="width:${this.consensus.interceptPct}%"
                    ></div>
                  </div>
                </div>
              `
            : ""
        }
        <div class="prediction-notice" role="status" aria-live="polite">
          ${this.notice}
        </div>
        <p class="prediction-notice">${predictionLeagueContract.rule}</p>
      </section>
    `;
  }
}
