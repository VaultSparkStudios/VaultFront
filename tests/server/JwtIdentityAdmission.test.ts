import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../../src/core/configuration/Config";
import { getUserMe } from "../../src/server/jwt";

const config = {
  jwtIssuer: () => "https://identity.example",
} as ServerConfig;

const validUser = {
  user: { email: "player@example.test" },
  player: { publicId: "player-1", roles: ["player"] },
};

function fetchMock(implementation: typeof fetch): typeof fetch {
  return vi.fn(implementation) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bounded identity introspection", () => {
  it("returns a validated user and binds bearer auth plus an abort signal", async () => {
    const fetchImpl = fetchMock(async (_input, init) => {
      expect(init?.headers).toEqual({ authorization: "Bearer token-1" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify(validUser), { status: 200 });
    });

    await expect(
      getUserMe("token-1", config, { fetchImpl, timeoutMs: 100 }),
    ).resolves.toEqual({ type: "success", response: validUser });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://identity.example/users/@me",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("normalizes non-success and invalid-schema responses", async () => {
    const rejected = fetchMock(
      async () => new Response("denied", { status: 403 }),
    );
    await expect(
      getUserMe("token", config, { fetchImpl: rejected }),
    ).resolves.toEqual({
      type: "error",
      message: "Identity provider rejected request (403)",
    });

    const invalid = fetchMock(
      async () => new Response(JSON.stringify({ player: {} }), { status: 200 }),
    );
    await expect(
      getUserMe("token", config, { fetchImpl: invalid }),
    ).resolves.toEqual({
      type: "error",
      message: "Identity provider returned an invalid response",
    });
  });

  it("normalizes provider failures without exposing exception text", async () => {
    const fetchImpl = fetchMock(async () => {
      throw new Error("socket details and private host");
    });
    await expect(getUserMe("token", config, { fetchImpl })).resolves.toEqual({
      type: "error",
      message: "Identity provider request failed",
    });
  });

  it("aborts a provider that never settles and clears its deadline", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const fetchImpl = fetchMock(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    await expect(
      getUserMe("token", config, { fetchImpl, timeoutMs: 5 }),
    ).resolves.toEqual({
      type: "error",
      message: "Identity provider request timed out",
    });
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
