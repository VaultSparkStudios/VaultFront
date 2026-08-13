import { LitElement, html, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwindStyles from "../../styles.css?inline";

@customElement("o-modal")
export class OModal extends LitElement {
  static styles = [unsafeCSS(tailwindStyles)];

  @state() public isModalOpen = false;

  static openCount = 0;
  private static readonly stack: OModal[] = [];
  private static readonly originalInert = new Map<HTMLElement, boolean>();
  private static nextDialogId = 0;

  private readonly titleId = `o-modal-title-${++OModal.nextDialogId}`;
  private opener: HTMLElement | null = null;

  @property({ type: Boolean })
  public inline = false;

  @property({ type: Boolean })
  public alwaysMaximized = false;

  @property({ type: Boolean })
  public hideCloseButton = false;

  @property({ type: String })
  public title = "";

  @property({ type: Boolean })
  public hideHeader = false;

  @property({ type: String })
  public maxWidth = "";

  public onClose?: () => void;

  public open() {
    if (!this.isModalOpen) {
      if (!this.inline) {
        this.opener =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        OModal.openCount = OModal.openCount + 1;
        if (OModal.openCount === 1) document.body.style.overflow = "hidden";
        OModal.stack.push(this);
        OModal.applyIsolation();
      }
      this.isModalOpen = true;
      void this.updateComplete.then(() => this.focusInitialControl());
    }
  }

  public close() {
    if (this.isModalOpen) {
      this.isModalOpen = false;
      this.onClose?.();
      if (!this.inline) {
        const stackIndex = OModal.stack.lastIndexOf(this);
        if (stackIndex >= 0) OModal.stack.splice(stackIndex, 1);
        OModal.applyIsolation();
        OModal.openCount = Math.max(0, OModal.openCount - 1);
        if (OModal.openCount === 0) document.body.style.overflow = "";
        const opener = this.opener;
        this.opener = null;
        queueMicrotask(() => opener?.isConnected && opener.focus());
      }
    }
  }

  disconnectedCallback() {
    // Ensure global counter is decremented if this modal is removed while open.
    if (this.isModalOpen && !this.inline) {
      const stackIndex = OModal.stack.lastIndexOf(this);
      if (stackIndex >= 0) OModal.stack.splice(stackIndex, 1);
      OModal.applyIsolation();
      OModal.openCount = Math.max(0, OModal.openCount - 1);
      if (OModal.openCount === 0) document.body.style.overflow = "";
    }
    super.disconnectedCallback();
  }

  private static restoreIsolation(): void {
    for (const [element, inert] of OModal.originalInert) element.inert = inert;
    OModal.originalInert.clear();
  }

  private static applyIsolation(): void {
    OModal.restoreIsolation();
    const top = OModal.stack.at(-1);
    if (!top?.isConnected) return;
    let branch: Element = top;
    let parent: Element | null = top.parentElement;
    while (parent) {
      for (const sibling of parent.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
        OModal.originalInert.set(sibling, sibling.inert);
        sibling.inert = true;
      }
      branch = parent;
      parent = parent.parentElement;
    }
  }

  private dialog(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>("[role='dialog']");
  }

  private focusable(): HTMLElement[] {
    const selector =
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    return [
      ...(this.dialog()?.querySelectorAll<HTMLElement>(selector) ?? []),
      ...this.querySelectorAll<HTMLElement>(selector),
    ].filter((element) => !element.hidden && !element.inert);
  }

  private activeElement(): Element | null {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  private focusInitialControl(): void {
    if (!this.isModalOpen || this.inline) return;
    const dialog = this.dialog();
    const initial =
      dialog?.querySelector<HTMLElement>("[autofocus]") ??
      this.focusable()[0] ??
      dialog;
    initial?.focus();
  }

  private handleDialogKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = this.focusable();
    if (controls.length === 0) {
      event.preventDefault();
      this.dialog()?.focus();
      return;
    }
    event.preventDefault();
    const currentIndex = controls.indexOf(this.activeElement() as HTMLElement);
    const delta = event.shiftKey ? -1 : 1;
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + delta + controls.length) % controls.length;
    controls[nextIndex].focus();
  }

  render() {
    const backdropClass = this.inline
      ? "relative z-10 w-full h-full flex items-stretch bg-transparent"
      : "fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center overflow-hidden";

    const wrapperClass = this.inline
      ? "relative flex flex-col w-full h-full m-0 max-w-full max-h-none shadow-none"
      : `relative flex flex-col w-full h-full lg:w-[90%] lg:h-auto lg:min-w-[400px] lg:max-w-[900px] lg:m-8 lg:rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.8)] lg:max-h-[calc(100vh-4rem)] ${
          this.alwaysMaximized ? "h-auto" : ""
        }`;
    const wrapperStyle =
      !this.inline && this.maxWidth ? `max-width: ${this.maxWidth};` : "";

    return html`
      ${
        this.isModalOpen
          ? html`
              <aside
                class="${backdropClass}"
                @click=${this.inline ? null : () => this.close()}
              >
                <div
                  role="dialog"
                  aria-modal=${this.inline ? "false" : "true"}
                  aria-labelledby=${
                    !this.hideHeader && this.title ? this.titleId : undefined
                  }
                  aria-label=${
                    !this.hideHeader && this.title
                      ? undefined
                      : this.title || "Dialog"
                  }
                  tabindex="-1"
                  @keydown=${this.handleDialogKeyDown}
                  @click=${(e: Event) => e.stopPropagation()}
                  class="${wrapperClass}"
                  style="${wrapperStyle}"
                >
                  ${
                    this.inline || this.hideCloseButton
                      ? html``
                      : html`<button
                          type="button"
                          class="absolute top-3 right-3 z-10 flex min-h-11 min-w-11 items-center justify-center rounded text-white cursor-pointer hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                          aria-label=${`Close ${this.title || "dialog"}`}
                          @click=${() => this.close()}
                        >
                          ✕
                        </button>`
                  }
                  ${
                    !this.hideHeader && this.title
                      ? html`<div
                          id=${this.titleId}
                          class="px-[1.4rem] py-[1rem] text-2xl font-bold text-white"
                        >
                          ${this.title}
                        </div>`
                      : html``
                  }
                  <section
                    class="relative flex-1 min-h-0 p-0 lg:p-[1.4rem] text-[var(--vf-panel-text)] bg-[var(--vf-modal-bg)] backdrop-blur-md lg:rounded-lg overflow-y-auto"
                  >
                    <slot></slot>
                  </section>
                </div>
              </aside>
            `
          : html``
      }
    `;
  }
}
