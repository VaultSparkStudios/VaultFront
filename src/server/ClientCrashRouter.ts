import { z } from "zod";
import type { ClientCrashEvent } from "./ClientCrashStore";

const clientCrashSchema = z
  .object({
    kind: z.enum(["error", "unhandledrejection"]),
    message: z.string().min(1).max(500),
    stackHash: z
      .string()
      .regex(/^[a-f0-9]{8,16}$/)
      .optional(),
    tick: z.number().int().min(0).max(10_000_000).optional(),
    gameId: z.string().min(1).max(64).optional(),
  })
  .strict();

interface RequestLike {
  body: unknown;
  headers: { authorization?: string };
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): unknown;
}

interface RegistrarLike {
  post(
    path: string,
    middleware: unknown,
    handler: (req: RequestLike, res: ResponseLike) => Promise<unknown>,
  ): unknown;
}

export interface ClientCrashRouteDependencies {
  rateLimit: unknown;
  resolveActor: (request: RequestLike) => Promise<{ actorKey: string } | null>;
  record: (event: ClientCrashEvent) => void;
  reportError: (error: unknown) => void;
}

/**
 * S99 audit #183: a bounded, actor-scoped client crash beacon. Never
 * receives or persists raw stack text -- only a caller-computed digest,
 * a short message, and gameplay context the client already has.
 */
export function registerClientCrashRoutes(
  app: RegistrarLike,
  dependencies: ClientCrashRouteDependencies,
): void {
  app.post(
    "/api/vaultfront/client-crash",
    dependencies.rateLimit,
    async (request, response) => {
      const actor = await dependencies.resolveActor(request);
      if (!actor) {
        return response
          .status(401)
          .json({ error: "Authenticated play token required" });
      }
      const parsed = clientCrashSchema.safeParse(request.body);
      if (!parsed.success) {
        return response
          .status(400)
          .json({ error: z.prettifyError(parsed.error) });
      }
      try {
        dependencies.record({
          actorKey: actor.actorKey,
          kind: parsed.data.kind,
          message: parsed.data.message,
          stackHash: parsed.data.stackHash ?? null,
          tick: parsed.data.tick ?? null,
          gameId: parsed.data.gameId ?? null,
          at: Date.now(),
        });
        return response.status(202).json({ ok: true });
      } catch (error) {
        dependencies.reportError(error);
        return response
          .status(503)
          .json({ error: "Crash telemetry unavailable" });
      }
    },
  );
}
