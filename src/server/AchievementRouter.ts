import { z } from "zod";
import type { VerifiedVaultFrontActor } from "./VaultFrontAuthorization";
import { verifyOptionalIdentityClaim } from "./VaultFrontAuthorization";

type Handler = (...args: any[]) => unknown;

export interface AchievementRouteApp {
  get(path: string, ...handlers: Handler[]): unknown;
}

export interface AchievementRouterDependencies {
  authenticate(req: any, res: any): Promise<VerifiedVaultFrontActor | null>;
  rateLimit: Handler;
  ensureHydrated(persistentId: string): Promise<unknown>;
  getProgress(persistentId: string): unknown;
  getMetaChainProgress(persistentId: string): unknown;
  getHydrationState(persistentId: string): unknown;
  reportError(error: unknown): void;
}

const PersistentIdSchema = z.string().min(1).max(64);

function requestedActor(req: any, res: any): string | null {
  const parsed = PersistentIdSchema.safeParse(req.params.persistentId);
  if (parsed.success) return parsed.data;
  res.status(400).json({ error: "Invalid persistentId" });
  return null;
}

function actorOwns(
  actor: VerifiedVaultFrontActor,
  requested: string,
  res: any,
): boolean {
  const verdict = verifyOptionalIdentityClaim(actor, requested);
  if (verdict.ok) return true;
  res.status(verdict.status).json({ error: verdict.error });
  return false;
}

export function registerAchievementRoutes(
  app: AchievementRouteApp,
  dependencies: AchievementRouterDependencies,
) {
  app.get(
    "/api/vaultfront/achievements/:persistentId",
    dependencies.rateLimit,
    async (req, res) => {
      const actor = await dependencies.authenticate(req, res);
      if (!actor) return;
      const requested = requestedActor(req, res);
      if (!requested || !actorOwns(actor, requested, res)) return;
      try {
        await dependencies.ensureHydrated(actor.persistentId);
        return res.json({
          ok: true,
          achievements: dependencies.getProgress(actor.persistentId),
          metaChains: dependencies.getMetaChainProgress(actor.persistentId),
          persistence: dependencies.getHydrationState(actor.persistentId),
        });
      } catch (error) {
        dependencies.reportError(error);
        return res
          .status(503)
          .json({ error: "Achievement profile unavailable" });
      }
    },
  );

  app.get(
    "/api/vaultfront/achievements/meta-chains/:persistentId",
    dependencies.rateLimit,
    async (req, res) => {
      const actor = await dependencies.authenticate(req, res);
      if (!actor) return;
      const requested = requestedActor(req, res);
      if (!requested || !actorOwns(actor, requested, res)) return;
      try {
        await dependencies.ensureHydrated(actor.persistentId);
        return res.json({
          ok: true,
          metaChains: dependencies.getMetaChainProgress(actor.persistentId),
          persistence: dependencies.getHydrationState(actor.persistentId),
        });
      } catch (error) {
        dependencies.reportError(error);
        return res
          .status(503)
          .json({ error: "Achievement profile unavailable" });
      }
    },
  );
}
