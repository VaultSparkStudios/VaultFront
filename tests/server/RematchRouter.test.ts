import { describe, expect, test, vi } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import { registerRematchRoutes } from "../../src/server/RematchRouter";

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

const sourceConfig = {
  gameMap: GameMapType.World,
  difficulty: Difficulty.Medium,
  donateGold: false,
  donateTroops: false,
  gameType: GameType.Public,
  gameMode: GameMode.FFA,
  gameMapSize: GameMapSize.Normal,
  nations: "default" as const,
  bots: 0,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: false,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn(async () => ({
      actorKey: "safe-actor",
      persistentId: "player-1",
    })),
    resolveAuthorizedSource: vi.fn(async () => ({
      config: sourceConfig,
      mapName: "World",
      evidence: "archived-participant" as const,
    })),
    joinExisting: vi.fn(() => null),
    createLobby: vi.fn(() => ({
      lobbyId: "new-game",
      joinUrl: "https://play.example/w0/game/new-game?lobby",
    })),
    createEntry: vi.fn((input) => ({
      ...input,
      code: "ABCDEFGH",
      expiresAt: 50_000,
      participantCount: 1,
      status: "ready" as const,
    })),
    get: vi.fn(() => null),
    getByCode: vi.fn(() => null),
    ...overrides,
  };
}

describe("RematchRouter", () => {
  test("creates a private continuation only from certified participation", async () => {
    const { app, routes, response } = harness();
    const deps = dependencies();
    registerRematchRoutes(app as any, deps as any);
    const res = response();
    await routes.get("POST /api/rematch/:gameId")!(
      { params: { gameId: "source-game" } },
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(deps.resolveAuthorizedSource).toHaveBeenCalledWith(
      "source-game",
      expect.objectContaining({ persistentId: "player-1" }),
    );
    expect(deps.createLobby).toHaveBeenCalledWith(
      expect.objectContaining({ gameType: GameType.Private }),
      "player-1",
    );
    expect(res.body.sourceEvidence).toBe("archived-participant");
  });

  test("rejects a nonparticipant before joining an existing corridor", async () => {
    const { app, routes, response } = harness();
    const joinExisting = vi.fn(() => ({
      gameId: "source-game",
      lobbyId: "private-lobby",
    }));
    const deps = dependencies({
      resolveAuthorizedSource: vi.fn(async () => null),
      joinExisting,
    });
    registerRematchRoutes(app as any, deps as any);
    const res = response();
    await routes.get("POST /api/rematch/:gameId")!(
      { params: { gameId: "source-game" } },
      res,
    );
    expect(res.statusCode).toBe(404);
    expect(joinExisting).not.toHaveBeenCalled();
  });

  test("fails closed when actor authentication is absent", async () => {
    const { app, routes, response } = harness();
    const resolveAuthorizedSource = vi.fn();
    const deps = dependencies({
      authenticate: vi.fn(async (_req, res) => {
        res.status(401).json({ error: "Authenticated play token required" });
        return null;
      }),
      resolveAuthorizedSource,
    });
    registerRematchRoutes(app as any, deps as any);
    const res = response();
    await routes.get("POST /api/rematch/:gameId")!(
      { params: { gameId: "source-game" } },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(resolveAuthorizedSource).not.toHaveBeenCalled();
  });
});
