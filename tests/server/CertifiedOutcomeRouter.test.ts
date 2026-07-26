import { describe, expect, test, vi } from "vitest";
import { registerCertifiedOutcomeRoutes } from "../../src/server/CertifiedOutcomeRouter";

function response() {
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

describe("registerCertifiedOutcomeRoutes", () => {
  test("binds career history to the verified actor", async () => {
    const routes = new Map<string, (...args: any[]) => any>();
    const profile = vi.fn().mockResolvedValue({
      persistentId: "player-1",
      history: [],
      trend: null,
      durability: "process-local",
      generatedAt: 1,
    });
    registerCertifiedOutcomeRoutes(
      {
        get: (path, ...handlers) => routes.set(path, handlers.at(-1)!),
      },
      {
        authenticate: async () => ({ persistentId: "player-1" }),
        acceptActorClaim: (actor, claim, res) => {
          if (actor.persistentId === claim) return true;
          res.status(403).json({ error: "Actor mismatch" });
          return false;
        },
        isAdmin: () => false,
        profile,
        summary: vi.fn(),
        reportError: vi.fn(),
      },
    );

    const allowed = response();
    await routes.get("/api/vaultfront/style-history/:persistentId")!(
      { params: { persistentId: "player-1" } },
      allowed,
    );
    expect(profile).toHaveBeenCalledWith("player-1");
    expect(allowed.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, persistentId: "player-1" }),
    );

    const denied = response();
    await routes.get("/api/vaultfront/style-history/:persistentId")!(
      { params: { persistentId: "other-player" } },
      denied,
    );
    expect(denied.status).toHaveBeenCalledWith(403);
    expect(profile).toHaveBeenCalledTimes(1);
  });

  test("keeps certified aggregate reporting behind the admin boundary", async () => {
    const routes = new Map<string, (...args: any[]) => any>();
    const summary = vi.fn().mockResolvedValue({
      evidence: "certified-match-result",
      players: 4,
    });
    registerCertifiedOutcomeRoutes(
      {
        get: (path, ...handlers) => routes.set(path, handlers.at(-1)!),
      },
      {
        authenticate: vi.fn(),
        acceptActorClaim: vi.fn(),
        isAdmin: (req) => req.admin === true,
        profile: vi.fn(),
        summary,
        reportError: vi.fn(),
      },
    );

    const denied = response();
    await routes.get("/api/admin/vaultfront/certified-outcomes")!(
      { admin: false },
      denied,
    );
    expect(denied.status).toHaveBeenCalledWith(401);

    const allowed = response();
    await routes.get("/api/admin/vaultfront/certified-outcomes")!(
      { admin: true },
      allowed,
    );
    expect(allowed.json).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: "certified-match-result" }),
    );
  });
});
