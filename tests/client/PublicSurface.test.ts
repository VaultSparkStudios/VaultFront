import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const publicPages = [
  "about",
  "docs",
  "stats",
  "contact",
  "privacy",
  "terms",
  "ip",
];

describe("public launch foundation", () => {
  it("ships the exact Studio footer and upstream attribution on every leaf page", () => {
    for (const page of publicPages) {
      const html = read(`public/${page}/index.html`);
      expect(html).toContain(
        "© 2026 VaultSpark Studios LLC. All rights reserved.",
      );
      expect(html).toContain("https://vaultsparkstudios.com");
      expect(html).toContain("OpenFrontIO");
      expect(html).toContain("LICENSING.md");
      expect(html).toContain('type="application/ld+json"');
    }
  });

  it("keeps contact delivery evidence honest before launch", () => {
    const contact = read("public/contact/index.html");
    expect(contact).toContain("contact@vaultfront.io");
    expect(contact).not.toContain("contact@vaultfront.vaultsparkstudios.com");
    expect(contact).not.toContain("founder@vaultsparkstudios.com");
    const agents = read("public/agents.json");
    expect(agents).toContain("contact@vaultfront.io");
    expect(agents).not.toContain("founder@vaultsparkstudios.com");
    expect(contact).toContain("remain a release gate");
  });

  it("publishes parseable agent metadata without fictional write capabilities", () => {
    const descriptor = JSON.parse(read("public/agents.json"));
    expect(descriptor).toMatchObject({
      project: "vaultfront",
      vaultStatus: "FORGE",
      releaseStatus: "public-unlaunched",
      agentInteractions: expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/balance-envelope.json",
        }),
        expect.objectContaining({
          method: "GET",
          path: "/stats.json",
        }),
      ]),
      authentication: {
        status: "staging-observed-production-unavailable",
        flow: "authorization-code-pkce",
        entrypoint: "/auth/login",
      },
      availability: { publicRuntime: "unavailable" },
    });
    expect(
      descriptor.agentInteractions.every(
        (interaction: { method: string }) => interaction.method === "GET",
      ),
    ).toBe(true);
    expect(descriptor.rights.code).toContain("AGPL-3.0");
  });

  it("lists every local public page in the sitemap and exposes AI discovery", () => {
    const sitemap = read("public/sitemap.xml");
    expect(sitemap).toContain("https://vaultfront.io/");
    expect(sitemap).not.toContain("play-vaultfront.vaultsparkstudios.com");
    for (const page of publicPages) {
      expect(read(`public/${page}/index.html`)).toContain(
        'name="robots" content="noindex,follow"',
      );
    }
    expect(read("public/.well-known/llms.txt")).toContain(
      "public-unlaunched alpha",
    );
    expect(read("index.html")).toContain('type="application/ld+json"');
    expect(read("index.html")).toContain('name="twitter:card"');
  });

  it("renders the application footer with legal and attribution links", () => {
    const footer = read("src/client/components/Footer.ts");
    const routeGraph = JSON.parse(read("src/shared/PublicRouteGraph.json")) as {
      copyright: string;
      upstreamNotice: string;
      footerLinks: Array<{ href: string }>;
    };
    expect(routeGraph.copyright).toBe(
      "© 2026 VaultSpark Studios LLC. All rights reserved.",
    );
    expect(routeGraph.footerLinks.map((link) => link.href)).toEqual(
      expect.arrayContaining(["/contact/", "/ip/"]),
    );
    expect(routeGraph.upstreamNotice).toContain("Based on OpenFrontIO");
    expect(footer).toContain("routeGraph.footerLinks.map");
    expect(footer).toContain("routeGraph.copyright");
    expect(footer).toContain("routeGraph.upstreamNotice");
    expect(footer).toContain("inline-flex min-h-11 min-w-11");
    expect(footer).toContain("createSupporterCheckoutSession");
    expect(footer).toContain("Support $5");
  });

  it("keeps primary mobile navigation controls at the 44px touch floor", () => {
    expect(read("src/client/components/PlayPage.ts")).toContain(
      'id="hamburger-btn"\n                class="col-start-1 justify-self-start h-11 min-w-14',
    );
    expect(read("src/client/LangSelector.ts")).toContain(
      "flex min-h-11 min-w-11",
    );
    expect(read("src/client/GameStartingModal.ts")).toContain(
      "inline-flex min-h-11 min-w-11",
    );
  });

  it("reveals the application shell at DOM readiness instead of media load", () => {
    const shell = read("index.html");
    expect(shell).toContain(
      'window.addEventListener("DOMContentLoaded", function ()',
    );
    expect(shell).not.toContain('window.addEventListener("load", function ()');
    expect(shell).toContain("}, 1000);");
  });

  it("keeps optional audio and offscreen language choices out of startup work", () => {
    const sound = read("src/client/sound/SoundManager.ts");
    expect(sound.match(/preload: false/g)).toHaveLength(3);
    expect(sound).toContain('track.state() === "unloaded"');
    expect(sound).toContain("track.load()");

    const languages = read("src/client/LanguageModal.ts");
    expect(languages).toContain("content-visibility: auto");
    expect(languages).toContain('loading="lazy"');
    expect(languages).toContain('decoding="async"');
  });
});
