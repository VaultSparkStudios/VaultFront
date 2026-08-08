import { describe, expect, test, vi } from "vitest";
import {
  registerFortuneRoutes,
  type FortuneRouterDependencies,
} from "../../src/server/FortuneRouter";

describe("FortuneRouter (S99 audit #180)", () => {
  function setup(deps: Partial<FortuneRouterDependencies> = {}) {
    const routes = new Map<string, any>();
    const app = {
      get: (path: string, handler: unknown) =>
        routes.set(`GET ${path}`, handler),
      post: (path: string, _middleware: unknown, handler: unknown) =>
        routes.set(`POST ${path}`, handler),
    };
    const dependencies: FortuneRouterDependencies = {
      authenticate: vi.fn().mockResolvedValue({ persistentId: "actor-1" }),
      getCollection: vi.fn().mockResolvedValue([]),
      getEquippedTitle: vi.fn().mockResolvedValue(null),
      equipTitle: vi.fn().mockResolvedValue({ ok: true, title: "The Runner" }),
      rateLimit: () => undefined,
      ...deps,
    };
    registerFortuneRoutes(
      app as unknown as Parameters<typeof registerFortuneRoutes>[0],
      dependencies,
    );
    return { routes, dependencies };
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

  test("GET collection rejects a caller reading another player's collection", async () => {
    const { routes } = setup();
    const handler = routes.get(
      "GET /api/vaultfront/fortune-collection/:persistentId",
    );
    const result = await handler(
      { params: { persistentId: "someone-else" }, headers: {} },
      makeResponse(),
    );
    expect(result.status).toBe(401);
  });

  test("GET collection returns items and equipped title for the authenticated owner", async () => {
    const { routes } = setup({
      getCollection: vi
        .fn()
        .mockResolvedValue([
          { itemId: "title_runner", name: "The Runner", rarity: "common" },
        ]),
      getEquippedTitle: vi.fn().mockResolvedValue("The Runner"),
    });
    const handler = routes.get(
      "GET /api/vaultfront/fortune-collection/:persistentId",
    );
    const result = await handler(
      { params: { persistentId: "actor-1" }, headers: {} },
      makeResponse(),
    );
    expect(result.status).toBe(200);
    expect((result.body as any).equippedTitle).toBe("The Runner");
    expect((result.body as any).items).toHaveLength(1);
  });

  test("POST equip requires auth and validates the body", async () => {
    const { routes } = setup({
      authenticate: vi.fn().mockResolvedValue(null),
    });
    const handler = routes.get("POST /api/vaultfront/fortune-collection/equip");
    expect(
      (await handler({ body: {}, headers: {} }, makeResponse())).status,
    ).toBe(401);
  });

  test("POST equip maps a rejected equip to 409", async () => {
    const { routes } = setup({
      equipTitle: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "Title not owned" }),
    });
    const handler = routes.get("POST /api/vaultfront/fortune-collection/equip");
    const result = await handler(
      { body: { itemId: "title_vault_sovereign" }, headers: {} },
      makeResponse(),
    );
    expect(result.status).toBe(409);
  });

  test("POST equip succeeds for a valid owned title", async () => {
    const { routes } = setup();
    const handler = routes.get("POST /api/vaultfront/fortune-collection/equip");
    const result = await handler(
      { body: { itemId: "title_runner" }, headers: {} },
      makeResponse(),
    );
    expect(result.status).toBe(200);
    expect((result.body as any).title).toBe("The Runner");
  });
});
