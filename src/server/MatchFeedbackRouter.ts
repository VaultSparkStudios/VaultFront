import type { Express, RequestHandler } from "express";
import { z } from "zod";
import type { PlayStyleLabel } from "../core/PlayStyleClassifier";
import type {
  MatchFeedbackReceipt,
  MatchFeedbackSummary,
} from "./MatchFeedbackStore";
import type {
  RouteAuthorizationContext,
  RoutePolicyId,
} from "./RoutePolicyManifest";
import type { VerifiedVaultFrontActor } from "./VaultFrontAuthorization";

const MatchFeedbackInputSchema = z
  .object({
    gameId: z.string().trim().min(1).max(64),
    persistentId: z.string().trim().min(1).max(64).optional(),
    // Compatibility-only. The certified archive supplies the authoritative map.
    mapName: z.string().max(128).optional(),
    matchRating: z.number().int().min(1).max(5),
    mapRating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export interface MatchFeedbackEvidence {
  mapName: string | null;
  hasVerifiedCertificate: boolean;
  certificateBindsActor: boolean;
  won: boolean;
  behindAtMinute8: boolean;
  playStyle: PlayStyleLabel;
  styleConfidence: number;
}

export interface MatchFeedbackRouterDependencies {
  authenticate(
    req: Parameters<RequestHandler>[0],
    res: Parameters<RequestHandler>[1],
  ): Promise<VerifiedVaultFrontActor | null>;
  resolveEvidence(
    gameId: string,
    actor: VerifiedVaultFrontActor,
  ): Promise<MatchFeedbackEvidence>;
  authorize(
    policyId: RoutePolicyId,
    context: RouteAuthorizationContext,
    res: Parameters<RequestHandler>[1],
  ): boolean;
  assertPolicyBinding(
    policyId: RoutePolicyId,
    method: "GET" | "POST",
    path: string,
  ): void;
  isAdmin(req: Parameters<RequestHandler>[0]): boolean;
  record(input: {
    persistentId: string;
    gameId: string;
    mapName: string;
    matchRating: number;
    mapRating: number;
    comment?: string;
    won: boolean;
    behindAtMinute8: boolean;
    playStyle: PlayStyleLabel;
    styleConfidence: number;
  }): Promise<MatchFeedbackReceipt>;
  summary(): Promise<MatchFeedbackSummary>;
  writeRateLimit: RequestHandler;
  reportError?(error: unknown): void;
}

export function registerMatchFeedbackRoutes(
  app: Pick<Express, "get" | "post">,
  dependencies: MatchFeedbackRouterDependencies,
): void {
  dependencies.assertPolicyBinding(
    "match-feedback-write",
    "POST",
    "/api/vaultfront/match-rating",
  );
  const writeCertifiedFeedback = async (req: any, res: any) => {
    const parsed = MatchFeedbackInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid match feedback" });
    }
    const actor = await dependencies.authenticate(req, res);
    if (!actor) return;
    if (
      parsed.data.persistentId &&
      parsed.data.persistentId !== actor.persistentId
    ) {
      return res
        .status(403)
        .json({ error: "Identity claim does not match token" });
    }
    try {
      const evidence = await dependencies.resolveEvidence(
        parsed.data.gameId,
        actor,
      );
      if (
        !dependencies.authorize(
          "match-feedback-write",
          {
            hasVerifiedActor: true,
            hasVerifiedCertificate: evidence.hasVerifiedCertificate,
            certificateBindsActor: evidence.certificateBindsActor,
          },
          res,
        )
      ) {
        return;
      }
      if (!evidence.mapName) {
        return res.status(409).json({ error: "Certified map unavailable" });
      }
      const receipt = await dependencies.record({
        persistentId: actor.persistentId,
        gameId: parsed.data.gameId,
        mapName: evidence.mapName,
        matchRating: parsed.data.matchRating,
        mapRating: parsed.data.mapRating,
        ...(parsed.data.comment ? { comment: parsed.data.comment } : {}),
        won: evidence.won,
        behindAtMinute8: evidence.behindAtMinute8,
        playStyle: evidence.playStyle,
        styleConfidence: evidence.styleConfidence,
      });
      return res.status(receipt.accepted ? 201 : 409).json(receipt);
    } catch (error) {
      dependencies.reportError?.(error);
      return res.status(503).json({ error: "Match feedback unavailable" });
    }
  };
  app.post(
    "/api/vaultfront/match-rating",
    dependencies.writeRateLimit,
    writeCertifiedFeedback,
  );

  dependencies.assertPolicyBinding(
    "match-feedback-admin",
    "GET",
    "/api/admin/match-ratings",
  );
  app.get("/api/admin/match-ratings", async (req, res) => {
    if (
      !dependencies.authorize(
        "match-feedback-admin",
        { hasAdminToken: dependencies.isAdmin(req) },
        res,
      )
    ) {
      return;
    }
    try {
      return res.json(await dependencies.summary());
    } catch (error) {
      dependencies.reportError?.(error);
      return res.status(503).json({ error: "Match feedback unavailable" });
    }
  });
}
