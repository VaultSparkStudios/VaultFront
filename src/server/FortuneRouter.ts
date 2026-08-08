import { z } from "zod";
import type { FortuneCollectionEntry } from "./FortuneDeck";

interface RequestLike {
  body: unknown;
  params: Record<string, string>;
  headers: { authorization?: string };
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): unknown;
}

interface RegistrarLike {
  get(
    path: string,
    handler: (req: RequestLike, res: ResponseLike) => Promise<unknown>,
  ): unknown;
  post(
    path: string,
    middleware: unknown,
    handler: (req: RequestLike, res: ResponseLike) => Promise<unknown>,
  ): unknown;
}

export interface FortuneRouterDependencies {
  authenticate: (
    req: any,
    res: any,
  ) => Promise<{ persistentId: string } | null>;
  getCollection: (persistentId: string) => Promise<FortuneCollectionEntry[]>;
  getEquippedTitle: (persistentId: string) => Promise<string | null>;
  equipTitle: (
    persistentId: string,
    itemId: string,
  ) => Promise<{ ok: true; title: string } | { ok: false; error: string }>;
  rateLimit: unknown;
}

/**
 * S99 audit #180: closes the Fortune Deck reward->progression loop with a
 * read path (what did I win) and an equip slot (show it off next match).
 */
export function registerFortuneRoutes(
  app: RegistrarLike,
  dependencies: FortuneRouterDependencies,
): void {
  app.get(
    "/api/vaultfront/fortune-collection/:persistentId",
    async (req, res) => {
      const actor = await dependencies.authenticate(req, res);
      if (!actor || actor.persistentId !== req.params.persistentId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const [items, equippedTitle] = await Promise.all([
        dependencies.getCollection(actor.persistentId),
        dependencies.getEquippedTitle(actor.persistentId),
      ]);
      return res.json({ items, equippedTitle });
    },
  );

  app.post(
    "/api/vaultfront/fortune-collection/equip",
    dependencies.rateLimit,
    async (req, res) => {
      const actor = await dependencies.authenticate(req, res);
      if (!actor) return res.status(401).json({ error: "Unauthorized" });
      const parsed = z
        .object({ itemId: z.string().min(1).max(64) })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: z.prettifyError(parsed.error) });
      }
      const result = await dependencies.equipTitle(
        actor.persistentId,
        parsed.data.itemId,
      );
      if (!result.ok) return res.status(409).json({ error: result.error });
      return res.json({ ok: true, title: result.title });
    },
  );
}
