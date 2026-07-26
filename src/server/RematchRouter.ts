import type { Express, Request, RequestHandler, Response } from "express";
import { GameType } from "../core/game/Game";
import type { GameConfig } from "../core/Schemas";
import { CreateGameInputSchema } from "../core/WorkerSchemas";
import type { RematchEntry } from "./RematchStore";
import { assertRoutePolicyBinding } from "./RoutePolicyManifest";

export interface RematchActor {
  actorKey: string;
  persistentId: string;
}

export interface AuthorizedRematchSource {
  config: unknown;
  mapName: string;
  evidence: "live-participant" | "archived-participant";
}

export interface RematchRouterDependencies {
  authenticate: (req: Request, res: Response) => Promise<RematchActor | null>;
  resolveAuthorizedSource: (
    gameId: string,
    actor: RematchActor,
  ) => Promise<AuthorizedRematchSource | null>;
  joinExisting: (gameId: string, actorKey: string) => RematchEntry | null;
  createLobby: (
    config: GameConfig,
    creatorPersistentId: string,
  ) => { lobbyId: string; joinUrl: string } | null;
  createEntry: (input: {
    gameId: string;
    lobbyId: string;
    actorKey: string;
    mapName: string;
    joinUrl: string;
  }) => RematchEntry;
  get: (gameId: string) => RematchEntry | null;
  getByCode: (code: string) => RematchEntry | null;
  rateLimit?: RequestHandler;
}

export function registerRematchRoutes(
  app: Pick<Express, "get" | "post">,
  dependencies: RematchRouterDependencies,
): void {
  const rateLimit: RequestHandler =
    dependencies.rateLimit ?? ((_req, _res, next) => next());

  assertRoutePolicyBinding("rematch-create", "POST", "/api/rematch/:gameId");
  app.post("/api/rematch/:gameId", rateLimit, async (req, res) => {
    const gameId = String(req.params["gameId"] ?? "")
      .trim()
      .slice(0, 64);
    if (!gameId) return res.status(400).json({ error: "Missing gameId" });
    const actor = await dependencies.authenticate(req, res);
    if (!actor) return;

    const source = await dependencies.resolveAuthorizedSource(gameId, actor);
    if (!source) {
      return res
        .status(404)
        .json({ error: "Certified source participation not found" });
    }

    const existing = dependencies.joinExisting(gameId, actor.actorKey);
    if (existing) {
      return res.json({ ...existing, sourceEvidence: source.evidence });
    }

    const cloned = CreateGameInputSchema.safeParse({
      ...(source.config as Record<string, unknown>),
      gameType: GameType.Private,
      rankedType: undefined,
    });
    if (!cloned.success || !cloned.data) {
      return res.status(409).json({ error: "Source game cannot be rematched" });
    }
    const lobby = dependencies.createLobby(cloned.data, actor.persistentId);
    if (!lobby) {
      return res
        .status(503)
        .json({ error: "Unable to allocate rematch lobby" });
    }
    const entry = dependencies.createEntry({
      gameId,
      lobbyId: lobby.lobbyId,
      actorKey: actor.actorKey,
      mapName: source.mapName,
      joinUrl: lobby.joinUrl,
    });
    return res.status(201).json({ ...entry, sourceEvidence: source.evidence });
  });

  app.get("/api/rematch/status/:gameId", rateLimit, (req, res) => {
    const gameId = String(req.params["gameId"] ?? "")
      .trim()
      .slice(0, 64);
    if (!gameId) return res.status(400).json({ error: "Missing gameId" });
    const entry = dependencies.get(gameId);
    if (!entry) return res.status(404).json({ error: "No rematch found" });
    return res.json(entry);
  });

  app.get("/api/rematch/code/:code", rateLimit, (req, res) => {
    const code = String(req.params["code"] ?? "")
      .trim()
      .slice(0, 32);
    if (!code) return res.status(400).json({ error: "Missing code" });
    const entry = dependencies.getByCode(code);
    if (!entry) {
      return res.status(404).json({ error: "Rematch not found or expired" });
    }
    return res.json(entry);
  });
}
