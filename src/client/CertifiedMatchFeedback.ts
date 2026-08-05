import { html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  postMatchRating,
  type MatchFeedbackSignal,
  type MatchRatingSubmission,
} from "./Api";

type RatingDimension = "match" | "map";

const FEEDBACK_SIGNALS: ReadonlyArray<{
  value: MatchFeedbackSignal;
  label: string;
}> = [
  { value: "decisive-convoy", label: "Decisive convoy" },
  { value: "comeback-tension", label: "Comeback tension" },
  { value: "clear-objectives", label: "Clear objectives" },
  { value: "pacing-drag", label: "Pacing dragged" },
  { value: "map-flow", label: "Map flow" },
  { value: "control-friction", label: "Control friction" },
  { value: "technical-friction", label: "Technical friction" },
];

@customElement("certified-match-feedback")
export class CertifiedMatchFeedback extends LitElement {
  @property({ type: String }) gameId = "";
  @state() private matchRating = 0;
  @state() private mapRating = 0;
  @state() private signal: MatchFeedbackSignal | null = null;
  @state() private pending = false;
  @state() private outcome: MatchRatingSubmission | null = null;

  createRenderRoot() {
    return this;
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("gameId") && changed.get("gameId") !== undefined) {
      this.matchRating = 0;
      this.mapRating = 0;
      this.signal = null;
      this.outcome = null;
      this.pending = false;
    }
  }

  private setRating(dimension: RatingDimension, value: number) {
    if (this.pending || this.isComplete()) return;
    if (dimension === "match") this.matchRating = value;
    else this.mapRating = value;
    this.outcome = null;
  }

  private isComplete() {
    return (
      this.outcome?.status === "accepted" ||
      this.outcome?.status === "duplicate"
    );
  }

  private async submit() {
    if (!this.gameId || !this.matchRating || !this.mapRating || this.pending)
      return;
    this.pending = true;
    this.outcome = null;
    const submittedGameId = this.gameId;
    const outcome = await postMatchRating({
      gameId: submittedGameId,
      matchRating: this.matchRating,
      mapRating: this.mapRating,
      signal: this.signal ?? undefined,
    });
    if (this.gameId !== submittedGameId) return;
    this.outcome = outcome;
    this.pending = false;
  }

  private setSignal(signal: MatchFeedbackSignal) {
    if (this.pending || this.isComplete()) return;
    this.signal = this.signal === signal ? null : signal;
    this.outcome = null;
  }

  private ratingButtons(dimension: RatingDimension, value: number) {
    const label = dimension === "match" ? "Match rating" : "Map rating";
    return html`
      <div
        class="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3"
        role="group"
        aria-label=${label}
      >
        <span class="text-xs font-medium text-slate-300">${label}</span>
        <div class="flex gap-1" aria-label="${label}: ${value || "not set"}">
          ${[1, 2, 3, 4, 5].map(
            (rating) => html`
              <button
                type="button"
                class="h-11 w-11 rounded-md border text-sm transition-colors motion-reduce:transition-none ${
                  value === rating
                    ? "border-amber-300 bg-amber-400/25 text-amber-100"
                    : "border-slate-500/60 bg-slate-900/35 text-slate-300 hover:border-amber-300/70 hover:text-amber-100"
                }"
                aria-label="${label} ${rating} out of 5"
                aria-pressed=${value === rating ? "true" : "false"}
                ?disabled=${this.pending || this.isComplete()}
                @click=${() => this.setRating(dimension, rating)}
              >
                ${rating}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  render() {
    const receipt =
      this.outcome?.status === "accepted" ||
      this.outcome?.status === "duplicate"
        ? this.outcome.receipt
        : null;
    const complete = receipt !== null;
    const error =
      this.outcome?.status === "rejected" ||
      this.outcome?.status === "unavailable"
        ? this.outcome.detail
        : null;
    return html`
      <section
        class="my-3 rounded-lg border border-slate-500/35 bg-slate-950/30 p-3"
        aria-labelledby="certified-feedback-title"
      >
        <div class="mb-2 flex items-start justify-between gap-3">
          <div>
            <h3
              id="certified-feedback-title"
              class="m-0 text-sm font-semibold text-white"
            >
              Rate this certified match
            </h3>
            <p class="m-0 mt-0.5 text-[11px] text-slate-400">
              Match feel and map quality are recorded separately.
            </p>
          </div>
          <span
            class="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200"
            >Certified result</span
          >
        </div>
        <div class="grid gap-2">
          ${this.ratingButtons("match", this.matchRating)}
          ${this.ratingButtons("map", this.mapRating)}
        </div>
        <fieldset
          class="mt-3 border-0 p-0"
          ?disabled=${this.pending || complete}
        >
          <legend class="mb-2 text-xs font-medium text-slate-300">
            What most shaped that rating?
            <span class="text-slate-500">Optional</span>
          </legend>
          <div
            class="flex flex-wrap gap-2"
            role="group"
            aria-label="Match feedback cause"
          >
            ${FEEDBACK_SIGNALS.map(
              ({ value, label }) => html`
                <button
                  type="button"
                  class="min-h-11 rounded-md border px-3 py-2 text-xs transition-colors motion-reduce:transition-none ${
                    this.signal === value
                      ? "border-cyan-300 bg-cyan-400/20 text-cyan-100"
                      : "border-slate-500/60 bg-slate-900/35 text-slate-300 hover:border-cyan-300/70 hover:text-cyan-100"
                  }"
                  aria-label="Feedback cause: ${label}"
                  aria-pressed=${this.signal === value ? "true" : "false"}
                  @click=${() => this.setSignal(value)}
                >
                  ${label}
                </button>
              `,
            )}
          </div>
        </fieldset>
        ${
          complete
            ? html`<p
                  class="m-0 mt-3 text-center text-xs text-emerald-200"
                  role="status"
                >
                  ${
                    this.outcome?.status === "duplicate"
                      ? "This certified match was already rated."
                      : "Feedback saved to the certified match ledger."
                  }
                </p>
                <p class="m-0 mt-1 text-center text-[10px] text-slate-400">
                  ${receipt?.mapName} ·
                  ${
                    receipt?.durability === "postgres"
                      ? "durable database receipt"
                      : "process-local receipt"
                  }
                  · ${receipt?.retentionDays}-day retention ·
                  ${receipt?.evidence}${
                    receipt?.signal ? html` · cause: ${receipt.signal}` : null
                  }
                </p>`
            : html`
                <button
                  type="button"
                  class="mt-3 min-h-11 w-full rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
                  ?disabled=${
                    !this.gameId ||
                    !this.matchRating ||
                    !this.mapRating ||
                    this.pending
                  }
                  @click=${this.submit}
                >
                  ${
                    this.pending
                      ? "Saving certified feedback…"
                      : error
                        ? "Retry certified feedback"
                        : "Submit both ratings"
                  }
                </button>
                ${
                  error
                    ? html`<p
                        class="m-0 mt-2 text-center text-xs text-red-200"
                        role="alert"
                      >
                        ${error}
                      </p>`
                    : null
                }
              `
        }
      </section>
    `;
  }
}
