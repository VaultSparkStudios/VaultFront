import { subscribeNarrator } from "../../Api";
import { Layer } from "./Layer";

const VISIBLE_MS = 8_000;

/** Renders commentary whose source is the server's accepted-intent stream. */
export class CertifiedNarratorLayer implements Layer {
  private element: HTMLElement | null = null;
  private stop: (() => void) | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly gameId: string) {}

  init(): void {
    this.element = document.createElement("aside");
    this.element.id = "certified-narrator";
    this.element.hidden = true;
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    this.element.setAttribute("aria-atomic", "true");
    this.element.className =
      "fixed bottom-4 left-1/2 z-40 w-[min(92vw,38rem)] -translate-x-1/2 rounded-xl border border-sky-300/35 bg-slate-950/90 px-4 py-3 text-center text-sm font-semibold tracking-wide text-sky-50 shadow-2xl shadow-sky-950/50 backdrop-blur-md motion-safe:transition-opacity sm:bottom-6 sm:text-base";
    this.element.dataset.authority = "accepted-game-intent";
    document.body.append(this.element);

    this.stop = subscribeNarrator(this.gameId, (text) => this.present(text));
    window.addEventListener("pagehide", () => this.dispose(), { once: true });
  }

  private present(text: string): void {
    if (!this.element) return;
    this.element.textContent = text;
    this.element.hidden = false;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.element) this.element.hidden = true;
    }, VISIBLE_MS);
  }

  private dispose(): void {
    this.stop?.();
    this.stop = null;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.element?.remove();
    this.element = null;
  }
}
