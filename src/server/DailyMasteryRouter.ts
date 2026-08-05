import { z } from "zod";
import type {
  DailyMasterySnapshot,
  MasteryDoctrineSelectionReceipt,
} from "./CertifiedDailyMasteryStore";

export interface DailyMasteryAuthSuccess {
  type: "success";
  persistentId: string;
}

export interface DailyMasteryRouteDependencies {
  verifyToken: (
    token: string,
  ) => Promise<DailyMasteryAuthSuccess | { type: "error"; message?: string }>;
  getChallenge: (persistentId: string) => Promise<DailyMasterySnapshot>;
  selectDoctrine: (
    persistentId: string,
    doctrineId: string,
    requestId: string,
  ) => Promise<MasteryDoctrineSelectionReceipt>;
  rateLimit: (
    request: RouteRequest,
    response: RouteResponse,
    next: () => void,
  ) => unknown;
  reportError: (error: unknown) => void;
}

interface RouteRequest {
  headers: { authorization?: string };
  body?: unknown;
}

interface RouteResponse {
  status(code: number): RouteResponse;
  json(body: unknown): unknown;
}

interface RouteRegistrar {
  get(
    path: string,
    handler: (
      request: RouteRequest,
      response: RouteResponse,
    ) => Promise<unknown>,
  ): unknown;
  post(
    path: string,
    middleware: DailyMasteryRouteDependencies["rateLimit"],
    handler: (
      request: RouteRequest,
      response: RouteResponse,
    ) => Promise<unknown>,
  ): unknown;
}

const doctrineSelectionSchema = z
  .object({
    doctrineId: z.enum(["route-reader", "breach-architect", "vault-warden"]),
    requestId: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9:_-]+$/u),
  })
  .strict();

function doctrineErrorCode(
  error: unknown,
): "invalid-doctrine" | "insufficient-mastery" | "request-conflict" | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  return code === "invalid-doctrine" ||
    code === "insufficient-mastery" ||
    code === "request-conflict"
    ? code
    : null;
}

async function authenticate(
  request: RouteRequest,
  response: RouteResponse,
  verifyToken: DailyMasteryRouteDependencies["verifyToken"],
): Promise<DailyMasteryAuthSuccess | null> {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  if (!token) {
    response.status(401).json({ error: "Authentication required" });
    return null;
  }
  const auth = await verifyToken(token);
  if (auth.type === "error") {
    response.status(401).json({ error: "Invalid authentication" });
    return null;
  }
  return auth;
}

/** Register the authenticated, fail-closed Daily Mastery read contract. */
export function registerDailyMasteryRoute(
  app: RouteRegistrar,
  dependencies: DailyMasteryRouteDependencies,
): void {
  app.get("/api/vaultfront/daily-challenge", async (request, response) => {
    const auth = await authenticate(
      request,
      response,
      dependencies.verifyToken,
    );
    if (!auth) return;

    try {
      const snapshot = await dependencies.getChallenge(auth.persistentId);
      return response.json(snapshot);
    } catch (error) {
      dependencies.reportError(error);
      return response.status(503).json({ error: "Daily mastery unavailable" });
    }
  });

  app.post(
    "/api/vaultfront/mastery-doctrine",
    dependencies.rateLimit,
    async (request, response) => {
      const auth = await authenticate(
        request,
        response,
        dependencies.verifyToken,
      );
      if (!auth) return;
      const parsed = doctrineSelectionSchema.safeParse(request.body);
      if (!parsed.success) {
        return response
          .status(400)
          .json({ error: "Invalid doctrine selection" });
      }
      try {
        const receipt = await dependencies.selectDoctrine(
          auth.persistentId,
          parsed.data.doctrineId,
          parsed.data.requestId,
        );
        const snapshot = await dependencies.getChallenge(auth.persistentId);
        return response.json({ receipt, snapshot });
      } catch (error) {
        const code = doctrineErrorCode(error);
        if (code) {
          const status = code === "invalid-doctrine" ? 400 : 409;
          return response.status(status).json({
            error: error instanceof Error ? error.message : "Doctrine rejected",
            code,
          });
        }
        dependencies.reportError(error);
        return response
          .status(503)
          .json({ error: "Daily mastery unavailable" });
      }
    },
  );
}
