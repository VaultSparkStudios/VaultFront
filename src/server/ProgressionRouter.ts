import type { Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  verifyProgressionReceipt,
  type ProgressionReceipt,
} from "./MatchProgression";
import { progressionReceiptStore } from "./ProgressionReceiptStore";
import { seasonMilestoneStore } from "./SeasonMilestoneStore";
import { registerSeasonPassRoutes } from "./SeasonPassRouter";
import { vaultSeasonScheduler } from "./VaultSeasonScheduler";

interface ProgressionApp {
  get(path: string, ...handlers: RequestHandler[]): unknown;
  post(path: string, ...handlers: RequestHandler[]): unknown;
}

interface Actor {
  persistentId: string;
}

export interface ProgressionRouterDependencies {
  authenticate: (req: Request, res: Response) => Promise<Actor | null>;
  getReceiptForActor?: (
    gameId: string,
    actorId: string,
  ) => Promise<ProgressionReceipt | null>;
  reportError?: (error: unknown) => void;
}

const GameIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export function registerProgressionRoutes(
  app: ProgressionApp,
  dependencies: ProgressionRouterDependencies,
): void {
  const rate = rateLimit({ windowMs: 60_000, max: 30 });
  const reportError = dependencies.reportError ?? (() => undefined);
  registerSeasonPassRoutes(app, {
    authenticate: dependencies.authenticate,
    rateLimit: rate,
    currentSeasonId: () =>
      `week-${vaultSeasonScheduler.getStatus().weekNumber}`,
    getState: (persistentId, seasonId) =>
      seasonMilestoneStore.getState(persistentId, seasonId),
    claim: (persistentId, seasonId, milestoneId) =>
      seasonMilestoneStore.claim(persistentId, seasonId, milestoneId),
    reportError,
  });

  app.get(
    "/api/vaultfront/progression-dividend/:gameId",
    rate,
    async (req, res) => {
      const parsed = GameIdSchema.safeParse(req.params.gameId);
      if (!parsed.success)
        return res.status(400).json({ status: "invalid-game-id" });
      const actor = await dependencies.authenticate(req, res);
      if (!actor) return;
      try {
        const receipt = await (
          dependencies.getReceiptForActor ??
          progressionReceiptStore.getForActor.bind(progressionReceiptStore)
        )(parsed.data, actor.persistentId);
        if (!receipt) return res.status(404).json({ status: "pending" });
        if (!verifyProgressionReceipt(receipt))
          return res.status(409).json({ status: "invalid-receipt" });
        const dividend = receipt.players.find(
          (player) => player.persistentId === actor.persistentId,
        );
        if (!dividend) return res.status(404).json({ status: "pending" });
        return res.json({
          status: "verified",
          gameId: receipt.gameId,
          recordedAt: receipt.recordedAt,
          durability: receipt.durability,
          receiptDigest: receipt.receiptDigest,
          dividend,
          fanout: {
            achievementsUnlocked: receipt.achievementsUnlocked,
            predictionsResolved: receipt.predictionsResolved,
            loopEvidence: receipt.loopEvidence !== null,
            certifiedOutcomes: receipt.certifiedOutcomes !== null,
          },
        });
      } catch (error) {
        reportError(error);
        return res.status(503).json({ status: "unavailable" });
      }
    },
  );
}
