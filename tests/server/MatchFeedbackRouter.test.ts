import { describe, expect, test, vi } from "vitest";
import { registerMatchFeedbackRoutes } from "../../src/server/MatchFeedbackRouter";

vi.mock("../../src/core/configuration/ConfigLoader", () => ({
  getServerConfigFromServer: () => ({
    otelEnabled: () => false,
    otelAuthHeader: () => "",
    otelEndpoint: () => "",
    env: () => 0,
  }),
}));

function harness(overrides: Record<string, unknown> = {}) {
  const routes = new Map<string, (req: any, res: any) => unknown>();
  const app = {
    post: vi.fn(
      (path: string, ...handlers: Array<(req: any, res: any) => unknown>) =>
        routes.set(`POST ${path}`, handlers.at(-1)!),
    ),
    get: vi.fn(
      (path: string, ...handlers: Array<(req: any, res: any) => unknown>) =>
        routes.set(`GET ${path}`, handlers.at(-1)!),
    ),
  };
  const response = () => {
    const res: any = {
      statusCode: 200,
      body: null,
      status: vi.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: vi.fn((body: unknown) => {
        res.body = body;
        return res;
      }),
    };
    return res;
  };
  const dependencies = {
    authenticate: vi.fn(async () => ({
      persistentId: "certified-player",
      actorKey: "actor-key",
    })),
    resolveEvidence: vi.fn(async () => ({
      mapName: "certified-map",
      hasVerifiedCertificate: true,
      certificateBindsActor: true,
      won: true,
      behindAtMinute8: true,
      playStyle: "Convoy Lord",
      styleConfidence: 67,
    })),
    authorize: vi.fn((_policy: string, context: any, res: any) => {
      const allowed = context.hasVerifiedActor
        ? context.hasVerifiedCertificate && context.certificateBindsActor
        : context.hasAdminToken;
      if (!allowed) res.status(403).json({ error: "denied" });
      return Boolean(allowed);
    }),
    assertPolicyBinding: vi.fn(),
    isAdmin: vi.fn(() => false),
    record: vi.fn(async (input: any) => ({
      accepted: true,
      duplicate: false,
      gameId: input.gameId,
      mapName: input.mapName,
      durability: "process-local" as const,
      evidence: "certified-match-result" as const,
      retentionDays: 30 as const,
      signal: input.signal ?? null,
    })),
    summary: vi.fn(async () => ({
      generatedAt: 1,
      windowDays: 30 as const,
      retentionDays: 30 as const,
      durability: "process-local" as const,
      evidence: "certified-match-result" as const,
      totalRatings: 0,
      maps: [],
      cohorts: [],
    })),
    ...overrides,
  };
  registerMatchFeedbackRoutes(app as any, dependencies as any);
  return { routes, response, dependencies };
}

describe("MatchFeedbackRouter", () => {
  test("derives map identity from certified participation and ignores browser map claims", async () => {
    const { routes, response, dependencies } = harness();
    const res = response();
    await routes.get("POST /api/vaultfront/match-rating")!(
      {
        body: {
          gameId: "game-1",
          persistentId: "certified-player",
          mapName: "spoofed-map",
          matchRating: 5,
          mapRating: 4,
          signal: "decisive-convoy",
        },
      },
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(dependencies.record).toHaveBeenCalledWith({
      persistentId: "certified-player",
      gameId: "game-1",
      mapName: "certified-map",
      matchRating: 5,
      mapRating: 4,
      signal: "decisive-convoy",
      won: true,
      behindAtMinute8: true,
      playStyle: "Convoy Lord",
      styleConfidence: 67,
    });
  });

  test("rejects cross-player claims and uncertified participation", async () => {
    const first = harness();
    const mismatch = first.response();
    await first.routes.get("POST /api/vaultfront/match-rating")!(
      {
        body: {
          gameId: "game-1",
          persistentId: "someone-else",
          matchRating: 4,
          mapRating: 4,
        },
      },
      mismatch,
    );
    expect(mismatch.statusCode).toBe(403);
    expect(first.dependencies.record).not.toHaveBeenCalled();

    const second = harness({
      resolveEvidence: vi.fn(async () => ({
        mapName: null,
        hasVerifiedCertificate: false,
        certificateBindsActor: false,
        won: false,
        behindAtMinute8: false,
        playStyle: "Balanced",
        styleConfidence: 0,
      })),
    });
    const uncertified = second.response();
    await second.routes.get("POST /api/vaultfront/match-rating")!(
      { body: { gameId: "unknown", matchRating: 4, mapRating: 4 } },
      uncertified,
    );
    expect(uncertified.statusCode).toBe(403);
    expect(second.dependencies.record).not.toHaveBeenCalled();
  });

  test("returns explicit conflict receipts and protects operator aggregates", async () => {
    const duplicateReceipt = {
      accepted: false,
      duplicate: true,
      gameId: "game-1",
      mapName: "certified-map",
      durability: "postgres" as const,
      evidence: "certified-match-result" as const,
      retentionDays: 30 as const,
      signal: null,
    };
    const { routes, response, dependencies } = harness({
      record: vi.fn(async () => duplicateReceipt),
    });
    const duplicate = response();
    await routes.get("POST /api/vaultfront/match-rating")!(
      { body: { gameId: "game-1", matchRating: 5, mapRating: 5 } },
      duplicate,
    );
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).toEqual(duplicateReceipt);

    const denied = response();
    await routes.get("GET /api/admin/match-ratings")!({ headers: {} }, denied);
    expect(denied.statusCode).toBe(403);
    expect(dependencies.summary).not.toHaveBeenCalled();
  });
});
