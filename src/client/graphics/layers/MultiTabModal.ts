import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameEnv } from "../../../core/configuration/Config";
import { GameType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { MultiTabDetector } from "../../MultiTabDetector";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("multi-tab-modal")
export class MultiTabModal extends LitElement implements Layer {
  public game: GameView;
  private detector: MultiTabDetector | null = null;

  @property({ type: Number }) duration = 5_000;
  @state() private countdown = 5;
  @state() private isVisible = false;
  private intervalId: number | null = null;

  createRenderRoot() {
    return this;
  }

  tick() {
    if (
      this.game.inSpawnPhase() ||
      this.game.config().gameConfig().gameType === GameType.Singleplayer ||
      this.game.config().serverConfig().env() === GameEnv.Dev
    ) {
      return;
    }
    if (!this.detector) {
      this.detector = new MultiTabDetector();
      this.detector.startMonitoring((duration) => this.show(duration));
    }
  }

  init() {
    this.hide(false);
  }

  public show(duration: number): void {
    if (!this.game.myPlayer()?.isAlive()) return;
    this.hide(false);
    this.duration = duration;
    this.countdown = Math.ceil(duration / 1_000);
    this.isVisible = true;
    this.intervalId = window.setInterval(() => {
      this.countdown -= 1;
      if (this.countdown <= 0) this.hide();
    }, 1_000);
    this.requestUpdate();
  }

  public hide(announce = true): void {
    this.isVisible = false;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (announce) {
      this.dispatchEvent(
        new CustomEvent("penalty-complete", {
          bubbles: true,
          composed: true,
        }),
      );
    }
    this.requestUpdate();
  }

  public dispose(): void {
    this.hide(false);
    this.detector?.stopMonitoring();
    this.detector = null;
  }

  disconnectedCallback() {
    this.dispose();
    super.disconnectedCallback();
  }

  render() {
    if (!this.isVisible) return html``;
    const progress = Math.max(
      0,
      Math.min(100, (this.countdown / (this.duration / 1_000)) * 100),
    );
    return html`
      <div
        class="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-950/75 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="multi-tab-title"
        aria-describedby="multi-tab-scope"
      >
        <div
          class="relative w-full max-w-md rounded-xl border border-amber-300/45 bg-slate-950 p-6 text-slate-100 shadow-2xl"
        >
          <div class="mb-4 flex items-start justify-between gap-3">
            <h2
              id="multi-tab-title"
              class="m-0 text-xl font-bold text-amber-200"
            >
              Another VaultFront tab is active
            </h2>
            <span
              class="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-cyan-100"
              >Local tab check</span
            >
          </div>

          <p class="mb-3 text-sm text-slate-200">
            ${translateText("multi_tab.detected")}
          </p>
          <p
            id="multi-tab-scope"
            class="mb-4 text-xs leading-relaxed text-slate-400"
          >
            This pause comes only from a same-origin browser storage collision.
            It does not inspect your IP address or device, and it does not
            create a server report or suspension record.
          </p>

          <div
            class="mb-2 flex items-center justify-between text-xs text-slate-300"
          >
            <span>Command input resumes automatically</span>
            <span class="font-semibold text-amber-200" aria-live="polite"
              >${this.countdown}s</span
            >
          </div>
          <div class="h-2.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              class="h-full rounded-full bg-amber-400 transition-[width] duration-1000 motion-reduce:transition-none"
              style="width:${progress}%"
            ></div>
          </div>
          <p class="mb-0 mt-4 text-xs text-slate-400">
            Close the other VaultFront tab to avoid another local collision.
          </p>
        </div>
      </div>
    `;
  }
}
