import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import routeGraphJson from "../../shared/PublicRouteGraph.json";
import { isLoggedIn, obeliskLogin } from "../Auth";
import { createSupporterCheckoutSession } from "../SupporterApi";

interface PublicLink {
  href: string;
  label: string;
  i18n?: string;
  ariaI18n?: string;
}

const routeGraph = routeGraphJson as {
  brandHref: string;
  copyright: string;
  upstreamNotice: string;
  footerLinks: PublicLink[];
  appExternalLinks: PublicLink[];
};

@customElement("page-footer")
export class Footer extends LitElement {
  @state() private supportPending = false;

  createRenderRoot() {
    return this;
  }

  private async openSupporterCheckout() {
    if (this.supportPending) return;
    this.supportPending = true;
    if (!(await isLoggedIn())) {
      this.supportPending = false;
      obeliskLogin();
      return;
    }
    const url = await createSupporterCheckoutSession();
    this.supportPending = false;
    if (!url) {
      window.alert("Supporter checkout is temporarily unavailable.");
      return;
    }
    window.location.assign(url);
  }

  render() {
    return html`
      <footer
        class="[.in-game_&]:hidden bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-2 px-4 py-4 text-white/70 w-full border-t border-white/10 shrink-0 mt-auto text-center"
      >
        <a
          href=${routeGraph.brandHref}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-[11px] uppercase tracking-[0.16em] font-semibold text-cyan-300 hover:text-cyan-200 transition-colors"
        >
          A VaultSpark Studios production
        </a>
        <p class="text-xs">${routeGraph.copyright}</p>
        <nav
          aria-label="Project information"
          class="flex flex-wrap items-center justify-center gap-x-2 text-xs"
        >
          ${routeGraph.footerLinks.map(
            (link) => html`
              <a
                href=${link.href}
                data-i18n=${ifDefined(link.i18n)}
                data-i18n-aria-label=${ifDefined(link.ariaI18n)}
                class="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-white transition-colors"
                >${link.label}</a
              >
            `,
          )}
          ${routeGraph.appExternalLinks.map(
            (link) => html`
              <a
                href=${link.href}
                data-i18n=${ifDefined(link.i18n)}
                data-i18n-aria-label=${ifDefined(link.ariaI18n)}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-white transition-colors"
                >${link.label || nothing}</a
              >
            `,
          )}
          <button
            type="button"
            ?disabled=${this.supportPending}
            aria-label="Support VaultFront with a five dollar contribution"
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-cyan-400/35 px-3 text-cyan-200 hover:border-cyan-300 hover:text-white disabled:opacity-60 transition-colors"
            @click=${this.openSupporterCheckout}
          >
            ${this.supportPending ? "Opening…" : "Support $5"}
          </button>
        </nav>
        <p class="max-w-3xl text-[11px] leading-relaxed text-white/55">
          ${routeGraph.upstreamNotice}
        </p>
      </footer>
    `;
  }
}
