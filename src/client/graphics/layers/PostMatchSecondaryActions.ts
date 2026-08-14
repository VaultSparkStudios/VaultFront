import { html, type TemplateResult } from "lit";
import type { PostMatchContinuationAction } from "../../PostMatchContinuationPolicy";

interface PostMatchSecondaryActionsInput {
  continuationAction: PostMatchContinuationAction;
  mutatorVote: TemplateResult | null;
  shareCopied: boolean;
  rematchPending: boolean;
  rematchResult: { joinUrl: string } | null;
  rematchError: string | null;
  highlightCopied: boolean;
  replayHighlight: {
    shareUrl: string;
    ogTitle: string;
    topMoment: string;
  } | null;
  shareCardCopied: boolean;
  onShare: () => unknown;
  onRematch: () => unknown;
  onShareHighlight: () => unknown;
  onShareCard: () => unknown;
}

/** Render optional post-match actions behind one secondary disclosure. */
export function renderPostMatchSecondaryActions(
  input: PostMatchSecondaryActionsInput,
) {
  return html`<details
    data-post-match-secondary
    class="rounded-md border border-slate-500/40 bg-slate-900/35"
  >
    <summary
      class="min-h-11 cursor-pointer px-3 py-2 text-sm font-semibold text-slate-200 flex items-center justify-between gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
    >
      <span>More rewards &amp; sharing</span>
      <span class="text-xs text-slate-400" aria-hidden="true">Optional</span>
    </summary>
    <div class="border-t border-slate-500/30 p-3 flex flex-col gap-2.5">
      ${input.mutatorVote}
      <div class="flex flex-wrap justify-between gap-2.5">
        <button
          @click=${input.onShare}
          class="min-h-11 min-w-32 flex-1 px-3 py-2 text-sm cursor-pointer bg-green-600/70 text-white border-0 rounded-sm transition-all duration-200 hover:bg-green-600/90 hover:-translate-y-px active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          ${input.shareCopied ? "Link copied!" : "Share Match"}
        </button>
        ${
          input.continuationAction === "rematch"
            ? null
            : html`<button
                @click=${input.onRematch}
                class="min-h-11 min-w-32 flex-1 px-3 py-2 text-sm cursor-pointer bg-orange-500/70 text-white border-0 rounded-sm transition-all duration-200 hover:bg-orange-500/90 hover:-translate-y-px active:translate-y-px disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                ?disabled=${input.rematchPending}
              >
                ${
                  input.rematchPending
                    ? "Creating rematch…"
                    : input.rematchResult
                      ? "Open rematch lobby"
                      : input.rematchError
                        ? "Retry rematch"
                        : "Rematch"
                }
              </button>`
        }
        <button
          @click=${input.onShareHighlight}
          class="min-h-11 min-w-32 flex-1 px-3 py-2 text-sm cursor-pointer bg-indigo-600/70 text-white border-0 rounded-sm transition-all duration-200 hover:bg-indigo-600/90 hover:-translate-y-px active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          ${input.highlightCopied ? "Clip copied!" : "Share Clip"}
        </button>
        ${
          input.replayHighlight
            ? html`<a
                href=${input.replayHighlight.shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="min-h-11 min-w-32 flex-1 px-3 py-2 text-sm cursor-pointer bg-violet-600/70 text-white border-0 rounded-sm transition-all duration-200 hover:bg-violet-600/90 hover:-translate-y-px text-center no-underline flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                title="${input.replayHighlight.ogTitle}"
              >
                ▶ Watch Highlight<br /><span
                  class="text-[10px] text-violet-200/80"
                  >${input.replayHighlight.topMoment}</span
                >
              </a>`
            : ""
        }
      </div>
      ${
        input.rematchResult
          ? html`<a
              href=${input.rematchResult.joinUrl}
              class="block text-xs text-center text-orange-200 underline underline-offset-2"
              >Rematch lobby ready · join before it expires</a
            >`
          : input.rematchError
            ? html`<p class="text-xs text-center text-red-300" role="alert">
                ${input.rematchError}
              </p>`
            : ""
      }
      <div class="flex justify-end">
        <button
          @click=${input.onShareCard}
          class="min-h-11 px-3 py-2 text-xs cursor-pointer bg-teal-600/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-teal-600/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          ${input.shareCardCopied ? "Card saved!" : "Save Result Card"}
        </button>
      </div>
    </div>
  </details>`;
}
