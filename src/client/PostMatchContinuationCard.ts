import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { selectPostMatchContinuation } from "./PostMatchContinuation";
import type {
  PostMatchContinuationAction,
  PostMatchContinuationInput,
} from "./PostMatchContinuationPolicy";

const fallbackContext: PostMatchContinuationInput = {
  isRanked: false,
  rivalryRevengeDelta: 0,
  nextGoalSaved: false,
  isAlive: false,
};

@customElement("post-match-continuation-card")
export class PostMatchContinuationCard extends LitElement {
  @property({ attribute: false }) context: PostMatchContinuationInput =
    fallbackContext;
  @property({ type: Boolean }) pending = false;

  createRenderRoot() {
    return this;
  }

  private activate() {
    if (this.pending) return;
    const continuation = selectPostMatchContinuation(this.context);
    this.dispatchEvent(
      new CustomEvent<{ action: PostMatchContinuationAction }>(
        "post-match-continue",
        {
          detail: { action: continuation.action },
          bubbles: true,
          composed: true,
        },
      ),
    );
  }

  render() {
    const continuation = selectPostMatchContinuation(this.context);
    return html`
      <button
        @click=${this.activate}
        class="group h-full w-full min-w-0 rounded-md border border-violet-300/45 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-left text-white shadow-lg shadow-violet-950/30 transition-all duration-200 hover:-translate-y-px hover:from-violet-500 hover:to-indigo-500 disabled:cursor-wait disabled:opacity-60 motion-reduce:transform-none motion-reduce:transition-none"
        data-recommended-action=${continuation.action}
        ?disabled=${this.pending}
      >
        <span
          class="block text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-100/80"
          >${continuation.eyebrow}</span
        >
        <span class="mt-0.5 block text-base font-bold"
          >${this.pending ? "Creating rematch…" : continuation.label}</span
        >
        <span class="mt-1 block text-[11px] leading-snug text-violet-100/85"
          >${continuation.reason}</span
        >
      </button>
    `;
  }
}
