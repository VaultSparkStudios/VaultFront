import { afterEach, describe, expect, it } from "vitest";
import { initLayout } from "../../src/client/Layout";

describe("mobile drawer accessibility state", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove("overflow-hidden");
  });

  it("initializes closed and keeps visual and ARIA state synchronized", async () => {
    if (!customElements.get("play-page")) {
      customElements.define("play-page", class extends HTMLElement {});
    }
    document.body.innerHTML = `
      <button id="hamburger-btn" aria-expanded="true"></button>
      <div id="mobile-menu-backdrop" class="open" aria-hidden="false"></div>
      <mobile-nav-bar id="sidebar-menu" class="open" role="dialog" aria-modal="true"></mobile-nav-bar>
    `;

    await initLayout();

    const button = document.getElementById("hamburger-btn")!;
    const sidebar = document.getElementById("sidebar-menu")!;
    const backdrop = document.getElementById("mobile-menu-backdrop")!;
    expect(sidebar.classList.contains("open")).toBe(false);
    expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    expect(sidebar.hasAttribute("aria-modal")).toBe(false);
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    button.click();
    expect(sidebar.classList.contains("open")).toBe(true);
    expect(sidebar.getAttribute("aria-hidden")).toBe("false");
    expect(sidebar.getAttribute("aria-modal")).toBe("true");
    expect(backdrop.getAttribute("aria-hidden")).toBe("false");
    expect(button.getAttribute("aria-expanded")).toBe("true");

    button.click();
    expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    expect(sidebar.hasAttribute("aria-modal")).toBe(false);
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
  });
});
