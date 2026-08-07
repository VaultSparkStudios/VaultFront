import { describe, expect, test, vi } from "vitest";
import { registerAchievementRoutes } from "../../src/server/AchievementRouter";

function response() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function harness(actorId: string | null = "player-1") {
  const routes = new Map<string, any>();
  const app = {
    get: (path: string, ...handlers: any[]) =>
      routes.set(`GET ${path}`, handlers.at(-1)),
  };
  const getProgress = vi.fn(() => [{ id: "first_vault" }]);
  const getMetaChainProgress = vi.fn(() => [{ id: "vault_sovereign" }]);
  const ensureHydrated = vi.fn().mockResolvedValue({ status: "ready" });
  const getHydrationState = vi.fn(() => ({
    status: "ready",
    source: "postgres",
  }));
  registerAchievementRoutes(app, {
    authenticate: async (_req, res) => {
      if (actorId) return { persistentId: actorId, actorKey: "actor-key" };
      res.status(401).json({ error: "Authenticated play token required" });
      return null;
    },
    rateLimit: (_req: any, _res: any, next: () => void) => next(),
    ensureHydrated,
    getProgress,
    getMetaChainProgress,
    getHydrationState,
    reportError: vi.fn(),
  });
  return {
    routes,
    ensureHydrated,
    getProgress,
    getMetaChainProgress,
    getHydrationState,
  };
}

describe("registerAchievementRoutes", () => {
  test("returns only the authenticated actor profile", async () => {
    const { routes, ensureHydrated, getProgress, getMetaChainProgress } =
      harness();
    const handler = routes.get(
      "GET /api/vaultfront/achievements/:persistentId",
    );
    const own = response();
    await handler({ params: { persistentId: "player-1" } }, own);
    expect(own.statusCode).toBe(200);
    expect(own.body).toMatchObject({
      achievements: [{ id: "first_vault" }],
      metaChains: [{ id: "vault_sovereign" }],
      persistence: { status: "ready", source: "postgres" },
    });
    expect(ensureHydrated).toHaveBeenCalledOnce();
    expect(ensureHydrated).toHaveBeenCalledWith("player-1");
    expect(getProgress).toHaveBeenCalledWith("player-1");
    expect(getMetaChainProgress).toHaveBeenCalledWith("player-1");
  });

  test("rejects missing authentication and cross-player claims", async () => {
    const unauthenticated = harness(null);
    const noToken = response();
    await unauthenticated.routes.get(
      "GET /api/vaultfront/achievements/:persistentId",
    )({ params: { persistentId: "player-1" } }, noToken);
    expect(noToken.statusCode).toBe(401);

    const authenticated = harness();
    const forged = response();
    await authenticated.routes.get(
      "GET /api/vaultfront/achievements/meta-chains/:persistentId",
    )({ params: { persistentId: "player-2" } }, forged);
    expect(forged.statusCode).toBe(403);
    expect(authenticated.ensureHydrated).not.toHaveBeenCalled();
    expect(authenticated.getMetaChainProgress).not.toHaveBeenCalled();
  });

  test("rejects malformed identity claims before reading the store", async () => {
    const { routes, getProgress } = harness();
    const res = response();
    await routes.get("GET /api/vaultfront/achievements/:persistentId")(
      { params: { persistentId: "" } },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(getProgress).not.toHaveBeenCalled();
  });
});
