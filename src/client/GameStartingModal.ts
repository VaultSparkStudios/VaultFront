import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  fetchMatchOracle,
  fetchMatchProphecy,
  fetchPrematchBrief,
} from "./Api";
import { translateText } from "./Utils";

interface OraclePrediction {
  playerId: string;
  deltaIfWin: number;
  deltaIfLoss: number;
  threat?: string;
}

type IntelligenceStatus = "idle" | "loading" | "ready" | "degraded";
const INTELLIGENCE_DEADLINE_MS = 6_000;

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  @state()
  private oraclePredictions: OraclePrediction[] = [];

  @state()
  private myPrediction: OraclePrediction | null = null;

  @state()
  private prophecy: string | null = null;
  private prophecyVisible = false;

  @state()
  private prematchBrief: string | null = null;

  @state()
  private intelligenceStatus: IntelligenceStatus = "idle";

  private requestGeneration = 0;
  private requestController: AbortController | null = null;
  private sessionTimers = new Set<ReturnType<typeof setTimeout>>();

  createRenderRoot() {
    return this;
  }

  async showWithPlayers(
    playerIds: string[],
    myPlayerId: string,
    mapName = "unknown",
    mutator = "none",
  ): Promise<void> {
    this.cancelIntelligenceSession();
    const generation = ++this.requestGeneration;
    const controller = new AbortController();
    this.requestController = controller;
    this.isVisible = true;
    this.oraclePredictions = [];
    this.myPrediction = null;
    this.prophecy = null;
    this.prophecyVisible = false;
    this.prematchBrief = null;
    this.intelligenceStatus = playerIds.length >= 2 ? "loading" : "idle";
    this.requestUpdate();

    if (playerIds.length >= 2) {
      const deadline = this.scheduleForSession(
        generation,
        () => controller.abort("prematch-intelligence-deadline"),
        INTELLIGENCE_DEADLINE_MS,
      );
      const settled = await Promise.allSettled([
        fetchMatchOracle(playerIds, controller.signal),
        fetchMatchProphecy(
          mapName,
          playerIds.length,
          mutator,
          controller.signal,
        ),
        fetchPrematchBrief(myPlayerId, mapName, undefined, controller.signal),
      ]);
      this.clearSessionTimer(deadline);
      if (!this.isCurrentSession(generation)) return;

      const oracleResult =
        settled[0].status === "fulfilled" ? settled[0].value : null;
      const prophecyText =
        settled[1].status === "fulfilled" ? settled[1].value : null;
      const brief = settled[2].status === "fulfilled" ? settled[2].value : null;

      if (oracleResult?.predictions) {
        this.oraclePredictions = oracleResult.predictions;
        this.myPrediction =
          oracleResult.predictions.find((p) => p.playerId === myPlayerId) ??
          null;
      }

      if (prophecyText) {
        this.prophecy = prophecyText;
        this.prophecyVisible = true;
        this.scheduleForSession(
          generation,
          () => {
            this.prophecyVisible = false;
            this.requestUpdate();
          },
          8_000,
        );
      }

      if (brief) {
        this.prematchBrief = brief;
      }

      this.intelligenceStatus =
        oracleResult || prophecyText || brief ? "ready" : "degraded";
      this.requestUpdate();

      this.scheduleForSession(
        generation,
        () => {
          this.oraclePredictions = [];
          this.myPrediction = null;
          this.requestUpdate();
        },
        30_000,
      );
    }
  }

  private isCurrentSession(generation: number): boolean {
    return generation === this.requestGeneration && this.isVisible;
  }

  private scheduleForSession(
    generation: number,
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.sessionTimers.delete(timer);
      if (this.isCurrentSession(generation)) callback();
    }, delayMs);
    this.sessionTimers.add(timer);
    return timer;
  }

  private clearSessionTimer(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer);
    this.sessionTimers.delete(timer);
  }

  private cancelIntelligenceSession(): void {
    this.requestController?.abort("prematch-session-replaced");
    this.requestController = null;
    for (const timer of this.sessionTimers) clearTimeout(timer);
    this.sessionTimers.clear();
  }

  disconnectedCallback(): void {
    this.cancelIntelligenceSession();
    this.requestGeneration += 1;
    super.disconnectedCallback();
  }

  private renderProphecyCard() {
    if (!this.prophecy) return null;
    return html`
      <div
        class="mt-3 rounded-lg border border-purple-500/40 bg-purple-900/20 p-3 text-left transition-opacity duration-1000 ${
          this.prophecyVisible ? "opacity-100" : "opacity-0"
        }"
      >
        <div
          class="text-xs font-semibold text-purple-300 mb-1.5 tracking-wider"
        >
          🔮 THE ORACLE SPEAKS
        </div>
        <p class="text-sm text-slate-200 italic leading-relaxed m-0">
          "${this.prophecy}"
        </p>
      </div>
    `;
  }

  private renderOracleCard() {
    if (!this.myPrediction) return null;
    const p = this.myPrediction;
    return html`
      <div
        class="mt-3 rounded-lg border border-amber-500/40 bg-amber-900/20 p-3 text-left"
      >
        <div class="text-xs font-semibold text-amber-300 mb-1.5">
          ⚡ Oracle Prediction
        </div>
        <div class="text-xs text-slate-300 flex justify-between mb-1">
          <span>Win →</span>
          <span class="text-green-400 font-semibold">+${p.deltaIfWin} ELO</span>
        </div>
        <div class="text-xs text-slate-300 flex justify-between">
          <span>Loss →</span>
          <span class="text-red-400 font-semibold">${p.deltaIfLoss} ELO</span>
        </div>
        ${
          p.threat
            ? html`<div class="text-xs text-slate-400 mt-1.5">
                ⚠ Biggest threat:
                <span class="text-amber-300">${p.threat}</span>
              </div>`
            : null
        }
      </div>
    `;
  }

  private renderPrematchBrief() {
    if (!this.prematchBrief) return null;
    return html`
      <div
        class="mt-3 rounded-lg border border-cyan-500/40 bg-cyan-900/20 p-3 text-left"
      >
        <div class="text-xs font-semibold text-cyan-300 mb-1.5 tracking-wider">
          🎯 Pre-Match Brief
        </div>
        <p class="text-sm text-slate-200 leading-relaxed m-0">
          ${this.prematchBrief}
        </p>
      </div>
    `;
  }

  private renderIntelligenceStatus() {
    if (this.intelligenceStatus === "loading") {
      return html`<p role="status" class="my-3 text-sm text-cyan-200">
        Scanning certified match signals…
      </p>`;
    }
    if (this.intelligenceStatus === "degraded") {
      return html`<p role="status" class="my-3 text-xs text-slate-300">
        Starting with local match data; live intelligence is unavailable.
      </p>`;
    }
    return null;
  }

  render() {
    const isVisible = this.isVisible;
    return html`
      <div
        aria-hidden=${String(!isVisible)}
        class="fixed inset-0 bg-black/30 backdrop-blur-[4px] z-[9998] transition-all duration-300 ${
          isVisible ? "opacity-100 visible" : "opacity-0 invisible"
        }"
      ></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-label=${translateText("game_starting_modal.title")}
        aria-hidden=${String(!isVisible)}
        class="fixed top-1/2 left-1/2 max-h-[85dvh] w-[min(92vw,32rem)] overflow-y-auto bg-zinc-800/85 p-4 sm:p-6 rounded-xl z-[9999] shadow-[0_0_20px_rgba(0,0,0,0.5)] backdrop-blur-[5px] text-white text-center transition-all duration-300 -translate-x-1/2 ${
          isVisible
            ? "opacity-100 visible -translate-y-1/2"
            : "opacity-0 invisible -translate-y-[48%]"
        }"
      >
        <div class="text-xl mt-5 mb-2.5 px-0">
          © VaultFront and Contributors
        </div>
        <a
          href="https://github.com/VaultSparkStudios/VaultFront/blob/main/CREDITS.md"
          target="_blank"
          rel="noopener noreferrer"
          class="block mt-2.5 mb-4 text-xl text-blue-400 no-underline transition-colors duration-200 hover:text-blue-300 hover:underline"
          >${translateText("game_starting_modal.credits")}</a
        >
        <p class="my-0.5 text-sm">
          ${translateText("game_starting_modal.code_license")}
        </p>
        <p class="text-base my-5 bg-black/30 p-2.5 rounded">
          ${translateText("game_starting_modal.title")}
        </p>
        ${this.renderIntelligenceStatus()} ${this.renderPrematchBrief()}
        ${this.renderProphecyCard()} ${this.renderOracleCard()}
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.cancelIntelligenceSession();
    this.requestGeneration += 1;
    this.isVisible = false;
    this.intelligenceStatus = "idle";
    this.requestUpdate();
  }
}
