import type { Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { MutatorVoteReceipt, SeasonStatus } from "./VaultSeasonScheduler";

interface SeasonCommunityApp {
  get(path: string, ...handlers: RequestHandler[]): unknown;
  post(path: string, ...handlers: RequestHandler[]): unknown;
}

interface Actor {
  persistentId: string;
}

export interface SeasonCommunityRouterDependencies {
  authenticate: (req: Request, res: Response) => Promise<Actor | null>;
  getStatus: () => SeasonStatus;
  recordVote: (
    candidateKey: string,
    actorId: string,
  ) => Promise<MutatorVoteReceipt>;
}

const MutatorVoteSchema = z
  .object({ candidateKey: z.string().min(1).max(64) })
  .strict();

function voteStatus(receipt: MutatorVoteReceipt): number {
  if (receipt.accepted) return 200;
  if (receipt.reason === "invalid-candidate") return 400;
  if (receipt.reason === "persistence-unavailable") return 503;
  return 409;
}

export function registerSeasonCommunityRoutes(
  app: SeasonCommunityApp,
  dependencies: SeasonCommunityRouterDependencies,
): void {
  const currentRateLimit = rateLimit({ windowMs: 60_000, max: 60 });
  const voteRateLimit = rateLimit({ windowMs: 60_000, max: 5 });
  app.get("/api/season/current", currentRateLimit, (_req, res) =>
    res.json(dependencies.getStatus()),
  );

  app.post("/api/mutator-vote", voteRateLimit, async (req, res) => {
    const parsed = MutatorVoteSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid vote payload" });
    const actor = await dependencies.authenticate(req, res);
    if (!actor) return;
    const receipt = await dependencies.recordVote(
      parsed.data.candidateKey,
      actor.persistentId,
    );
    return res.status(voteStatus(receipt)).json(receipt);
  });
}
