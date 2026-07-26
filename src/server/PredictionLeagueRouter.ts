import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type {
  PredictionConsensus,
  PredictionLeagueStore,
  PredictionOutcome,
} from "./PredictionLeagueStore";
import { retiredMutation } from "./RetiredMutation";
import { assertRoutePolicyBinding } from "./RoutePolicyManifest";

interface PredictionActor {
  persistentId: string;
}

export interface PredictionLeagueRouteDependencies {
  authenticate: (
    req: Request,
    res: Response,
  ) => Promise<PredictionActor | null>;
  admitPrediction: (gameId: string) =>
    | { allowed: true; reason: "open" }
    | {
        allowed: false;
        reason: "unknown-game" | "not-started" | "closed";
      };
  reportAdmissionRejected?: (
    gameId: string,
    reason: "unknown-game" | "not-started" | "closed",
  ) => void;
  recordPrediction: PredictionLeagueStore["recordPrediction"];
  getLeaderboard: PredictionLeagueStore["getLeaderboard"];
  getSpectatorStats: PredictionLeagueStore["getSpectatorStats"];
  getGameConsensus: PredictionLeagueStore["getGameConsensus"];
  publishConsensus?: (consensus: PredictionConsensus) => void;
  predictionRateLimit?: RequestHandler;
  reportError?: (error: unknown) => void;
}

const predictionSchema = z.object({
  gameId: z.string().trim().min(1).max(64),
  outcome: z.enum(["intercept", "delivery"]),
});

export function registerPredictionLeagueRoutes(
  app: Pick<Express, "get" | "post">,
  dependencies: PredictionLeagueRouteDependencies,
): void {
  const predictionRateLimit: RequestHandler =
    dependencies.predictionRateLimit ?? ((_req, _res, next) => next());
  assertRoutePolicyBinding(
    "prediction-league-write",
    "POST",
    "/api/vaultfront/prediction-league/predict",
  );
  app.post(
    "/api/vaultfront/prediction-league/predict",
    predictionRateLimit,
    async (req, res) => {
      const parsed = predictionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request" });
      }
      const actor = await dependencies.authenticate(req, res);
      if (!actor) return;
      const admission = dependencies.admitPrediction(parsed.data.gameId);
      if (!admission.allowed) {
        dependencies.reportAdmissionRejected?.(
          parsed.data.gameId,
          admission.reason,
        );
        return res.status(409).json({ error: "Prediction window unavailable" });
      }
      try {
        const receipt = await dependencies.recordPrediction(
          parsed.data.gameId,
          actor.persistentId,
          parsed.data.outcome as PredictionOutcome,
        );
        const consensus = await dependencies.getGameConsensus(
          parsed.data.gameId,
        );
        dependencies.publishConsensus?.(consensus);
        return res
          .status(receipt.accepted ? 201 : 409)
          .json({ ...receipt, consensus });
      } catch (error) {
        dependencies.reportError?.(error);
        return res.status(503).json({ error: "Prediction ledger unavailable" });
      }
    },
  );

  app.get("/api/vaultfront/prediction-league/leaderboard", async (req, res) => {
    const weekOnly = req.query["week"] === "1";
    const limit = Math.min(
      50,
      Math.max(
        1,
        Number.parseInt(String(req.query["limit"] ?? "10"), 10) || 10,
      ),
    );
    try {
      return res.json({
        ok: true,
        leaderboard: await dependencies.getLeaderboard(limit, weekOnly),
      });
    } catch (error) {
      dependencies.reportError?.(error);
      return res.status(503).json({ error: "Prediction ledger unavailable" });
    }
  });

  app.get(
    "/api/vaultfront/prediction-league/games/:gameId/consensus",
    async (req, res) => {
      const gameId = String(req.params["gameId"] ?? "").trim();
      if (!gameId || gameId.length > 64) {
        return res.status(400).json({ error: "Invalid game identity" });
      }
      try {
        return res.json(await dependencies.getGameConsensus(gameId));
      } catch (error) {
        dependencies.reportError?.(error);
        return res.status(503).json({ error: "Prediction ledger unavailable" });
      }
    },
  );

  const statsHandler = async (req: Request, res: Response) => {
    const actor = await dependencies.authenticate(req, res);
    if (!actor) return;
    const claimed = req.params["spectatorId"];
    if (claimed && claimed !== actor.persistentId) {
      return res.status(403).json({ error: "Identity claim mismatch" });
    }
    try {
      return res.json({
        ok: true,
        stats: await dependencies.getSpectatorStats(actor.persistentId),
      });
    } catch (error) {
      dependencies.reportError?.(error);
      return res.status(503).json({ error: "Prediction ledger unavailable" });
    }
  };

  app.get("/api/vaultfront/prediction-league/stats", statsHandler);
  app.get("/api/vaultfront/prediction-league/stats/:spectatorId", statsHandler);

  app.post(
    "/api/vaultfront/narrator/:gameId/predict",
    retiredMutation("Use the authenticated Prediction League contract"),
  );
}
