import type { Application, RequestHandler } from "express";
import express from "express";
import rateLimit from "express-rate-limit";

export const DEFAULT_JSON_BODY_LIMIT = "64kb";
export const LARGE_JSON_BODY_LIMIT = "5mb";

export interface RequestAdmissionOptions {
  trustProxyHops?: number;
  coarseLimiter?: RequestHandler;
}

/**
 * Installs coarse request admission before any JSON allocation, then mounts
 * the one large legacy archive body budget ahead of the small default parser.
 */
export function installPreparseRequestAdmission(
  app: Application,
  options: RequestAdmissionOptions = {},
): void {
  app.set("trust proxy", options.trustProxyHops ?? 3);
  app.use(
    options.coarseLimiter ??
      rateLimit({
        windowMs: 1_000,
        max: 20,
        standardHeaders: "draft-7",
        legacyHeaders: false,
      }),
  );
  app.use(
    "/api/archive_singleplayer_game",
    express.json({ limit: LARGE_JSON_BODY_LIMIT }),
  );
  app.use(express.json({ limit: DEFAULT_JSON_BODY_LIMIT }));
}
