import { describe, expect, test, vi } from "vitest";
import { registerDailyMasteryRoute } from "../../src/server/DailyMasteryRouter";

function harness(overrides: Record<string, unknown> = {}) {
  let handler: (request: any, response: any) => Promise<unknown> = async () =>
    undefined;
  let postHandler: (
    request: any,
    response: any,
  ) => Promise<unknown> = async () => undefined;
  const dependencies = {
    verifyToken: vi.fn().mockResolvedValue({
      type: "success",
      persistentId: "player-1",
    }),
    getChallenge: vi.fn().mockResolvedValue({
      challengeId: "victory-1",
      description: "Win a certified match",
      progress: 0,
      target: 1,
      rewardMastery: 75,
      completed: false,
      masteryBalance: 0,
      dateUtc: "2026-07-22",
      evidence: "certified-match-result",
      durability: "postgres",
      doctrines: {
        catalog: [],
        ownedIds: [],
        activeId: null,
        effectPolicy: "coaching-and-identity-only",
      },
    }),
    selectDoctrine: vi.fn().mockResolvedValue({
      requestId: "request-0001",
      doctrineId: "route-reader",
      unlockedNow: true,
      spentMastery: 50,
      masteryBalance: 25,
      durability: "postgres",
      evidence: "authenticated-mastery-choice",
      receiptDigest: "a".repeat(64),
    }),
    rateLimit: vi.fn((_request, _response, next) => next()),
    reportError: vi.fn(),
    ...overrides,
  };
  registerDailyMasteryRoute(
    {
      get: (_path, routeHandler) => {
        handler = routeHandler;
      },
      post: (_path, _middleware, routeHandler) => {
        postHandler = routeHandler;
      },
    },
    dependencies as any,
  );
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return body;
    },
  };
  return { handler, postHandler, dependencies, response };
}

