import { LitElement, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import routeGraphJson from "../../shared/PublicRouteGraph.json";

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
  createRenderRoot() {
    return this;
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
          class="text-[11px] uppercase tracking-[0.16em] font-semibold text-cyan-300 hover:text-cyan-200 transition-colors"
        >
          A VaultSpark Studios production
        </a>
        <p class="text-xs">${routeGraph.copyright}</p>
        <nav
          aria-label="Project information"
          class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs"
        >
          ${routeGraph.footerLinks.map(
            (link) => html`
              <a
                href=${link.href}
                data-i18n=${ifDefined(link.i18n)}
                data-i18n-aria-label=${ifDefined(link.ariaI18n)}
                class="hover:text-white transition-colors"
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
                class="hover:text-white transition-colors"
                >${link.label || nothing}</a
              >
            `,
          )}
        </nav>
        <p class="max-w-3xl text-[11px] leading-relaxed text-white/55">
          ${routeGraph.upstreamNotice}
        </p>
      </footer>
    `;
  }
}
