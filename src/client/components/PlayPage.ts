import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("play-page")
export class PlayPage extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        id="page-play"
        class="vf-main-shell flex flex-col gap-2 w-full px-0 lg:px-4 lg:my-auto min-h-0 rounded-none lg:rounded-2xl"
      >
        <token-login class="absolute"></token-login>
        <div class="vf-main-content flex flex-col gap-2 min-h-0">
          <!-- Mobile: Fixed top bar -->
          <div
            class="lg:hidden fixed left-0 right-0 top-0 z-40 pt-[env(safe-area-inset-top)] bg-gradient-to-r from-slate-950 via-slate-900 to-[#0c2a38] border-b border-cyan-400/25"
          >
            <div
              class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center h-14 px-2 gap-2"
            >
              <button
                id="hamburger-btn"
                class="col-start-1 justify-self-start h-10 shrink-0 aspect-[4/3] flex text-white/90 rounded-md items-center justify-center transition-colors"
                data-i18n-aria-label="main.menu"
                aria-expanded="false"
                aria-controls="sidebar-menu"
                aria-haspopup="dialog"
                data-i18n-title="main.menu"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="size-8"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                </svg>
              </button>

              <div class="col-start-2 flex items-center justify-center min-w-0">
                <div
                  class="vf-brand-wordmark text-[17px] font-black tracking-[0.18em] uppercase text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-sky-200 to-amber-300 drop-shadow-[0_0_14px_rgba(34,211,238,0.45)] shrink-0"
                >
                  VaultFront
                </div>
              </div>

              <div
                aria-hidden="true"
                class="col-start-3 justify-self-end h-10 shrink-0 aspect-[4/3]"
              ></div>
            </div>
          </div>

          <div
            class="w-full pb-4 lg:pb-0 flex flex-col gap-0 lg:grid lg:grid-cols-12 lg:gap-2"
          >
            <!-- Mobile: spacer for fixed top bar -->
            <div
              class="lg:hidden h-[calc(env(safe-area-inset-top)+56px)]"
            ></div>

            <div class="lg:col-span-12 px-2 lg:px-0 mb-2">
              <div class="vf-glass-surface vf-hero-card">
                <div class="vf-kicker">The Vault War Is Live</div>
                <div class="vf-headline">
                  Capture the vaults. Command the convoys. Break the front.
                </div>
                <div class="vf-subhead mt-1">
                  Claim extraction sites, escort your haul or intercept theirs,
                  then turn three deliveries into a 90-second Breach Window.
                </div>
                <div class="vf-chip-row mt-2">
                  <span class="vf-chip">Capture Vaults</span>
                  <span class="vf-chip">Escort or Intercept</span>
                  <span class="vf-chip">Deliver the Breach</span>
                </div>
              </div>
            </div>

            <div
              class="vf-glass-surface px-2 py-2 overflow-visible lg:col-span-9 lg:flex lg:items-center lg:gap-x-2 lg:h-[60px] lg:p-3 lg:relative lg:z-20 lg:border-y-0 lg:rounded-xl"
            >
              <div class="flex items-center gap-2 min-w-0 w-full">
                <username-input
                  class="flex-1 min-w-0 h-10 lg:h-[50px]"
                ></username-input>
                <pattern-input
                  id="pattern-input-mobile"
                  show-select-label
                  adaptive-size
                  class="shrink-0 lg:hidden"
                ></pattern-input>
              </div>
            </div>

            <div class="hidden lg:flex lg:col-span-3 h-[60px] gap-2">
              <pattern-input
                id="pattern-input-desktop"
                show-select-label
                class="vf-glass-surface flex-1 h-full rounded-xl"
              ></pattern-input>
              <flag-input
                id="flag-input-desktop"
                show-select-label
                class="vf-glass-surface flex-1 h-full rounded-xl"
              ></flag-input>
            </div>
          </div>

          <game-mode-selector></game-mode-selector>
        </div>
      </div>
    `;
  }
}
