import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { GameModeSelector } from "../../src/client/GameModeSelector";

describe("GameModeSelector landing layout", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("reserves one final-card footprint while live lobbies are pending", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const selector = new GameModeSelector();

    render(selector.render(), host);

    const grid = host.querySelector(".min-h-44");
    const pending = host.querySelector('[role="status"]');
    expect(grid).not.toBeNull();
    expect(pending?.textContent).toContain("Loading battlefronts");
    expect(pending?.classList.contains("h-44")).toBe(true);
  });
});
