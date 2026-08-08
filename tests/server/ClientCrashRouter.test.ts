import { describe, expect, test, vi } from "vitest";
import {
  registerClientCrashRoutes,
  type ClientCrashRouteDependencies,
} from "../../src/server/ClientCrashRouter";

describe("ClientCrashRouter (S99 audit #183)", () => {
  test("requires auth, validates input, and never receives raw stack text", async () => {
    type RouteHandler = (
      req: ReturnType<typeof makeRequest>,
      res: ReturnType<typeof makeResponse>,
    ) => Promise<{ status: number; body: unknown }>;
    const routes = new Map<string, RouteHandler>();
    const app = {
      post: (path: string, _middleware: unknown, handler: RouteHandler) =>
        routes.set(`POST ${path}`, handler),
    };
    const dependencies = {
      rateLimit: () => undefined,
      resolveActor: vi.fn().mockResolvedValue(null),
      record: vi.fn(),
      reportError: vi.fn(),
    } as unknown as ClientCrashRouteDependencies;
    registerClientCrashRoutes(
      app as unknown as Parameters<typeof registerClientCrashRoutes>[0],
      dependencies,
    );
    const handler = routes.get("POST /api/vaultfront/client-crash")!;

    // Unauthenticated requests are rejected before validation.
    expect((await handler(makeRequest({}), makeResponse())).status).toBe(401);

    dependencies.resolveActor = vi
      .fn()
      .mockResolvedValue({ actorKey: "actor-alpha-1" });

    // Malformed body (missing required fields) is rejected.
    expect(
      (await handler(makeRequest({ kind: "error" }), makeResponse())).status,
    ).toBe(400);

    // A well-formed payload (only message + digest, never raw stack text)
    // is accepted and stored bound to the resolved actor.
    const record = vi.fn();
    dependencies.record = record;
    const result = await handler(
      makeRequest({
        kind: "error",
        message: "TypeError: x is not a function",
        stackHash: "a1b2c3d4",
      }),
      makeResponse(),
    );
    expect(result.status).toBe(202);
    expect(record).toHaveBeenCalledTimes(1);
    const stored = record.mock.calls[0][0];
    expect(stored).not.toHaveProperty("stack");
    expect(stored.stackHash).toBe("a1b2c3d4");
    expect(stored.actorKey).toBe("actor-alpha-1");
  });

  test("the schema has no stack field, so a caller cannot smuggle raw stack text through -- the strict schema hard-rejects the attempt", async () => {
    const routes = new Map<string, any>();
    const app = {
      post: (path: string, _middleware: unknown, handler: unknown) =>
        routes.set(`POST ${path}`, handler),
    };
    const dependencies = {
      rateLimit: () => undefined,
      resolveActor: vi.fn().mockResolvedValue({ actorKey: "actor-1" }),
      record: vi.fn(),
      reportError: vi.fn(),
    } as unknown as ClientCrashRouteDependencies;
    registerClientCrashRoutes(
      app as unknown as Parameters<typeof registerClientCrashRoutes>[0],
      dependencies,
    );
    const handler = routes.get("POST /api/vaultfront/client-crash")!;
    const result = await handler(
      makeRequest({
        kind: "error",
        message: "TypeError: x is not a function",
        stack: "TypeError: x is not a function\n  at FxLayer.ts:200:5\n  ...",
      }),
      makeResponse(),
    );
    expect(result.status).toBe(400);
    expect(dependencies.record).not.toHaveBeenCalled();
  });

  test("rejects an oversized message", async () => {
    const routes = new Map<string, any>();
    const app = {
      post: (path: string, _middleware: unknown, handler: unknown) =>
        routes.set(`POST ${path}`, handler),
    };
    const dependencies = {
      rateLimit: () => undefined,
      resolveActor: vi.fn().mockResolvedValue({ actorKey: "actor-1" }),
      record: vi.fn(),
      reportError: vi.fn(),
    } as unknown as ClientCrashRouteDependencies;
    registerClientCrashRoutes(
      app as unknown as Parameters<typeof registerClientCrashRoutes>[0],
      dependencies,
    );
    const handler = routes.get("POST /api/vaultfront/client-crash")!;
    const result = await handler(
      makeRequest({ kind: "error", message: "x".repeat(501) }),
      makeResponse(),
    );
    expect(result.status).toBe(400);
  });
});

function makeRequest(body: unknown) {
  return { body, headers: {} };
}

function makeResponse() {
  return {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      return { status: this.statusCode, body };
    },
  };
}
