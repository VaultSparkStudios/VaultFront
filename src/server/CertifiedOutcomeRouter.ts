import { z } from "zod";
import type {
  CertifiedOutcomeStore,
  CertifiedStyleProfile,
} from "./CertifiedOutcomeStore";

type RouteHandler = (req: any, res: any) => unknown;

export interface CertifiedOutcomeRouteApp {
  get(path: string, ...handlers: RouteHandler[]): unknown;
}

export interface CertifiedOutcomeRouterDependencies {
  authenticate(req: any, res: any): Promise<{ persistentId: string } | null>;
  acceptActorClaim(
    actor: { persistentId: string },
    claimedPersistentId: string,
    res: any,
  ): boolean;
  isAdmin(req: any): boolean;
  profile(persistentId: string): Promise<CertifiedStyleProfile>;
  summary(): ReturnType<CertifiedOutcomeStore["summary"]>;
  reportError(error: unknown): void;
}

const PersistentIdSchema = z.string().min(1).max(64);

export function registerCertifiedOutcomeRoutes(
  app: CertifiedOutcomeRouteApp,
  dependencies: CertifiedOutcomeRouterDependencies,
) {
  app.get("/api/vaultfront/style-history/:persistentId", async (req, res) => {
    const parsed = PersistentIdSchema.safeParse(req.params.persistentId);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid persistentId" });
    }
    const actor = await dependencies.authenticate(req, res);
    if (!actor || !dependencies.acceptActorClaim(actor, parsed.data, res)) {
      return;
    }
    try {
      return res.json({
        ok: true,
        ...(await dependencies.profile(actor.persistentId)),
      });
    } catch (error) {
      dependencies.reportError(error);
      return res.status(503).json({ error: "Style profile unavailable" });
    }
  });

  app.get("/api/admin/vaultfront/certified-outcomes", async (req, res) => {
    if (!dependencies.isAdmin(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      return res.json(await dependencies.summary());
    } catch (error) {
      dependencies.reportError(error);
      return res.status(503).json({ error: "Outcome summary unavailable" });
    }
  });
}
