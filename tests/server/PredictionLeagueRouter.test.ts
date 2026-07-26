import { describe, expect, test, vi } from "vitest";
import { registerPredictionLeagueRoutes } from "../../src/server/PredictionLeagueRouter";

function harness() {
  const routes = new Map<string, (req: any, res: any) => unknown>();
  const app = {
    get: vi.fn((path: string, ...handlers: any[]) =>
      routes.set(`GET ${path}`, handlers.at(-1)),
    ),
    post: vi.fn((path: string, ...handlers: any[]) =>
      routes.set(`POST ${path}`, handlers.at(-1)),
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
  return { app, routes, response };
}

describe("PredictionLeagueRouter", () => {
  test("binds a prediction to the authenticated actor and returns ledger truth", async () => {
    const { app, routes, response } = harness();
    const recordPrediction = vi.fn(async () => ({
      gameId: "g1",
      accepted: true,
      reason: "accepted" as const,
      durability: "postgres" as const,
    }));
    registerPredictionLeagueRoutes(app as any, {
      authenticate: vi.fn(async () => ({ persistentId: "verified" })),
      admitPrediction: vi.fn(() => ({
        allowed: true as const,
        reason: "open" as const,
      })),
      recordPrediction: recordPrediction as any,
      getLeaderboard: vi.fn() as any,
      getSpectatorStats: vi.fn() as any,
      getGameConsensus: vi.fn(async () => ({
        gameId: "g1",
        interceptPct: 0,
        deliveryPct: 100,
        total: 1,
      })) as any,
    });
    const res = response();
    await routes.get("POST /api/vaultfront/prediction-league/predict")!(
      { body: { gameId: "g1", outcome: "delivery", spectatorId: "forged" } },
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(recordPrediction).toHaveBeenCalledWith("g1", "verified", "delivery");
    expect(res.body.durability).toBe("postgres");
  });

  test("protects personal stats and rejects a mismatched legacy identity claim", async () => {
    const { app, routes, response } = harness();
    registerPredictionLeagueRoutes(app as any, {
      authenticate: vi.fn(async () => ({ persistentId: "verified" })),
      admitPrediction: vi.fn(() => ({
        allowed: true as const,
        reason: "open" as const,
      })),
      recordPrediction: vi.fn() as any,
      getLeaderboard: vi.fn() as any,
      getSpectatorStats: vi.fn(async () => ({ accuracy: 75 })) as any,
      getGameConsensus: vi.fn() as any,
    });
    const mismatched = response();
    await routes.get(
      "GET /api/vaultfront/prediction-league/stats/:spectatorId",
    )!({ params: { spectatorId: "someone-else" } }, mismatched);
    expect(mismatched.statusCode).toBe(403);
    const own = response();
    await routes.get("GET /api/vaultfront/prediction-league/stats")!(
      { params: {} },
      own,
    );
    expect(own.body.stats.accuracy).toBe(75);
  });

  test("reports unavailable persistence honestly", async () => {
    const { app, routes, response } = harness();
    registerPredictionLeagueRoutes(app as any, {
      authenticate: vi.fn(async () => ({ persistentId: "verified" })),
      admitPrediction: vi.fn(() => ({
        allowed: true as const,
        reason: "open" as const,
      })),
      recordPrediction: vi.fn().mockRejectedValue(new Error("down")) as any,
      getLeaderboard: vi.fn() as any,
      getSpectatorStats: vi.fn() as any,
      getGameConsensus: vi.fn() as any,
    });
    const res = response();
    await routes.get("POST /api/vaultfront/prediction-league/predict")!(
      { body: { gameId: "g1", outcome: "delivery" } },
      res,
    );
    expect(res.statusCode).toBe(503);
  });

  test("rejects invented and closed games before touching the ledger", async () => {
    const { app, routes, response } = harness();
    const recordPrediction = vi.fn();
    const reportAdmissionRejected = vi.fn();
    registerPredictionLeagueRoutes(app as any, {
      authenticate: vi.fn(async () => ({ persistentId: "verified" })),
      admitPrediction: vi.fn(() => ({
        allowed: false as const,
        reason: "unknown-game" as const,
      })),
      reportAdmissionRejected,
      recordPrediction: recordPrediction as any,
      getLeaderboard: vi.fn() as any,
      getSpectatorStats: vi.fn() as any,
      getGameConsensus: vi.fn() as any,
    });
    const res = response();
    await routes.get("POST /api/vaultfront/prediction-league/predict")!(
      { body: { gameId: "invented", outcome: "delivery" } },
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "Prediction window unavailable" });
    expect(recordPrediction).not.toHaveBeenCalled();
    expect(reportAdmissionRejected).toHaveBeenCalledWith(
      "invented",
      "unknown-game",
    );
  });
});
