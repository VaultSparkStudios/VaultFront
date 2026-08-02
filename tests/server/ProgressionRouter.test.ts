import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ registerSeasonPassRoutes: vi.fn() }));
vi.mock("../../src/server/MatchProgression", () => ({
  verifyProgressionReceipt: (receipt: any) => receipt.receiptDigest === "valid",
}));
vi.mock("../../src/server/ProgressionReceiptStore", () => ({
  progressionReceiptStore: { getForActor: vi.fn() },
}));
vi.mock("../../src/server/SeasonMilestoneStore", () => ({
  seasonMilestoneStore: { getState: vi.fn(), claim: vi.fn() },
}));
vi.mock("../../src/server/SeasonPassRouter", () => ({
  registerSeasonPassRoutes: mocks.registerSeasonPassRoutes,
}));
vi.mock("../../src/server/VaultSeasonScheduler", () => ({
  vaultSeasonScheduler: { getStatus: () => ({ weekNumber: 31 }) },
}));

import { registerProgressionRoutes } from "../../src/server/ProgressionRouter";

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

function receipt(digest = "valid") {
  return {
    gameId: "game-1",
    recordedAt: "2026-08-01T20:00:00.000Z",
    durability: "postgres",
    receiptDigest: digest,
    achievementsUnlocked: 1,
    predictionsResolved: 2,
    loopEvidence: {},
    certifiedOutcomes: {},
    players: [{ persistentId: "actor-1", delta: { eloRating: 32 } }],
  } as any;
}

function harness(getReceiptForActor: any) {
  const routes = new Map<string, any>();
  const app = {
    get: (path: string, ...handlers: any[]) =>
      routes.set(`GET ${path}`, handlers.at(-1)),
    post: vi.fn(),
  };
  registerProgressionRoutes(app, {
    authenticate: async () => ({ persistentId: "actor-1" }),
    getReceiptForActor,
  });
  return routes;
}

describe("ProgressionRouter", () => {
  test("composes season progression and returns only the actor dividend", async () => {
    const getReceipt = vi.fn().mockResolvedValue(receipt());
    const routes = harness(getReceipt);
    expect(mocks.registerSeasonPassRoutes).toHaveBeenCalled();
    const res = response();
    await routes.get("GET /api/vaultfront/progression-dividend/:gameId")(
      { params: { gameId: "game-1" } },
      res,
    );
    expect(getReceipt).toHaveBeenCalledWith("game-1", "actor-1");
    expect(res.body).toMatchObject({
      status: "verified",
      receiptDigest: "valid",
      dividend: { persistentId: "actor-1", delta: { eloRating: 32 } },
    });
    expect(res.body).not.toHaveProperty("players");
  });

  test("fails cross-actor absence, malformed IDs, and tampered receipts closed", async () => {
    const missingRoutes = harness(vi.fn().mockResolvedValue(null));
    const missing = response();
    await missingRoutes.get("GET /api/vaultfront/progression-dividend/:gameId")(
      { params: { gameId: "game-1" } },
      missing,
    );
    expect(missing).toMatchObject({
      statusCode: 404,
      body: { status: "pending" },
    });

    const invalidId = response();
    await missingRoutes.get("GET /api/vaultfront/progression-dividend/:gameId")(
      { params: { gameId: "../../other" } },
      invalidId,
    );
    expect(invalidId.statusCode).toBe(400);

    const tamperedRoutes = harness(
      vi.fn().mockResolvedValue(receipt("tampered")),
    );
    const tampered = response();
    await tamperedRoutes.get(
      "GET /api/vaultfront/progression-dividend/:gameId",
    )({ params: { gameId: "game-1" } }, tampered);
    expect(tampered).toMatchObject({
      statusCode: 409,
      body: { status: "invalid-receipt" },
    });
  });
});
