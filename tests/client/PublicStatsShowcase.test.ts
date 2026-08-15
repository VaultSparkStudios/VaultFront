import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPublicStatsFeedStale,
  normalizePublicStatsFeed,
} from "../../src/client/components/PublicStatsShowcase";

const feed = {
  generatedAt: "2026-08-12T20:25:00.000Z",
  refreshSeconds: 86_400,
  showcase: ["players", "loops", "minutes"],
  metrics: [
    {
      id: "players",
      label: "Players",
      value: null,
      computedAt: "2026-08-12T20:25:00.000Z",
      available: false,
    },
    {
      id: "loops",
      label: "Loops",
      value: null,
      computedAt: "2026-08-12T20:25:00.000Z",
      available: false,
    },
    {
      id: "minutes",
      label: "Minutes",
      value: null,
      computedAt: "2026-08-12T20:25:00.000Z",
      available: false,
    },
  ],
};

describe("PublicStatsShowcase", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    delete window.showPage;
  });
  it("admits one bounded homepage showcase from the Analytica feed", () => {
    expect(normalizePublicStatsFeed(feed)).toMatchObject({
      refreshSeconds: 86_400,
      showcase: ["players", "loops", "minutes"],
    });
  });

  it("marks the feed stale only after twice its declared refresh window", () => {
    const normalized = normalizePublicStatsFeed(feed)!;
    const observed = Date.parse(feed.generatedAt);
    expect(isPublicStatsFeedStale(normalized, observed + 86_400_000)).toBe(
      false,
    );
    expect(isPublicStatsFeedStale(normalized, observed + 172_800_001)).toBe(
      true,
    );
  });

  it("rejects a tile with fewer than three curated metrics", () => {
    expect(
      normalizePublicStatsFeed({ ...feed, showcase: ["players"] }),
    ).toBeNull();
  });

  it("reserves the full Alpha corridor before the signed feed resolves", async () => {
    let resolveFeed!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFeed = resolve;
          }),
      ),
    );
    const showcase = document.createElement(
      "public-stats-showcase",
    ) as HTMLElement & { updateComplete: Promise<unknown> };
    document.body.append(showcase);
    await showcase.updateComplete;

    const section = showcase.shadowRoot!.querySelector("section")!;
    expect(section.getAttribute("aria-busy")).toBe("true");
    expect(section.querySelectorAll("article")).toHaveLength(3);
    expect(section.querySelector(".alpha-corridor")).not.toBeNull();
    expect(section.querySelector("button")?.textContent).toContain(
      "Join the Alpha",
    );

    resolveFeed(
      new Response(JSON.stringify(feed), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await showcase.updateComplete;
    expect(section.getAttribute("aria-busy")).toBe("false");
    expect(section.querySelectorAll("article")).toHaveLength(3);
  });

  it("routes a signed-out visitor through the Studio account boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify(feed), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    window.showPage = vi.fn();
    const showcase = document.createElement(
      "public-stats-showcase",
    ) as HTMLElement & { updateComplete: Promise<unknown> };
    document.body.append(showcase);
    await showcase.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await showcase.updateComplete;

    const button = showcase.shadowRoot!.querySelector("button")!;
    expect(button.textContent).toContain("Join the Alpha");
    button.click();

    expect(window.showPage).toHaveBeenCalledWith("page-account");
  });

  it("routes an authenticated contributor into existing matchmaking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify(feed), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const onMatchmaking = vi.fn();
    document.addEventListener("open-matchmaking", onMatchmaking, {
      once: true,
    });
    const showcase = document.createElement(
      "public-stats-showcase",
    ) as HTMLElement & { updateComplete: Promise<unknown> };
    document.body.append(showcase);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: { player: { publicId: "human-alpha-1" } },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await showcase.updateComplete;

    const button = showcase.shadowRoot!.querySelector("button")!;
    expect(button.textContent).toContain("Find an Alpha match");
    button.click();

    expect(onMatchmaking).toHaveBeenCalledOnce();
  });
});
