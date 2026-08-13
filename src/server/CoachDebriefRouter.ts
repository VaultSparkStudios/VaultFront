import type Anthropic from "@anthropic-ai/sdk";
import type { Application, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type {
  GameRecord,
  MatchResultCertificate,
  PlayerRecord,
} from "../core/Schemas";
import {
  BoundedTtlCache,
  buildCanonicalAiEvidence,
  buildCanonicalAiResponseReceipt,
  parseCoachProviderOutput,
} from "./CanonicalAiEvidence";
import { buildLocalCoachDebrief } from "./LocalCoachDebrief";
import { reserveRemoteAiCall } from "./RemoteAiPolicy";
import { COACH_DEBRIEF_SYSTEM_PROMPT } from "./RemoteAiPrompts";
import { executeRequestBoundAi } from "./RequestBoundRemoteAi";
import type { VerifiedVaultFrontActor } from "./VaultFrontAuthorization";

interface CoachContext {
  record: GameRecord;
  certificate: MatchResultCertificate;
  participant: PlayerRecord;
}

export interface CoachDebriefRouteOptions {
  rateLimit: RequestHandler;
  authenticate(
    req: Request,
    res: Response,
  ): Promise<VerifiedVaultFrontActor | null>;
  acceptClaim(
    actor: VerifiedVaultFrontActor,
    claimedPersistentId: string | undefined,
    res: Response,
  ): boolean;
  loadContext(
    gameId: string,
    actor: VerifiedVaultFrontActor,
    res: Response,
  ): Promise<CoachContext | null>;
  anthropic: Anthropic;
  assertPolicyBinding(
    policyId: "coach-debrief",
    method: "POST",
    route: string,
  ): void;
  reportError(error: unknown): void;
}

const cache = new BoundedTtlCache<{
  moments: ReturnType<typeof parseCoachProviderOutput>;
  receipt: ReturnType<typeof buildCanonicalAiResponseReceipt>;
}>({ maxEntries: 500, ttlMs: 24 * 60 * 60 * 1_000 });

export function registerCoachDebriefRoute(
  app: Application,
  options: CoachDebriefRouteOptions,
): void {
  const route = "/api/vaultfront/coach-debrief";
  options.assertPolicyBinding("coach-debrief", "POST", route);
  app.post(
    "/api/vaultfront/coach-debrief",
    options.rateLimit,
    async (req, res) => {
      const parsed = z
        .object({
          persistentId: z.string().max(64).optional(),
          gameId: z.string().max(64),
          activityLog: z.unknown().optional(),
          matchStats: z.unknown().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Invalid request" });
      const actor = await options.authenticate(req, res);
      if (!actor || !options.acceptClaim(actor, parsed.data.persistentId, res))
        return;
      const context = await options.loadContext(parsed.data.gameId, actor, res);
      if (!context) return;
      const canonicalInputs = {
        info: context.record.info,
        turns: context.record.turns,
        result: context.certificate.result,
      };
      const evidence = buildCanonicalAiEvidence({
        feature: "coach",
        certificate: context.certificate,
        canonicalInputs,
        requester: actor.persistentId,
      });
      const localMoments = buildLocalCoachDebrief(
        context.record,
        context.participant.clientID,
      );
      const cached = cache.get(evidence.cacheKey);
      if (cached) {
        return res.json({
          ok: true,
          ...cached,
          cached: true,
          evidence,
          source: "remote-enhanced",
        });
      }
      try {
        if (!(await reserveRemoteAiCall("debrief")).allowed) {
          return res.json({
            ok: true,
            moments: localMoments,
            evidence,
            source: "certified-local",
          });
        }
        const message = await executeRequestBoundAi(
          res,
          (signal) =>
            options.anthropic.messages.create(
              {
                model: "claude-haiku-4-5-20251001",
                max_tokens: 400,
                system: [
                  {
                    type: "text",
                    text: COACH_DEBRIEF_SYSTEM_PROMPT,
                    cache_control: { type: "ephemeral" },
                  },
                ],
                messages: [
                  {
                    role: "user",
                    content: JSON.stringify({ evidence, canonicalInputs }),
                  },
                ],
              },
              { signal },
            ),
          8_000,
        );
        const raw =
          (message.content[0] as { type: string; text: string }).text?.trim() ??
          "[]";
        const moments = parseCoachProviderOutput(
          raw,
          context.record.info.num_turns,
        );
        const receipt = buildCanonicalAiResponseReceipt({
          evidence,
          output: moments,
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
        });
        cache.set(evidence.cacheKey, { moments, receipt });
        return res.json({
          ok: true,
          moments,
          evidence,
          receipt,
          source: "remote-enhanced",
        });
      } catch (error) {
        options.reportError(error);
        if (!res.headersSent) {
          return res.json({
            ok: true,
            moments: localMoments,
            evidence,
            source: "certified-local",
          });
        }
        return;
      }
    },
  );
}