describe("Daily Mastery router", () => {
  test("rejects missing and invalid bearer credentials", async () => {
    const missing = harness();
    await missing.handler({ headers: {} }, missing.response);
    expect(missing.response).toMatchObject({
      statusCode: 401,
      body: { error: "Authentication required" },
    });
    expect(missing.dependencies.verifyToken).not.toHaveBeenCalled();

    const invalid = harness({
      verifyToken: vi.fn().mockResolvedValue({ type: "error" }),
    });
    await invalid.handler(
      { headers: { authorization: "Bearer invalid" } },
      invalid.response,
    );
    expect(invalid.response).toMatchObject({
      statusCode: 401,
      body: { error: "Invalid authentication" },
    });
  });

  test("returns only the authenticated player's certified snapshot", async () => {
    const route = harness();
    await route.handler(
      { headers: { authorization: "Bearer signed-token" } },
      route.response,
    );
    expect(route.dependencies.verifyToken).toHaveBeenCalledWith("signed-token");
    expect(route.dependencies.getChallenge).toHaveBeenCalledWith("player-1");
    expect(route.response.statusCode).toBe(200);
    expect(route.response.body).toMatchObject({
      evidence: "certified-match-result",
      durability: "postgres",
    });
  });

  test("fails closed and reports persistence failures", async () => {
    const failure = new Error("database unavailable");
    const route = harness({
      getChallenge: vi.fn().mockRejectedValue(failure),
    });
    await route.handler(
      { headers: { authorization: "Bearer signed-token" } },
      route.response,
    );
    expect(route.dependencies.reportError).toHaveBeenCalledWith(failure);
    expect(route.response).toMatchObject({
      statusCode: 503,
      body: { error: "Daily mastery unavailable" },
    });
  });

  test("binds doctrine choice to the authenticated actor and returns snapshot", async () => {
    const route = harness();
    await route.postHandler(
      {
        headers: { authorization: "Bearer signed-token" },
        body: { doctrineId: "route-reader", requestId: "request-0001" },
      },
      route.response,
    );
    expect(route.dependencies.selectDoctrine).toHaveBeenCalledWith(
      "player-1",
      "route-reader",
      "request-0001",
    );
    expect(route.response.body).toMatchObject({
      receipt: { evidence: "authenticated-mastery-choice" },
      snapshot: { evidence: "certified-match-result" },
    });
  });

  test("rejects malformed and unfunded doctrine choices", async () => {
    const malformed = harness();
    await malformed.postHandler(
      {
        headers: { authorization: "Bearer signed-token" },
        body: { doctrineId: "combat-boost", requestId: "x" },
      },
      malformed.response,
    );
    expect(malformed.response.statusCode).toBe(400);
    expect(malformed.dependencies.selectDoctrine).not.toHaveBeenCalled();

    const unfunded = harness({
      selectDoctrine: vi.fn().mockRejectedValue(
        Object.assign(new Error("Requires 50 Mastery"), {
          code: "insufficient-mastery",
        }),
      ),
    });
    await unfunded.postHandler(
      {
        headers: { authorization: "Bearer signed-token" },
        body: { doctrineId: "route-reader", requestId: "request-0002" },
      },
      unfunded.response,
    );
    expect(unfunded.response).toMatchObject({
      statusCode: 409,
      body: { code: "insufficient-mastery" },
    });
  });

  test("authenticates doctrine mutations independently", async () => {
    const missing = harness();
    await missing.postHandler({ headers: {}, body: {} }, missing.response);
    expect(missing.response.statusCode).toBe(401);
    expect(missing.dependencies.selectDoctrine).not.toHaveBeenCalled();

    const invalid = harness({
      verifyToken: vi.fn().mockResolvedValue({ type: "error" }),
    });
    await invalid.postHandler(
      {
        headers: { authorization: "Bearer invalid" },
        body: { doctrineId: "route-reader", requestId: "request-0001" },
      },
      invalid.response,
    );
    expect(invalid.response.statusCode).toBe(401);
    expect(invalid.dependencies.selectDoctrine).not.toHaveBeenCalled();
  });

  test("maps every doctrine rejection class without leaking infrastructure errors", async () => {
    const cases = [
      {
        failure: Object.assign(new Error("Unknown Mastery Doctrine"), {
          code: "invalid-doctrine",
        }),
        status: 400,
        body: {
          error: "Unknown Mastery Doctrine",
          code: "invalid-doctrine",
        },
      },
      {
        failure: Object.assign(new Error("Request ID conflict"), {
          code: "request-conflict",
        }),
        status: 409,
        body: { error: "Request ID conflict", code: "request-conflict" },
      },
      {
        failure: { code: "invalid-doctrine" },
        status: 400,
        body: { error: "Doctrine rejected", code: "invalid-doctrine" },
      },
    ];

    for (const entry of cases) {
      const route = harness({
        selectDoctrine: vi.fn().mockRejectedValue(entry.failure),
      });
      await route.postHandler(
        {
          headers: { authorization: "Bearer signed-token" },
          body: { doctrineId: "route-reader", requestId: "request-0001" },
        },
        route.response,
      );
      expect(route.response).toMatchObject({
        statusCode: entry.status,
        body: entry.body,
      });
      expect(route.dependencies.reportError).not.toHaveBeenCalled();
    }

    for (const failure of [
      new Error("database unavailable"),
      Object.assign(new Error("unknown code"), { code: "unknown" }),
      "provider unavailable",
      null,
    ]) {
      const route = harness({
        selectDoctrine: vi.fn().mockRejectedValue(failure),
      });
      await route.postHandler(
        {
          headers: { authorization: "Bearer signed-token" },
          body: { doctrineId: "route-reader", requestId: "request-0001" },
        },
        route.response,
      );
      expect(route.response).toMatchObject({
        statusCode: 503,
        body: { error: "Daily mastery unavailable" },
      });
      expect(route.dependencies.reportError).toHaveBeenCalledWith(failure);
    }
  });
});
