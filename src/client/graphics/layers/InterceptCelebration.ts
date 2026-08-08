import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { triggerHaptic } from "../../Utils";
import { Layer } from "./Layer";

interface InterceptEvent {
  label: string;
  id: number;
}

@customElement("intercept-celebration")
export class InterceptCelebration extends LitElement implements Layer {
  public game: GameView;

  @state() private events: InterceptEvent[] = [];
  private nextId = 0;

  createRenderRoot() {
    return this;
  }

  tick(): void {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    const activities = updates[GameUpdateType.VaultFrontActivity];
    if (!activities) return;

    for (const act of activities) {
      if (act.activity !== "convoy_intercepted") continue;

      const goldText = act.label ? ` — ${act.label}` : "";
      const id = this.nextId++;
      this.events = [...this.events, { label: `INTERCEPTED${goldText}`, id }];

      if (this.game.config().userSettings()?.hapticsEnabled()) {
        triggerHaptic([40, 30, 60]);
      }

      // Fire show-message toast
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: `⚡ ${act.label || "Convoy Intercepted"}`,
            duration: 3000,
            color: "green",
          },
        }),
      );

      // Auto-clear after animation
      setTimeout(() => {
        this.events = this.events.filter((e) => e.id !== id);
      }, 900);
    }
  }

  render() {
    if (this.events.length === 0) return html``;
    return html`
      <style>
        .intercept-burst {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -60%);
          z-index: 9500;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .intercept-label {
          font-size: 1.4rem;
          font-weight: 900;
          letter-spacing: 0.08em;
          color: #fbbf24;
          text-shadow:
            0 0 12px rgba(251, 191, 36, 0.9),
            0 2px 6px rgba(0, 0, 0, 0.8);
          animation: intercept-pop 0.85s ease-out forwards;
        }
        .intercept-particles {
          display: flex;
          gap: 6px;
        }
        .intercept-particle {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #fbbf24;
          animation: particle-burst 0.8s ease-out forwards;
        }
        .intercept-particle:nth-child(2) {
          animation-delay: 0.05s;
          background: #f59e0b;
        }
        .intercept-particle:nth-child(3) {
          animation-delay: 0.1s;
          background: #fcd34d;
        }
        .intercept-particle:nth-child(4) {
          animation-delay: 0.12s;
          background: #fbbf24;
        }
        .intercept-particle:nth-child(5) {
          animation-delay: 0.08s;
          background: #f59e0b;
        }
        @keyframes intercept-pop {
          0% {
            opacity: 0;
            transform: scale(0.5) translateY(10px);
          }
          20% {
            opacity: 1;
            transform: scale(1.15) translateY(0);
          }
          70% {
            opacity: 1;
            transform: scale(1) translateY(-4px);
          }
          100% {
            opacity: 0;
            transform: scale(0.9) translateY(-12px);
          }
        }
        @keyframes particle-burst {
          0% {
            opacity: 1;
            transform: scale(1) translate(0, 0);
          }
          100% {
            opacity: 0;
            transform: scale(0.3) translate(var(--dx, 0px), var(--dy, -30px));
          }
        }
      </style>
      ${this.events.map(
        (e) => html`
          <div class="intercept-burst">
            <div class="intercept-label">${e.label}</div>
            <div class="intercept-particles">
              <div
                class="intercept-particle"
                style="--dx:-20px;--dy:-28px"
              ></div>
              <div
                class="intercept-particle"
                style="--dx:-8px;--dy:-32px"
              ></div>
              <div class="intercept-particle" style="--dx:0px;--dy:-36px"></div>
              <div class="intercept-particle" style="--dx:8px;--dy:-32px"></div>
              <div
                class="intercept-particle"
                style="--dx:20px;--dy:-28px"
              ></div>
            </div>
          </div>
        `,
      )}
    `;
  }
}
