/**
 * VaultFrontTutorial — first-run contextual overlay for new players.
 *
 * Architecture:
 * - Shows once per browser (localStorage key "vf-tutorial-seen")
 * - Two-step orientation projected from the canonical First Extraction quest
 * - Non-blocking: player can dismiss at any time
 * - No forced path — just contextual highlights with skip option
 *
 * Usage: Main.ts lazy-mounts it after the first authoritative match status.
 */

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { recordVaultFrontPlaytestPulse } from "./Api";
import { FIRST_EXTRACTION_ORIENTATION } from "./FirstExtractionQuest";

const TUTORIAL_SEEN_KEY = "vf-tutorial-seen";
const TUTORIAL_VERSION = "2";
const MOBILE_QUERY = "(max-width: 640px)";

interface TutorialStep {
  icon: string;
  title: string;
  body: string;
}

const STEPS: TutorialStep[] = [...FIRST_EXTRACTION_ORIENTATION];

@customElement("vault-front-tutorial")
export class VaultFrontTutorial extends LitElement {
  @state() private open = false;
  @state() private compact = false;
  @state() private step = 0;
  private presentationStarted = false;

  static styles = css`
    :host {
      display: contents;
      pointer-events: none;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: "Overpass", sans-serif;
      pointer-events: none;
    }

    .card {
      background: rgba(15, 23, 42, 0.97);
      border: 1px solid rgba(96, 165, 250, 0.4);
      border-radius: 12px;
      padding: 32px 28px 24px;
      width: min(440px, calc(100vw - 32px));
      color: #f1f5f9;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.6);
      pointer-events: auto;
    }

    .progress {
      display: flex;
      gap: 6px;
      margin-bottom: 24px;
    }

    .progress-dot {
      flex: 1;
      height: 3px;
      border-radius: 2px;
      background: rgba(71, 85, 105, 0.5);
      transition: background 0.2s;
    }

    .progress-dot.active {
      background: rgba(96, 165, 250, 0.9);
    }

    .progress-dot.done {
      background: rgba(52, 211, 153, 0.7);
    }

    .icon {
      font-size: 2.8rem;
      margin-bottom: 12px;
      display: block;
    }

    .title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 10px;
    }

    .body {
      font-size: 0.9rem;
      line-height: 1.6;
      color: #94a3b8;
    }

    .actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 28px;
    }

    .skip {
      background: none;
      border: none;
      color: rgba(100, 116, 139, 0.8);
      font-size: 0.8rem;
      cursor: pointer;
      padding: 4px 0;
    }

    .skip:hover {
      color: #94a3b8;
    }

    .next {
      background: rgba(37, 99, 235, 0.85);
      border: 1px solid rgba(96, 165, 250, 0.5);
      border-radius: 8px;
      color: #e0f2fe;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 10px 22px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .next:hover {
      background: rgba(37, 99, 235, 1);
    }

    .next.finish {
      background: rgba(5, 150, 105, 0.85);
      border-color: rgba(52, 211, 153, 0.5);
    }

    .next.finish:hover {
      background: rgba(5, 150, 105, 1);
    }

    .strip {
      position: fixed;
      left: 8px;
      right: 8px;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 76px);
      z-index: 9998;
      min-height: 44px;
      display: grid;
      grid-template-columns: auto 1fr auto auto auto;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid rgba(34, 211, 238, 0.45);
      border-radius: 8px;
      background: rgba(8, 13, 26, 0.94);
      color: #e0f2fe;
      font-family: "Overpass", sans-serif;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
      pointer-events: auto;
    }

    .strip-icon {
      font-size: 1rem;
    }

    .strip-copy {
      min-width: 0;
    }

    .strip-title {
      font-size: 0.72rem;
      font-weight: 800;
      line-height: 1.05;
    }

    .strip-body {
      color: #bae6fd;
      font-size: 0.68rem;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .strip-step {
      color: #67e8f9;
      font-size: 0.65rem;
      font-weight: 700;
    }

    .strip button {
      border-radius: 6px;
      border: 1px solid rgba(125, 211, 252, 0.5);
      background: rgba(14, 116, 144, 0.8);
      color: #ecfeff;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 5px 8px;
    }

    .strip .strip-close {
      border-color: rgba(148, 163, 184, 0.35);
      background: rgba(15, 23, 42, 0.7);
      color: #cbd5e1;
      padding: 5px 7px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.style.pointerEvents = "none";
  }

  /** Opens once, and only when called from certified match-ready authority. */
  public showForMatch(): boolean {
    if (
      this.presentationStarted ||
      localStorage.getItem(TUTORIAL_SEEN_KEY) === TUTORIAL_VERSION
    ) {
      return false;
    }
    this.presentationStarted = true;
    this.step = 0;
    this.compact = window.matchMedia(MOBILE_QUERY).matches;
    this.open = true;
    void recordVaultFrontPlaytestPulse({
      surface: "tutorial",
      event: "shown",
    });
    return true;
  }

  private dismiss(event: "skip" | "complete" = "skip") {
    localStorage.setItem(TUTORIAL_SEEN_KEY, TUTORIAL_VERSION);
    this.open = false;
    void recordVaultFrontPlaytestPulse({
      surface: "tutorial",
      event,
    });
  }

  private advance() {
    if (this.step < STEPS.length - 1) {
      this.step++;
      void recordVaultFrontPlaytestPulse({
        surface: "tutorial",
        event: "advance",
      });
    } else {
      this.dismiss("complete");
    }
  }

  render() {
    if (!this.open) return html``;

    const current = STEPS[this.step];
    const isLast = this.step === STEPS.length - 1;

    if (this.compact) {
      return html`
        <div class="strip" @click=${(e: Event) => e.stopPropagation()}>
          <span class="strip-icon">${current.icon}</span>
          <div class="strip-copy">
            <div class="strip-title">${current.title}</div>
            <div class="strip-body">${current.body}</div>
          </div>
          <span class="strip-step">${this.step + 1}/${STEPS.length}</span>
          <button
            class="strip-close"
            title="Dismiss tutorial"
            @click=${() => this.dismiss("skip")}
          >
            x
          </button>
          <button @click=${this.advance}>${isLast ? "Done" : "Next"}</button>
        </div>
      `;
    }

    return html`
      <div class="overlay" @click=${(e: Event) => e.stopPropagation()}>
        <div class="card">
          <div class="progress">
            ${STEPS.map(
              (_, i) => html`
                <div
                  class="progress-dot ${
                    i < this.step ? "done" : i === this.step ? "active" : ""
                  }"
                ></div>
              `,
            )}
          </div>

          <span class="icon">${current.icon}</span>
          <div class="title">${current.title}</div>
          <div class="body">${current.body}</div>

          <div class="actions">
            <button class="skip" @click=${() => this.dismiss("skip")}>
              ${isLast ? "" : "Skip tutorial"}
            </button>
            <button
              class="next ${isLast ? "finish" : ""}"
              @click=${this.advance}
            >
              ${isLast ? "Let's play" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
