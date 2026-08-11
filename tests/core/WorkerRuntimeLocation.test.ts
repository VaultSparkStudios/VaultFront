import { afterEach, describe, expect, it, vi } from "vitest";
import { gameServiceHttpUrl } from "../../src/core/RuntimeUrls";

describe("Web Worker runtime location", () => {
  const originalOrigin = process.env.GAME_SERVICE_ORIGIN;

  afterEach(() => {
    if (originalOrigin === undefined) {
      delete process.env.GAME_SERVICE_ORIGIN;
    } else {
      process.env.GAME_SERVICE_ORIGIN = originalOrigin;
    }
    vi.unstubAllGlobals();
  });

  it("resolves the game service without a Window global", () => {
    delete process.env.GAME_SERVICE_ORIGIN;
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("location", {
      origin: "http://localhost:9000",
      hostname: "localhost",
      host: "localhost:9000",
      protocol: "http:",
      pathname: "/",
    });

    expect(gameServiceHttpUrl("/api/env")).toBe(
      "http://localhost:9000/api/env",
    );
  });
});
