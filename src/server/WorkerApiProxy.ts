import type { NextFunction, Request, Response } from "express";
import http from "node:http";

const GAME_ID_PATHS = [
  /^\/api\/(?:create_game|start_game|game)\/([^/?]+)/u,
  /^\/api\/(?:invite|rematch)\/(?:status\/)?([^/?]+)/u,
  /^\/api\/replay\/([^/?]+)/u,
  /^\/api\/stream\/([^/?]+)/u,
  /^\/api\/vaultfront\/(?:narrator|match-recap|progression-dividend)\/([^/?]+)/u,
  /^\/api\/vaultfront\/prediction-league\/games\/([^/?]+)\/consensus/u,
] as const;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function boundedGameId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : null;
}

export function resolveWorkerApiGameId(
  req: Pick<Request, "path" | "body" | "query">,
): string | null {
  for (const pattern of GAME_ID_PATHS) {
    const match = pattern.exec(req.path);
    if (match?.[1]) {
      try {
        return boundedGameId(decodeURIComponent(match[1]));
      } catch {
        return null;
      }
    }
  }
  const body = req.body as Record<string, unknown> | undefined;
  return (
    boundedGameId(body?.gameId) ??
    boundedGameId(body?.gameID) ??
    boundedGameId(req.query.gameId) ??
    boundedGameId(req.query.gameID)
  );
}

export interface WorkerApiProxyOptions {
  workerIndex(gameId: string): number;
  workerPortByIndex(index: number): number;
  defaultWorkerIndex?: number;
  reportError?: (error: unknown) => void;
}

/**
 * Bridges same-origin project APIs from the public master to the worker plane.
 * Game-bound requests retain the canonical game-id shard; global durable APIs
 * use one stable control-plane worker instead of falling through to index.html.
 */
export function createWorkerApiProxy(options: WorkerApiProxyOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith("/api/")) {
      next();
      return;
    }

    const gameId = resolveWorkerApiGameId(req);
    const workerIndex = gameId
      ? options.workerIndex(gameId)
      : (options.defaultWorkerIndex ?? 0);
    const body =
      req.body !== undefined &&
      req.body !== null &&
      req.method !== "GET" &&
      req.method !== "HEAD"
        ? Buffer.from(JSON.stringify(req.body))
        : null;
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (
        !HOP_BY_HOP_HEADERS.has(name.toLowerCase()) &&
        name.toLowerCase() !== "host"
      ) {
        headers[name] = value;
      }
    }
    if (body) headers["content-length"] = String(body.byteLength);
    else delete headers["content-length"];
    if (body) delete headers["content-encoding"];
    headers["x-vaultfront-api-shard"] = String(workerIndex);

    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: options.workerPortByIndex(workerIndex),
        path: req.originalUrl,
        method: req.method,
        headers,
      },
      (upstreamResponse) => {
        res.status(upstreamResponse.statusCode ?? 502);
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (
            !HOP_BY_HOP_HEADERS.has(name.toLowerCase()) &&
            value !== undefined
          ) {
            res.setHeader(name, value);
          }
        }
        res.setHeader("x-vaultfront-api-shard", String(workerIndex));
        upstreamResponse.pipe(res);
      },
    );
    upstream.setTimeout(15_000, () =>
      upstream.destroy(new Error("worker API timeout")),
    );
    upstream.on("error", (error) => {
      options.reportError?.(error);
      if (!res.headersSent) {
        res.status(503).json({
          error: "Project API unavailable",
          code: "worker-api-unavailable",
        });
      } else {
        res.end();
      }
    });
    if (body) upstream.end(body);
    else upstream.end();
  };
}
