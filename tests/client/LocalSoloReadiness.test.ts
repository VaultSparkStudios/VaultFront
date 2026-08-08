import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBase, getAudience } from "../../src/client/Api";
import { GameEnv } from "../../src/core/configuration/Config";
import { isLoopbackHostname } from "../../src/core/RuntimeUrls";

describe("local Solo readiness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    localStorage.clear();
  });

  it("classifies every supported loopback spelling without inventing api.0.1", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("vaultsparkstudios.com")).toBe(false);

    expect(getAudience()).toBe("localhost");
    expect(getApiBase()).toBe("http://localhost:8787");
  });

  it("uses the embedded config for loopback Solo play when /api/env is SPA HTML", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<!doctype html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getServerConfigFromClient } =
      await import("../../src/core/configuration/ConfigLoader");

    const config = await getServerConfigFromClient();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/env$/u),
    );
    expect(config.env()).toBe(GameEnv.Dev);
  });
});
