import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  recordVaultFrontPlaytestPulse: vi.fn(async () => true),
}));

vi.mock("../../src/client/Api", () => ({
  recordVaultFrontPlaytestPulse: apiMock.recordVaultFrontPlaytestPulse,
}));

import "../../src/client/VaultFrontTutorial";

describe("VaultFrontTutorial", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = "";
    apiMock.recordVaultFrontPlaytestPulse.mockClear();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 640px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("renders a mobile strip, advances, and records tutorial pulse events", async () => {
    const el = document.createElement("vault-front-tutorial") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.appendChild(el);

    await vi.advanceTimersByTimeAsync(800);
    await el.updateComplete;

    const strip = el.shadowRoot?.querySelector(".strip");
    expect(strip).toBeTruthy();
    expect(strip?.textContent).toContain("Find the First Extraction tracker");
    expect(strip?.textContent).toContain("1/2");
    expect(apiMock.recordVaultFrontPlaytestPulse).toHaveBeenCalledWith({
      surface: "tutorial",
      event: "shown",
    });

    const next = Array.from(
      el.shadowRoot?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Next")) as
      HTMLButtonElement | undefined;
    next?.click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector(".strip")?.textContent).toContain(
      "Build Pressure, then breach",
    );
    expect(el.shadowRoot?.querySelector(".strip")?.textContent).toContain(
      "Three convoy deliveries open a 90-second Breach Window",
    );
    expect(apiMock.recordVaultFrontPlaytestPulse).toHaveBeenCalledWith({
      surface: "tutorial",
      event: "advance",
    });

    const close = el.shadowRoot?.querySelector(
      ".strip-close",
    ) as HTMLButtonElement | null;
    close?.click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector(".strip")).toBeNull();
    expect(localStorage.getItem("vf-tutorial-seen")).toBe("2");
    expect(apiMock.recordVaultFrontPlaytestPulse).toHaveBeenCalledWith({
      surface: "tutorial",
      event: "skip",
    });
  });

  it("uses the same two-step First Extraction vocabulary on desktop", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const el = document.createElement("vault-front-tutorial") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(800);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".card")?.textContent).toContain(
      "Find the First Extraction tracker",
    );
    expect(el.shadowRoot?.querySelectorAll(".progress-dot")).toHaveLength(2);
  });
});
