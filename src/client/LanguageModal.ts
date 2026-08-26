import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";

interface LanguageOption {
  code: string;
  svg: string;
  native: string;
  en: string;
}

@customElement("language-modal")
export class LanguageModal extends BaseModal {
  @property({ type: Array }) languageList: LanguageOption[] = [];
  @property({ type: String }) currentLang = "en";
  @state() private flagAssetsReady = false;

  private flagLoadFrame: number | null = null;
  private flagLoadTimer: number | null = null;

  protected override onOpen(): void {
    this.flagAssetsReady = false;
    this.cancelFlagHydration();
    // Let the text-first language grid paint and become interactive before
    // decorative flag requests begin. Fixed-size placeholders prevent layout
    // shift, and closing quickly cancels the asset burst entirely.
    this.flagLoadFrame = requestAnimationFrame(() => {
      this.flagLoadFrame = null;
      this.flagLoadTimer = window.setTimeout(() => {
        this.flagLoadTimer = null;
        if (this.isModalOpen) this.flagAssetsReady = true;
      }, 250);
    });
  }

  protected override onClose(): void {
    this.cancelFlagHydration();
    this.flagAssetsReady = false;
  }

  private cancelFlagHydration(): void {
    if (this.flagLoadFrame !== null) cancelAnimationFrame(this.flagLoadFrame);
    if (this.flagLoadTimer !== null) clearTimeout(this.flagLoadTimer);
    this.flagLoadFrame = null;
    this.flagLoadTimer = null;
  }

  private selectLanguage = (lang: string) => {
    this.dispatchEvent(
      new CustomEvent("language-selected", {
        detail: { lang },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  };

  render() {
    const content = html`
      <div
        class="${this.modalContainerClass}"
        style="backdrop-filter: none; -webkit-backdrop-filter: none; contain: paint;"
      >
        <!-- Header -->
        ${modalHeader({
          title: translateText("select_lang.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
        })}

        <div
          class="flex-1 overflow-y-auto custom-scrollbar p-2"
        >
          <div
            data-language-flags-ready=${String(this.flagAssetsReady)}
            class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
          >
            ${this.languageList.map((lang) => {
              const isActive = this.currentLang === lang.code;
              const isDebug = lang.code === "debug";

              let buttonClasses =
                "relative group rounded-xl border transition-all duration-200 flex items-center p-3 gap-3 w-full cursor-pointer";

              if (isDebug) {
                buttonClasses +=
                  " animate-pulse font-bold text-white border-2 border-dashed border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)] bg-gradient-to-r from-red-600 via-yellow-600 via-green-600 via-blue-600 to-purple-600";
              } else if (isActive) {
                buttonClasses += " bg-blue-500/20 border-blue-500/50";
              } else {
                buttonClasses +=
                  " bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20";
              }

              return html`
                <button
                  class="${buttonClasses}"
                  style="content-visibility: auto; contain-intrinsic-size: 68px;"
                  @click=${() => this.selectLanguage(lang.code)}
                >
                  ${
                    this.flagAssetsReady
                      ? html`<img
                          src="/flags/${lang.svg}.svg"
                          class="w-8 h-6 object-contain rounded-sm shrink-0"
                          alt=""
                          decoding="async"
                          fetchpriority="low"
                        />`
                      : html`<span
                          aria-hidden="true"
                          class="w-8 h-6 rounded-sm shrink-0 border border-[var(--vf-border)] bg-[var(--vf-panel-bg)]"
                        ></span>`
                  }
                  <div class="flex flex-col items-start min-w-0">
                    <span
                      class="text-sm font-bold uppercase tracking-wider whitespace-normal break-words w-full text-left ${
                        isActive
                          ? "text-[var(--vf-panel-text)]"
                          : "text-[var(--vf-panel-text)] group-hover:text-[var(--vf-text)]"
                      }"
                      >${lang.native}</span
                    >
                    <span
                      class="text-xs text-[var(--vf-panel-muted)] uppercase tracking-widest group-hover:text-[var(--vf-panel-text)] transition-colors whitespace-normal break-words w-full text-left"
                      >${lang.en}</span
                    >
                  </div>

                  ${
                    isActive
                      ? html`
                          <div class="ml-auto text-blue-400 shrink-0">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              class="w-5 h-5"
                            >
                              <path
                                fill-rule="evenodd"
                                d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
                                clip-rule="evenodd"
                              />
                            </svg>
                          </div>
                        `
                      : ""
                  }
                </button>
              `;
            })}
            </div>
          </div>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        title=${translateText("select_lang.title")}
        ?inline=${this.inline}
        .onClose=${this.close.bind(this)}
        hideHeader
        hideCloseButton
      >
        ${content}
      </o-modal>
    `;
  }
}
