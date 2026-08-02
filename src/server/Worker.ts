import Anthropic from "@anthropic-ai/sdk";
import compression from "compression";
import cors from "cors";
import { createHash } from "crypto";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import http from "http";
import ipAnonymize from "ip-anonymize";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import {
  activityCountsFromPlayerStats,
  classifyPlayStyle,
} from "../core/PlayStyleClassifier";
import {
  ClientMessageSchema,
  GameID,
  PartialGameRecordSchema,
  PersistentIdSchema,
  ServerErrorMessage,
} from "../core/Schemas";
import { generateID, replacer } from "../core/Util";
import { CreateGameInputSchema } from "../core/WorkerSchemas";
import { archive, finalizeGameRecord, readGameRecord } from "./Archive";
import {
  BoundedTtlCache,
  buildCanonicalAiEvidence,
  buildCanonicalAiResponseReceipt,
  parseCoachProviderOutput,
  parseOracleProviderOutput,
  parseRecapProviderOutput,
  withAiDeadline,
} from "./CanonicalAiEvidence";
import { certifiedDailyMasteryStore } from "./CertifiedDailyMasteryStore";
import {
  certificateBindsPersistentIds,
  certifiedWinnerPersistentIds,
  certifyArchivedGame,
} from "./CertifiedGameAuthority";
import { certifiedLoopEvidenceStore } from "./CertifiedLoopEvidenceStore";
import { registerCertifiedOutcomeRoutes } from "./CertifiedOutcomeRouter";
import { certifiedOutcomeStore } from "./CertifiedOutcomeStore";
import { certifiedSeasonContractStore } from "./CertifiedSeasonContractStore";
import { Client } from "./Client";
import { registerDailyMasteryRoute } from "./DailyMasteryRouter";
import { EloRating } from "./EloRating";
import {
  experimentControlPlane,
  registerExperimentRoutes,
} from "./ExperimentRouter";
import { GameCreationAdmissionGuard } from "./GameCreationAdmission";
import { GameAllocationError, GameManager } from "./GameManager";
import { registerGamePreviewRoute } from "./GamePreviewRoute";
import { getUserMe, verifyClientToken } from "./jwt";
import { logger } from "./Logger";
import { registerLoopEvidenceRoutes } from "./LoopEvidenceRouter";
import { registerMatchFeedbackRoutes } from "./MatchFeedbackRouter";
import { matchFeedbackStore } from "./MatchFeedbackStore";
import { verifyMatchResultCertificate } from "./MatchResultCertificate";
import { playerStatsStore } from "./PlayerStatsStore";
import { registerPlaytestEvidenceRoutes } from "./PlaytestEvidenceRouter";
import { playtestEvidenceStore } from "./PlaytestEvidenceStore";
import {
  assertRoutePolicyBinding,
  evaluateRouteAuthorization,
  getRoutePolicy,
  type RouteAuthorizationContext,
  type RoutePolicyId,
} from "./RoutePolicyManifest";

import { GameEnv } from "../core/configuration/Config";
import { registerAchievementRoutes } from "./AchievementRouter";
import { achievementStore } from "./AchievementStore";
import { antiCheatMonitor } from "./AntiCheatMonitor";
import { clanStore } from "./ClanStore";
import { clanWarStore } from "./ClanWarStore";
import {
  databaseAllowsRequest,
  databaseReady,
  getDatabasePosture,
  pool,
} from "./db/pool";
import { fortuneDeck } from "./FortuneDeck";
import { MapPlaylist } from "./MapPlaylist";
import { narratorBus, type NarratorPersona } from "./NarratorBus";
import { type MatchHistoryEntry } from "./PlayerStatsStore";
import { startPolling } from "./PollingLoop";
import { registerPredictionLeagueRoutes } from "./PredictionLeagueRouter";
import { predictionLeagueStore } from "./PredictionLeagueStore";
import { PrivilegeRefresher } from "./PrivilegeRefresher";
import { registerProgressionRoutes } from "./ProgressionRouter";
import { authorizeArchivedRematchSource } from "./RematchAuthorization";
import { registerRematchRoutes } from "./RematchRouter";
import { rematchStore } from "./RematchStore";
import {
  canAttemptRemoteAi,
  remoteAiPosture,
  reserveRemoteAiCall,
} from "./RemoteAiPolicy";
import { replayHighlightStore } from "./ReplayHighlightStore";
import {
  createReplayShareProjection,
  ReplayShareContractError,
} from "./ReplayShareContract";
import { getReplayIntegrityPosture, replayStore } from "./ReplayStore";
import { buildRuntimeIntegrityPassport } from "./RuntimeIntegrityPassport";
import { registerSeasonCommunityRoutes } from "./SeasonCommunityRouter";
import { registerSeasonContractRoutes } from "./SeasonContractRouter";
import {
  MAX_SPECTATOR_BUFFERED_BYTES,
  MAX_SPECTATORS_PER_GAME,
  MAX_SPECTATORS_PER_WORKER,
} from "./SpectatorBus";
import { buildStateScopeLedger } from "./StateScopeLedger";
import { streamingBus } from "./StreamingBus";
import { tournamentStore } from "./TournamentStore";
import { verifyTurnstileToken } from "./Turnstile";
import { tutorialOrchestrator } from "./TutorialOrchestrator";
import {
  canManageClan,
  canManageTournament,
  verifyOptionalIdentityClaim,
  type VerifiedVaultFrontActor,
} from "./VaultFrontAuthorization";
import { recordVaultFrontPlaytestPulse } from "./VaultFrontPlaytestPulse";
import { buildVaultFrontReadiness } from "./VaultFrontReadiness";
import { vaultSeasonScheduler } from "./VaultSeasonScheduler";
import { createVerifiedWorkerRoutedGameId } from "./WorkerGameId";
import { buildWorkerHealthHeartbeat } from "./WorkerHealthHeartbeat";
import {
  LOBBY_MAX_BUFFERED_BYTES,
  LOBBY_WS_MAX_PAYLOAD_BYTES,
  SPECTATOR_WS_MAX_PAYLOAD_BYTES,
  WorkerLobbyService,
} from "./WorkerLobbyService";
import { initWorkerMetrics } from "./WorkerMetrics";

const config = getServerConfigFromServer();

const workerId = parseInt(process.env.WORKER_ID ?? "0");
const log = logger.child({ comp: `w_${workerId}` });
const playlist = new MapPlaylist();

function privacySafeActorKey(persistentId: string): string {
  return createHash("sha256")
    .update(`vaultfront-alpha-evidence:v1:${persistentId}`)
    .digest("hex")
    .slice(0, 24);
}

async function resolveAuthenticatedActorKey(
  req: Request,
): Promise<{ actorKey: string; persistentId: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const verified = await verifyClientToken(
    authHeader.substring("Bearer ".length),
    config,
  );
  if (verified.type !== "success") return null;
  return {
    actorKey: privacySafeActorKey(verified.persistentId),
    persistentId: verified.persistentId,
  };
}

async function resolveVaultFrontIdentity(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring("Bearer ".length);
    const verified = await verifyClientToken(token, config);
    if (verified.type === "success") {
      return `auth:${verified.persistentId}`;
    }
  }

  const rawHeader = req.headers["x-vaultfront-client-id"];
  const clientId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (
    typeof clientId === "string" &&
    PersistentIdSchema.safeParse(clientId).success
  ) {
    return `anon:${clientId}`;
  }

  return null;
}
async function requireVaultFrontActor(
  req: Request,
  res: Response,
): Promise<VerifiedVaultFrontActor | null> {
  const actor = await resolveAuthenticatedActorKey(req);
  if (actor) return actor;
  res.status(401).json({ error: "Authenticated play token required" });
  return null;
}

function acceptActorClaim(
  actor: VerifiedVaultFrontActor,
  claimedPersistentId: string | undefined,
  res: Response,
): boolean {
  const verdict = verifyOptionalIdentityClaim(actor, claimedPersistentId);
  if (verdict.ok) return true;
  res.status(verdict.status).json({ error: verdict.error });
  return false;
}

function authorizeRoutePolicy(
  id: RoutePolicyId,
  context: RouteAuthorizationContext,
  res: Response,
): boolean {
  // Resolve the manifest entry on every protected request so a missing/renamed
  // policy fails closed instead of leaving documentation detached from code.
  getRoutePolicy(id);
  const decision = evaluateRouteAuthorization(id, context);
  if (decision.allowed) return true;
  res.status(decision.status).json({ error: decision.reason });
  return false;
}

async function loadCertifiedAiContext(
  gameID: string,
  actor: VerifiedVaultFrontActor,
  policyId: "match-coach" | "match-recap" | "coach-debrief" | "dynasty-story",
  res: Response,
) {
  const certified = certifyArchivedGame(
    gameID,
    await readGameRecord(gameID as GameID),
  );
  const participant =
    "error" in certified
      ? undefined
      : certified.record.info.players.find(
          (player) => player.persistentID === actor.persistentId,
        );
  const certificateBindsActor =
    !("error" in certified) &&
    certificateBindsPersistentIds(certified, [actor.persistentId]) &&
    Boolean(
      participant &&
      certified.certificate.result.allPlayersStats[participant.clientID],
    );
  if (
    !authorizeRoutePolicy(
      policyId,
      {
        hasVerifiedActor: true,
        hasVerifiedCertificate: !("error" in certified),
        certificateBindsActor,
      },
      res,
    )
  ) {
    return null;
  }
  if ("error" in certified || !participant) return null;
  return {
    record: certified.record,
    certificate: certified.certificate,
    participant,
  };
}

// Worker setup
export async function startWorker() {
  log.info(`Worker starting...`);
  await databaseReady;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const app = express();

  // ── Security middleware ───────────────────────────────────────────────────
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((s) =>
    s.trim(),
  ) ?? [
    "https://play-vaultfront.vaultsparkstudios.com",
    "https://vaultsparkstudios.com",
    ...(config.env() === GameEnv.Dev
      ? ["http://localhost:5173", "http://localhost:3000"]
      : []),
  ];
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(
    helmet({
      contentSecurityPolicy: false, // CSP enforced by nginx
      crossOriginEmbedderPolicy: false, // Pixi.js canvas resources
    }),
  );
  // ─────────────────────────────────────────────────────────────────────────

  app.use(express.json({ limit: "5mb" }));
  app.use((req, res, next) => {
    const database = getDatabasePosture();
    if (!databaseAllowsRequest(database, req.method)) {
      return res.status(503).json({
        error: "Configured persistence is unavailable",
        code: "database-unavailable",
      });
    }
    next();
  });
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const gm = new GameManager(config, log);
  const gameCreationAdmission = new GameCreationAdmissionGuard(12, 60_000);

  // Initialize lobby service (handles WebSocket upgrade routing)
  const lobbyService = new WorkerLobbyService(server, wss, gm, log);
  let workerHealthHeartbeatTimer: NodeJS.Timeout | null = null;

  const publishWorkerHealth = (): void => {
    lobbyService.sendHealthHeartbeat(
      workerId,
      buildWorkerHealthHeartbeat({
        gameLoop: gm.healthSnapshot(),
        ipc: lobbyService.ipcHealthSnapshot(),
        database: getDatabasePosture(),
      }),
    );
  };

  setTimeout(
    () => {
      startMatchmakingPolling(gm);
    },
    1000 + Math.random() * 2000,
  );

  if (config.otelEnabled()) {
    initWorkerMetrics(gm);
  }

  await vaultSeasonScheduler.start();
  antiCheatMonitor.start();

  const privilegeRefresher = new PrivilegeRefresher(
    config.jwtIssuer() + "/cosmetics.json",
    config.jwtIssuer() + "/profane_words_game_server",
    config.apiKey(),
    log,
  );
  privilegeRefresher.start();

  // Middleware to handle /wX path prefix
  app.use((req, res, next) => {
    // Extract the original path without the worker prefix
    const originalPath = req.url;
    const match = originalPath.match(/^\/w(\d+)(.*)$/);

    if (match) {
      const pathWorkerId = parseInt(match[1]);
      const actualPath = match[2] || "/";

      // Verify this request is for the correct worker
      if (pathWorkerId !== workerId) {
        return res.status(404).json({
          error: "Worker mismatch",
          message: `This is worker ${workerId}, but you requested worker ${pathWorkerId}`,
        });
      }

      // Update the URL to remove the worker prefix
      req.url = actualPath;
    }

    next();
  });

  app.set("trust proxy", 3);
  app.use(compression());
  app.use(express.json());

  // Configure MIME types for webp files
  express.static.mime.define({ "image/webp": ["webp"] });

  app.use(express.static(path.join(__dirname, "../../out")));
  app.use(
    "/maps",
    express.static(path.join(__dirname, "../../static/maps"), {
      maxAge: "1y",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".webp")) {
          res.setHeader("Content-Type", "image/webp");
        }
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: 1000, // 1 second
      max: 20, // 20 requests per IP per second
    }),
  );

  assertRoutePolicyBinding("readiness", "GET", "/api/vaultfront/readiness");
  const handleWorkerReadiness = async (_req: Request, res: Response) => {
    if (!authorizeRoutePolicy("readiness", {}, res)) return;
    const gameLoop = gm.healthSnapshot();
    const ipc = lobbyService.ipcHealthSnapshot();
    const database = getDatabasePosture();
    const persistence = buildStateScopeLedger(database);
    const healthy =
      gameLoop.healthy &&
      ipc.healthy &&
      database.state !== "connecting" &&
      database.state !== "failed";
    const playtestPulse = await playtestEvidenceStore.summary();
    const payload = buildVaultFrontReadiness({
      healthy,
      processRole: "worker",
      workerId,
      healthEvidence: {
        scope: "process-local-worker",
        httpRequest: "responding",
        ipcConnected: ipc.connected,
        ipcWatermark: ipc,
        gameLoop,
      },
      revenueSignal:
        process.env.VAULTFRONT_REVENUE_OBSERVED === "1"
          ? {
              status: "observed",
              observedAt: process.env.VAULTFRONT_REVENUE_OBSERVED_AT,
            }
          : { status: "unverified" },
      playtestPulse,
      replayIntegrity: getReplayIntegrityPosture(),
      persistence,
      rightsEvidence: {
        status: "declared",
        path: "LICENSE and LICENSING.md",
      },
    });
    return res.status(healthy ? 200 : 503).json(payload);
  };
  app.get("/api/vaultfront/readiness", handleWorkerReadiness);
  // Infrastructure probes use this canonical alias; both paths share the live
  // readiness computation and can never drift into a fabricated static 200.
  app.get("/_health", handleWorkerReadiness);

  assertRoutePolicyBinding(
    "runtime-integrity",
    "GET",
    "/api/admin/vaultfront/runtime-integrity-passport",
  );
  app.get("/api/admin/vaultfront/runtime-integrity-passport", (req, res) => {
    if (
      !authorizeRoutePolicy(
        "runtime-integrity",
        {
          hasAdminToken:
            req.headers[config.adminHeader()] === config.adminToken(),
        },
        res,
      )
    )
      return;
    const gameLoop = gm.healthSnapshot();
    const ipc = lobbyService.ipcHealthSnapshot();
    const stateScopeLedger = buildStateScopeLedger(getDatabasePosture());
    const passport = buildRuntimeIntegrityPassport({
      workerId,
      observedAt: new Date().toISOString(),
      health: {
        httpResponding: true,
        ipc,
        gameLoop,
      },
      experimentIntegrity: experimentControlPlane.integritySnapshot(),
      remoteAi: remoteAiPosture(),
      websocketPolicy: {
        lobbyMaxPayloadBytes: LOBBY_WS_MAX_PAYLOAD_BYTES,
        spectatorMaxPayloadBytes: SPECTATOR_WS_MAX_PAYLOAD_BYTES,
        lobbyMaxBufferedBytes: LOBBY_MAX_BUFFERED_BYTES,
        spectatorMaxBufferedBytes: MAX_SPECTATOR_BUFFERED_BYTES,
        maxSpectatorsPerGame: MAX_SPECTATORS_PER_GAME,
        maxSpectatorsPerWorker: MAX_SPECTATORS_PER_WORKER,
      },
      ssePolicy: {
        streaming: streamingBus.integritySnapshot(),
        narrator: narratorBus.integritySnapshot(),
      },
      stateScopeLedger,
    });
    return res.status(passport.status === "fail" ? 503 : 200).json(passport);
  });

  assertRoutePolicyBinding("create-game", "POST", "/api/create_game/:id");
  app.post("/api/create_game/:id", async (req, res) => {
    const id = req.params.id;

    // Extract persistentID from Authorization header token
    // Never accept persistentID directly from client
    let creatorPersistentID: string | undefined;
    const authHeader = req.headers.authorization;
    const adminHeaderValue = req.headers[config.adminHeader()];
    const hasAdminHeader = adminHeaderValue !== undefined;
    const adminAuthorized = adminHeaderValue === config.adminToken();
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring("Bearer ".length);
      const result = await verifyClientToken(token, config);
      if (result.type === "success") {
        creatorPersistentID = result.persistentId;
      } else {
        log.warn(`Invalid creator token: ${result.message}`);
        return res.status(401).json({ error: "Invalid creator token" });
      }
    } else if (!adminAuthorized) {
      return res.status(hasAdminHeader ? 403 : 401).json({
        error: hasAdminHeader
          ? "Invalid admin authorization"
          : "Authorization required to create a game",
      });
    }
    if (
      !authorizeRoutePolicy(
        "create-game",
        {
          hasVerifiedActor: creatorPersistentID !== undefined,
          hasAdminToken: adminAuthorized,
        },
        res,
      )
    )
      return;

    if (!id) {
      log.warn(`cannot create game, id not found`);
      return res.status(400).json({ error: "Game ID is required" });
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const clientIP = req.ip || req.socket.remoteAddress || "unknown";
    const result = CreateGameInputSchema.safeParse(req.body);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      return res.status(400).json({ error });
    }

    const gc = result.data;
    if (gc?.gameType === GameType.Public && !adminAuthorized) {
      log.warn(
        `cannot create public game ${id}, ip ${ipAnonymize(clientIP)} incorrect admin token`,
      );
      return res
        .status(403)
        .json({ error: "Public game creation is forbidden" });
    }

    // Double-check this worker should host this game
    const expectedWorkerId = config.workerIndex(id);
    if (expectedWorkerId !== workerId) {
      log.warn(
        `This game ${id} should be on worker ${expectedWorkerId}, but this is worker ${workerId}`,
      );
      return res.status(400).json({ error: "Worker, game id mismatch" });
    }

    const actorKey = creatorPersistentID
      ? `actor:${creatorPersistentID}`
      : `admin:${ipAnonymize(clientIP)}`;
    const quota = gameCreationAdmission.consume(actorKey);
    if (!quota.allowed) {
      res.setHeader("Retry-After", Math.ceil(quota.retryAfterMs / 1000));
      return res.status(429).json({ error: "Game creation rate exceeded" });
    }

    let game;
    try {
      game = gm.createGame(id, gc, creatorPersistentID);
    } catch (error) {
      if (error instanceof GameAllocationError) {
        return res.status(error.code === "collision" ? 409 : 503).json({
          error:
            error.code === "collision"
              ? "Game ID already exists"
              : "Worker game capacity reached",
        });
      }
      throw error;
    }

    log.info(
      `Worker ${workerId}: IP ${ipAnonymize(clientIP)} creating ${game.isPublic() ? GameType.Public : GameType.Private}${gc?.gameMode ? ` ${gc.gameMode}` : ""} game with id ${id}${creatorPersistentID ? `, creator: ${creatorPersistentID.substring(0, 8)}...` : ""}`,
    );
    res.json(game.gameInfo());
  });

  // Add other endpoints from your original server
  app.post("/api/start_game/:id", async (req, res) => {
    log.info(`starting private lobby with id ${req.params.id}`);
    const game = gm.game(req.params.id);
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    if (game.isPublic()) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const clientIP = req.ip || req.socket.remoteAddress || "unknown";
      log.info(
        `cannot start public game ${game.id}, game is public, ip: ${ipAnonymize(clientIP)}`,
      );
      return res
        .status(403)
        .json({ error: "Public games cannot be started here" });
    }
    const actor = await requireVaultFrontActor(req, res);
    if (!actor) return;
    if (!game.isCreator(actor.persistentId)) {
      return res
        .status(403)
        .json({ error: "Only the lobby creator can start this game" });
    }
    game.start();
    return res.status(200).json({ success: true });
  });

  app.get("/api/game/:id/exists", async (req, res) => {
    const lobbyId = req.params.id;
    res.json({
      exists: gm.game(lobbyId) !== null,
    });
  });

  app.get("/api/game/:id", async (req, res) => {
    const game = gm.game(req.params.id);
    if (game === null) {
      log.info(`lobby ${req.params.id} not found`);
      return res.status(404).json({ error: "Game not found" });
    }
    res.json(game.gameInfo());
  });

  registerDailyMasteryRoute(app, {
    verifyToken: (token) => verifyClientToken(token, config),
    getChallenge: (persistentId) =>
      certifiedDailyMasteryStore.getChallenge(persistentId),
    reportError: (error) =>
      log.error("Daily mastery unavailable", { err: String(error) }),
  });

  registerSeasonContractRoutes(app, {
    verifyToken: (token) => verifyClientToken(token, config),
    currentSeasonId: () => {
      const season = vaultSeasonScheduler.getStatus();
      return `week-${season.weekNumber}`;
    },
    getContracts: (persistentId, seasonId) =>
      certifiedSeasonContractStore.getState(persistentId, seasonId),
    getPlayerStats: (persistentId) =>
      playerStatsStore.getPlayerStats(persistentId),
    getEloHistory: (persistentId, limit) =>
      playerStatsStore.getEloHistory(persistentId, limit),
    eloLabel: (rating) => EloRating.ratingLabel(rating),
    reportError: (error) =>
      log.error("Season contracts unavailable", { err: String(error) }),
  });

  registerExperimentRoutes(app, {
    resolveIdentity: resolveVaultFrontIdentity,
    resolveActor: async (req) => {
      const actor = await resolveAuthenticatedActorKey(req);
      return actor ? { persistentId: actor.persistentId } : null;
    },
    authorize: (policyId, context, res) =>
      authorizeRoutePolicy(policyId, context, res),
    assertPolicyBinding: assertRoutePolicyBinding,
    isAdmin: (req) => req.headers[config.adminHeader()] === config.adminToken(),
  });

  registerCertifiedOutcomeRoutes(app, {
    authenticate: (req, res) => requireVaultFrontActor(req, res),
    acceptActorClaim,
    isAdmin: (req) => req.headers[config.adminHeader()] === config.adminToken(),
    profile: certifiedOutcomeStore.profile.bind(certifiedOutcomeStore),
    summary: certifiedOutcomeStore.summary.bind(certifiedOutcomeStore),
    reportError: (error) =>
      log.error("Certified outcome profile unavailable", {
        err: String(error),
      }),
  });
  registerLoopEvidenceRoutes(app, {
    isAdmin: (headers) => headers[config.adminHeader()] === config.adminToken(),
    getSummary: (limit) => certifiedLoopEvidenceStore.getSummary(limit),
    reportError: (error) =>
      log.error("Loop evidence unavailable", { err: String(error) }),
  });

  registerPredictionLeagueRoutes(app, {
    authenticate: (req, res) => requireVaultFrontActor(req, res),
    admitPrediction: (gameId) => {
      const game = gm.game(gameId as GameID);
      if (!game) return { allowed: false, reason: "unknown-game" };
      const reason = game.predictionAdmission();
      return reason === "open"
        ? { allowed: true, reason }
        : { allowed: false, reason };
    },
    reportAdmissionRejected: (gameId, reason) =>
      log.info("prediction admission rejected", { gameId, reason }),
    recordPrediction: predictionLeagueStore.recordPrediction.bind(
      predictionLeagueStore,
    ),
    getLeaderboard: predictionLeagueStore.getLeaderboard.bind(
      predictionLeagueStore,
    ),
    getSpectatorStats: predictionLeagueStore.getSpectatorStats.bind(
      predictionLeagueStore,
    ),
    getGameConsensus: predictionLeagueStore.getGameConsensus.bind(
      predictionLeagueStore,
    ),
    publishConsensus: (consensus) =>
      narratorBus.broadcastRaw(consensus.gameId, {
        type: "crowd_vote",
        interceptPct: consensus.interceptPct,
        deliveryPct: consensus.deliveryPct,
        total: consensus.total,
      }),
    predictionRateLimit: rateLimit({ windowMs: 30_000, max: 3 }),
    reportError: (error) =>
      log.error("Prediction league unavailable", { err: String(error) }),
  });

  registerMatchFeedbackRoutes(app, {
    authenticate: (req, res) => requireVaultFrontActor(req, res),
    resolveEvidence: async (gameId, actor) => {
      const record = await readGameRecord(gameId);
      const certificate = record?.telemetry?.resultCertificate;
      const participant = record?.info.players.find(
        (player) => player.persistentID === actor.persistentId,
      );
      const hasVerifiedCertificate = Boolean(
        certificate &&
        certificate.gameID === gameId &&
        verifyMatchResultCertificate(certificate),
      );
      const playerStats = participant
        ? certificate?.result.allPlayersStats[participant.clientID]
        : undefined;
      const certificateBindsActor = Boolean(
        hasVerifiedCertificate && participant && playerStats,
      );
      const style = classifyPlayStyle(
        activityCountsFromPlayerStats(playerStats),
      );
      return {
        mapName:
          hasVerifiedCertificate && participant
            ? String(record?.info.config.gameMap ?? "")
            : null,
        hasVerifiedCertificate,
        certificateBindsActor,
        won: Boolean(
          participant &&
          certificate?.result.winner?.includes(participant.clientID),
        ),
        behindAtMinute8:
          Number(playerStats?.vaultfront?.minute8Behind ?? 0n) > 0,
        playStyle: style.label,
        styleConfidence: style.dominant,
      };
    },
    authorize: (policyId, context, res) =>
      authorizeRoutePolicy(policyId, context, res),
    assertPolicyBinding: assertRoutePolicyBinding,
    isAdmin: (req) => req.headers[config.adminHeader()] === config.adminToken(),
    record: (input) => matchFeedbackStore.record(input),
    summary: () => matchFeedbackStore.summary(),
    writeRateLimit: rateLimit({ windowMs: 60_000, max: 5 }),
    reportError: (error) =>
      log.error("match feedback unavailable", { error: String(error) }),
  });
  registerPlaytestEvidenceRoutes(app, {
    rateLimit: rateLimit({ windowMs: 60_000, max: 120 }),
    resolveActor: resolveAuthenticatedActorKey,
    record: (event) => playtestEvidenceStore.record(event),
    summary: () => playtestEvidenceStore.summary(),
    reportError: (error) =>
      log.error("playtest evidence route failed", { error: String(error) }),
  });

  // ── Anti-Cheat Admin ─────────────────────────────────────────────────────
  app.get("/api/admin/anti-cheat/flagged", async (req, res) => {
    if (req.headers[config.adminHeader()] !== config.adminToken()) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const limit = Math.min(200, Number(req.query["limit"] ?? 50) || 50);
    const rows = await playerStatsStore.getFlaggedMatches(limit);
    return res.json({ generatedAt: Date.now(), count: rows.length, rows });
  });

  // ── IGNIS Founder Signal Feedback Loop ───────────────────────────────────
  const ignisSignalSchema = z.object({
    itemSlug: z.string().max(128),
    signal: z.enum(["accept", "reject", "pivot"]),
    sessionId: z.string().max(128).optional(),
  });

  const ignisRateLimit = rateLimit({ windowMs: 60_000, max: 120 });

  app.post("/api/ignis/signal", ignisRateLimit, async (req, res) => {
    const parsed = ignisSignalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid signal" });
    }
    const { itemSlug, signal, sessionId } = parsed.data;
    if (pool) {
      await pool
        .query(
          `INSERT INTO ignis_signals (item_slug, signal, session_id) VALUES ($1, $2, $3)`,
          [itemSlug, signal, sessionId ?? null],
        )
        .catch(() => null);
    }
    return res.json({ ok: true });
  });

  app.get("/api/ignis/signals", async (req, res) => {
    if (req.headers[config.adminHeader()] !== config.adminToken()) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!pool) return res.json({ ok: true, signals: [] });
    const result = await pool
      .query<{
        item_slug: string;
        signal: string;
        count: string;
      }>(
        `SELECT item_slug, signal, COUNT(*) as count
           FROM ignis_signals
          GROUP BY item_slug, signal
          ORDER BY item_slug, signal`,
      )
      .catch(() => null);
    if (!result) return res.json({ ok: true, signals: [] });
    const bySlug: Record<string, Record<string, number>> = {};
    for (const row of result.rows) {
      bySlug[row.item_slug] ??= {};
      bySlug[row.item_slug][row.signal] = Number(row.count);
    }
    const signals = Object.entries(bySlug).map(([slug, counts]) => ({
      slug,
      accept: counts["accept"] ?? 0,
      reject: counts["reject"] ?? 0,
      pivot: counts["pivot"] ?? 0,
      net: (counts["accept"] ?? 0) - (counts["reject"] ?? 0),
    }));
    signals.sort((a, b) => b.net - a.net);
    return res.json({ ok: true, signals, generatedAt: Date.now() });
  });

  // ── Season / Mutator API ──────────────────────────────────────────────────
  registerSeasonCommunityRoutes(app, {
    authenticate: (req, res) => requireVaultFrontActor(req, res),
    getStatus: () => vaultSeasonScheduler.getStatus(),
    recordVote: (candidateKey, actorId) =>
      vaultSeasonScheduler.recordVote(candidateKey, actorId),
  });
  // ─────────────────────────────────────────────────────────────────────────

  // ── Battle Narrative API ─────────────────────────────────────────────────
  const narrativeRateLimit = rateLimit({
    windowMs: 60_000,
    max: 10, // generous — one per match per player
  });

  const BattleNarrativeInputSchema = z.object({
    matchId: z.string().max(64),
    events: z
      .array(
        z.object({
          type: z.string(),
          player: z.string().optional(),
          tick: z.number().optional(),
          detail: z.string().optional(),
        }),
      )
      .max(20),
    winnerId: z.string().optional(),
    durationSeconds: z.number().int().min(0).max(7200),
  });

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  });

  app.post(
    "/api/vaultfront/battle-narrative",
    narrativeRateLimit,
    async (req, res) => {
      const identity = await resolveVaultFrontIdentity(req);
      if (!identity) {
        return res.status(401).json({ error: "Missing identity" });
      }
      const parsed = BattleNarrativeInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: z.prettifyError(parsed.error) });
      }
      const { events, winnerId, durationSeconds } = parsed.data;
      const eventSummary = events
        .map(
          (e) =>
            `[${e.type}]${e.player ? ` ${e.player}` : ""}${e.detail ? `: ${e.detail}` : ""}`,
        )
        .join("\n");
      const minutes = Math.floor(durationSeconds / 60);

      try {
        if (!reserveRemoteAiCall("debrief").allowed) {
          return res
            .status(503)
            .json({ error: "Narrative service unavailable" });
        }
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system: [
            {
              type: "text",
              text: "You are a battle chronicler for VaultFront, a browser real-time strategy game where players contest vault sites, route convoys, and trigger comeback surges. Write a 3-paragraph battle chronicle in an epic, cinematic tone. First paragraph: the opening moves and territory struggles. Second paragraph: the pivotal vault and convoy moments. Third paragraph: the endgame and outcome. Keep each paragraph to 2-3 sentences.",
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: `Match duration: ${minutes} minutes\n${winnerId ? `Winner: ${winnerId}\n` : ""}Key events:\n${eventSummary}`,
            },
          ],
        });
        const narrative =
          message.content[0].type === "text" ? message.content[0].text : "";
        return res.json({ ok: true, narrative });
      } catch (err) {
        logger.error("battle-narrative generation failed", err);
        return res.status(500).json({ error: "Narrative generation failed" });
      }
    },
  );

  // ── Vault Prophecy ────────────────────────────────────────────────────────
  const prophecyRateLimit = rateLimit({ windowMs: 10_000, max: 5 });
  const PROPHECY_SYSTEM_PROMPT =
    "You are an ancient oracle who speaks in cryptic, poetic verse about battles. Generate exactly 2 sentences — dramatic, vague, and atmospheric. Never mention specific game mechanics or rule names. Be ominous.";

  app.post(
    "/api/vaultfront/match-prophecy",
    prophecyRateLimit,
    async (req, res) => {
      const {
        mapName = "the battlefield",
        playerCount = 4,
        mutator = "none",
      } = req.body ?? {};
      const pcBucket = playerCount <= 2 ? "2" : playerCount <= 4 ? "4" : "8+";
      const prophecyCacheKey = `prophecy:${String(mapName).slice(0, 20)}:${pcBucket}`;
      const cachedProphecy = aiCacheGet(prophecyCacheKey);
      if (cachedProphecy) return res.json({ ...cachedProphecy, cached: true });
      try {
        if (!reserveRemoteAiCall("other").allowed) {
          return res
            .status(503)
            .json({ error: "Prophecy service unavailable" });
        }
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 80,
          system: [
            {
              type: "text",
              text: PROPHECY_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: `Map: ${mapName}. Players: ${playerCount}. Active condition: ${mutator}.`,
            },
          ],
        });
        const prophecy =
          message.content[0].type === "text" ? message.content[0].text : "";
        const result = { ok: true, prophecy };
        aiCacheSet(prophecyCacheKey, result);
        return res.json(result);
      } catch (err) {
        logger.error("match-prophecy generation failed", err);
        return res.status(500).json({ error: "Prophecy generation failed" });
      }
    },
  );

  // ── Live Event Commentary ─────────────────────────────────────────────────
  const commentaryRateLimit = rateLimit({ windowMs: 10_000, max: 5 });
  const COMMENTARY_SYSTEM_PROMPT =
    'You are a sports commentator for a real-time strategy game called VaultFront. Generate exactly 10 one-line commentary strings keyed by event type. Return ONLY valid JSON: {"vault_captured": "...", "convoy_intercepted": "...", "convoy_delivered": "...", "last_stand": "...", "heist_executed": "...", "bounty_collected": "...", "comeback_surge": "...", "warchest_hunt": "...", "map_event": "...", "general": "..."}. Be dramatic and concise — max 10 words per line.';

  app.post(
    "/api/vaultfront/match-commentary",
    commentaryRateLimit,
    async (req, res) => {
      const {
        playerCount = 4,
        mutator = "none",
        mapName = "unknown",
      } = req.body ?? {};
      try {
        if (!reserveRemoteAiCall("narrator").allowed) {
          return res
            .status(503)
            .json({ error: "Commentary service unavailable" });
        }
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: [
            {
              type: "text",
              text: COMMENTARY_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: `${playerCount} players, map: ${mapName}, mutator: ${mutator}. Generate commentary.`,
            },
          ],
        });
        const raw =
          message.content[0].type === "text" ? message.content[0].text : "{}";
        let commentary: Record<string, string> = {};
        try {
          commentary = JSON.parse(raw);
        } catch {
          commentary = { general: "The battle rages on!" };
        }
        return res.json({ ok: true, commentary });
      } catch (err) {
        logger.error("match-commentary generation failed", err);
        return res.status(500).json({ error: "Commentary generation failed" });
      }
    },
  );

  // ── NPC Lore Generation ────────────────────────────────────────────────────
  const BOT_LORE_SYSTEM_PROMPT =
    'You generate faction lore for AI opponents in a real-time strategy game. Return ONLY valid JSON with fields: {"factionName": string, "emblem": string (single emoji), "defeatQuote": string (max 12 words, dramatic), "victoryQuote": string (max 12 words, triumphant)}.';

  const botLoreCache = new Map<
    string,
    {
      factionName: string;
      emblem: string;
      defeatQuote: string;
      victoryQuote: string;
    }
  >();

  const BOT_PERSONALITIES = [
    "aggressive",
    "economic",
    "diplomatic",
    "ghost",
  ] as const;

  async function initBotLore(): Promise<void> {
    if (!canAttemptRemoteAi()) return;
    for (const personality of BOT_PERSONALITIES) {
      if (!reserveRemoteAiCall("other").allowed) break;
      try {
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 120,
          system: [
            {
              type: "text",
              text: BOT_LORE_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: `Generate lore for a ${personality} AI faction.`,
            },
          ],
        });
        const raw =
          message.content[0].type === "text" ? message.content[0].text : "{}";
        try {
          const lore = JSON.parse(raw);
          botLoreCache.set(personality, lore);
        } catch {
          botLoreCache.set(personality, {
            factionName: `The ${personality.charAt(0).toUpperCase() + personality.slice(1)} Order`,
            emblem: "⚔️",
            defeatQuote: "We shall not be forgotten.",
            victoryQuote: "The vaults are ours.",
          });
        }
      } catch (err) {
        logger.error(`bot-lore generation failed for ${personality}`, err);
      }
    }
  }

  initBotLore().catch((err) => logger.error("bot-lore init failed", err));

  app.get("/api/vaultfront/bot-lore/:personality", (req, res) => {
    const personality = req.params.personality;
    const lore = botLoreCache.get(personality);
    if (!lore) {
      return res.status(404).json({ error: "Lore not yet generated" });
    }
    return res.json({ ok: true, lore });
  });

  // ── Mission Brief System ───────────────────────────────────────────────────
  const missionRateLimit = rateLimit({ windowMs: 10_000, max: 5 });
  const MISSION_SYSTEM_PROMPT =
    'You generate unique match objectives for a real-time strategy game called VaultFront. Return ONLY valid JSON: {"objectiveText": string (max 20 words, specific and achievable), "conditionType": "VAULTS_CAPTURED" | "CONVOYS_DELIVERED" | "TICKS_HELD_LEAD", "conditionValue": number, "bonusElo": number (10-40)}. Make objectives specific and achievable in a typical match.';

  app.post(
    "/api/vaultfront/match-mission",
    missionRateLimit,
    async (req, res) => {
      const {
        mapName = "unknown",
        playerCount = 4,
        mutator = "none",
        vaultSiteCount = 5,
      } = req.body ?? {};
      try {
        if (!reserveRemoteAiCall("briefing").allowed) {
          return res.status(503).json({ error: "Mission service unavailable" });
        }
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 150,
          system: [
            {
              type: "text",
              text: MISSION_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: `Map: ${mapName}. Players: ${playerCount}. Mutator: ${mutator}. Vault sites: ${vaultSiteCount}. Generate a mission.`,
            },
          ],
        });
        const raw =
          message.content[0].type === "text" ? message.content[0].text : "{}";
        let mission: {
          objectiveText: string;
          conditionType: string;
          conditionValue: number;
          bonusElo: number;
        } = {
          objectiveText: "Capture 2 vault sites before tick 500.",
          conditionType: "VAULTS_CAPTURED",
          conditionValue: 2,
          bonusElo: 20,
        };
        try {
          mission = JSON.parse(raw);
        } catch {
          // use default
        }
        return res.json({ ok: true, mission });
      } catch (err) {
        logger.error("match-mission generation failed", err);
        return res.status(500).json({ error: "Mission generation failed" });
      }
    },
  );

  // ── In-Game Micro-Coach Hint ─────────────────────────────────────────────
  const microHintRateLimit = rateLimit({ windowMs: 180_000, max: 1 }); // 1 per 3 min

  const MICRO_HINT_SYSTEM_PROMPT =
    "You are a VaultFront real-time strategy coach. Give the player ONE concise in-game hint (max 90 characters). Focus on the most impactful immediate action they are not taking. Be specific, tactical, present-tense. No greeting, no punctuation at end.";

  app.get(
    "/api/vaultfront/micro-hint",
    microHintRateLimit,
    async (req, res) => {
      const gold = Number(req.query["gold"] ?? 0);
      const sites = Number(req.query["sites"] ?? 0);
      try {
        if (!reserveRemoteAiCall("coach").allowed) {
          return res.status(503).json({ error: "Coach unavailable" });
        }
        const msg = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 50,
          system: [
            {
              type: "text",
              text: MICRO_HINT_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: `Player gold: ${gold}, vault sites controlled: ${sites}. No vault commands issued yet this match.`,
            },
          ],
        });
        const hint =
          (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
        return res.json({ ok: true, hint });
      } catch (err) {
        logger.error("micro-hint failed", err);
        return res.status(500).json({ error: "Hint generation failed" });
      }
    },
  );

  // ── Pre-Match Oracle (ELO prediction) ────────────────────────────────────
  const oracleRateLimit = rateLimit({ windowMs: 30_000, max: 5 });

  // ── Oracle/Prophecy in-memory response cache (5-min TTL, max 50 entries) ──
  const AI_CACHE_TTL_MS = 5 * 60 * 1_000;
  const AI_CACHE_MAX = 50;
  const aiResponseCache = new Map<
    string,
    { data: object; expiresAt: number }
  >();

  function aiCacheGet(key: string): object | null {
    const entry = aiResponseCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      aiResponseCache.delete(key);
      return null;
    }
    return entry.data;
  }

  function aiCacheSet(key: string, data: object): void {
    if (aiResponseCache.size >= AI_CACHE_MAX) {
      const oldest = aiResponseCache.keys().next().value;
      if (oldest) aiResponseCache.delete(oldest);
    }
    aiResponseCache.set(key, { data, expiresAt: Date.now() + AI_CACHE_TTL_MS });
  }

  const ORACLE_SYSTEM_PROMPT =
    "You are a VaultFront match predictor. Given player ELO ratings, return ONLY valid JSON with key 'predictions': array of {playerId, deltaIfWin, deltaIfLoss, threat?}. deltaIfWin and deltaIfLoss are integers. threat is the name/id of the most dangerous opponent for that player, or omitted. No prose, no markdown, just JSON.";

  const oracleEvidenceCache = new BoundedTtlCache<{
    ok: true;
    predictions: ReturnType<typeof parseOracleProviderOutput>["predictions"];
    receipt: ReturnType<typeof buildCanonicalAiResponseReceipt>;
  }>({ maxEntries: 100, ttlMs: AI_CACHE_TTL_MS });
  assertRoutePolicyBinding(
    "match-oracle",
    "GET",
    "/api/vaultfront/match-oracle",
  );
  app.get("/api/vaultfront/match-oracle", oracleRateLimit, async (req, res) => {
    const actor = await requireVaultFrontActor(req, res);
    if (!actor) return;
    if (!authorizeRoutePolicy("match-oracle", { hasVerifiedActor: true }, res))
      return;
    const playerIdsRaw = req.query["players"];
    const playerIds = Array.isArray(playerIdsRaw)
      ? (playerIdsRaw as string[]).slice(0, 8)
      : typeof playerIdsRaw === "string"
        ? [playerIdsRaw]
        : [];
    const uniquePlayerIds = [...new Set(playerIds)];
    if (
      uniquePlayerIds.length < 2 ||
      uniquePlayerIds.length !== playerIds.length ||
      !uniquePlayerIds.includes(actor.persistentId) ||
      uniquePlayerIds.some((id) => !PersistentIdSchema.safeParse(id).success)
    ) {
      return res.status(400).json({
        error:
          "Roster must contain 2-8 unique verified player identities including the requester",
      });
    }

    // Build the complete roster exclusively from server-owned rating history.
    const eloData = await Promise.all(
      uniquePlayerIds.map(async (id) => {
        const stats = await playerStatsStore.getHistory(id, 1).catch(() => []);
        return { id, elo: (stats[0] as { elo?: number })?.elo ?? 1200 };
      }),
    );
    eloData.sort((left, right) => left.id.localeCompare(right.id));
    const eloSummary = eloData.map((p) => `${p.id}: ELO ${p.elo}`).join(", ");
    const oracleCacheKey = `vaultfront-ai:v1:oracle:${createHash("sha256")
      .update(JSON.stringify({ requester: actor.persistentId, eloData }))
      .digest("hex")}`;
    const oracleEvidence = {
      schemaVersion: "1.0" as const,
      feature: "oracle" as const,
      requester: actor.persistentId,
      source: "server-owned-player-history" as const,
      rosterDigest: createHash("sha256")
        .update(JSON.stringify(eloData))
        .digest("hex"),
      evidenceDigest: oracleCacheKey.slice(oracleCacheKey.lastIndexOf(":") + 1),
      cacheKey: oracleCacheKey,
    };
    const cached = oracleEvidenceCache.get(oracleCacheKey);
    if (cached)
      return res.json({
        ...cached,
        eloData,
        evidence: oracleEvidence,
        cached: true,
      });

    try {
      if (!reserveRemoteAiCall("intel").allowed) {
        return res.status(503).json({ error: "Oracle unavailable" });
      }
      const msg = await withAiDeadline(
        (signal) =>
          anthropic.messages.create(
            {
              model: "claude-haiku-4-5-20251001",
              max_tokens: 300,
              system: [
                {
                  type: "text",
                  text: ORACLE_SYSTEM_PROMPT,
                  cache_control: { type: "ephemeral" },
                },
              ],
              messages: [
                {
                  role: "user",
                  content: `Players: ${eloSummary}. Compute ELO deltas (K=32) and identify biggest threat per player.`,
                },
              ],
            },
            { signal },
          ),
        8_000,
      );
      const raw =
        (msg.content[0] as { type: string; text: string }).text?.trim() ?? "{}";
      const parsed = parseOracleProviderOutput(raw, uniquePlayerIds);
      const result = {
        ok: true as const,
        predictions: parsed.predictions,
        receipt: buildCanonicalAiResponseReceipt({
          evidence: oracleEvidence,
          output: parsed,
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
        }),
      };
      oracleEvidenceCache.set(oracleCacheKey, result);
      return res.json({ ...result, eloData, evidence: oracleEvidence });
    } catch (err) {
      logger.error("match-oracle failed", err);
      return res.status(500).json({ error: "Oracle failed" });
    }
  });

  // ── AI Coach Overlay ───────────────────────────────────────────────────────
  const coachRateLimit = rateLimit({ windowMs: 60_000, max: 3 });
  const COACH_SYSTEM_PROMPT =
    "You are a tactical coach for VaultFront. Use only the certified server record. Return ONLY a JSON array of 2-3 objects: {tick, decision, optimal, why}. No prose or markdown.";

  const matchCoachCache = new BoundedTtlCache<{
    moments: ReturnType<typeof parseCoachProviderOutput>;
    receipt: ReturnType<typeof buildCanonicalAiResponseReceipt>;
  }>({ maxEntries: 500, ttlMs: AI_CACHE_TTL_MS });

  assertRoutePolicyBinding(
    "match-coach",
    "POST",
    "/api/vaultfront/match-coach",
  );
  app.post("/api/vaultfront/match-coach", coachRateLimit, async (req, res) => {
    const actor = await requireVaultFrontActor(req, res);
    if (!actor) return;
    const parsedRequest = z
      .object({ gameId: z.string().regex(/^[A-Za-z0-9]{8}$/) })
      .strict()
      .safeParse(req.body);
    if (!parsedRequest.success)
      return res.status(400).json({ error: "Certified gameId required" });
    const context = await loadCertifiedAiContext(
      parsedRequest.data.gameId,
      actor,
      "match-coach",
      res,
    );
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
    const cached = matchCoachCache.get(evidence.cacheKey);
    if (cached)
      return res.json({ ok: true, ...cached, cached: true, evidence });

    if (!reserveRemoteAiCall("coach").allowed) {
      return res.status(503).json({ error: "Coach service unavailable" });
    }
    try {
      const message = await withAiDeadline(
        (signal) =>
          anthropic.messages.create(
            {
              model: "claude-sonnet-4-6",
              max_tokens: 600,
              system: [
                {
                  type: "text",
                  text: COACH_SYSTEM_PROMPT,
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
        10_000,
      );
      const raw =
        message.content[0]?.type === "text" ? message.content[0].text : "[]";
      const moments = parseCoachProviderOutput(
        raw,
        context.record.info.num_turns,
      );
      const receipt = buildCanonicalAiResponseReceipt({
        evidence,
        output: moments,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      });
      matchCoachCache.set(evidence.cacheKey, { moments, receipt });
      return res.json({ ok: true, moments, evidence, receipt });
    } catch (err) {
      logger.error("match-coach failed", err);
      return res.status(500).json({ error: "Coach generation failed" });
    }
  });

  // ── Dynasty Story Engine ─────────────────────────────────────────────────
  const dynastyRateLimit = rateLimit({ windowMs: 60_000, max: 10 });

  const DYNASTY_SYSTEM_PROMPT =
    "You are the chronicler of VaultFront dynasty histories. Write exactly one sentence (max 120 characters) as a new chapter entry for this clan's legend. Tone: epic, specific, past-tense. Reference the actual events provided. No quotation marks.";

  const DynastyStorySchema = z.object({ gameId: z.string().min(1).max(64) });

  app.post(
    "/api/vaultfront/dynasty-story",
    dynastyRateLimit,
    async (req, res) => {
      const actor = await requireVaultFrontActor(req, res);
      if (!actor) return;
      const parsed = DynastyStorySchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Certified gameId required" });
      const context = await loadCertifiedAiContext(
        parsed.data.gameId,
        actor,
        "dynasty-story",
        res,
      );
      if (!context) return;
      const clanId = clanStore.getClanForPlayer(actor.persistentId);
      const clan = clanId ? clanStore.getClan(clanId) : null;
      if (!clanId || !clan)
        return res.status(403).json({ error: "Clan membership required" });
      const persistentByClientId = new Map(
        context.record.info.players
          .filter((player) => player.persistentID)
          .map((player) => [player.clientID, player.persistentID!]),
      );
      const winners = certifiedWinnerPersistentIds({
        ...context,
        persistentByClientId,
      });
      const userContent = `Clan: ${clan.name}\nCertified result: ${winners.includes(actor.persistentId) ? "victory" : "defeat"}\nCertificate: ${context.certificate.certificateId.slice(0, 16)}`;
      try {
        if (!reserveRemoteAiCall("other").allowed)
          return res.status(503).json({ error: "Dynasty service unavailable" });
        const msg = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 80,
          system: [
            {
              type: "text",
              text: DYNASTY_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userContent }],
        });
        const chapter =
          (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
        if (chapter)
          await clanStore.appendDynastyStoryOnce(
            clanId,
            context.certificate.certificateId,
            chapter,
          );
        const story = await clanStore.getDynastyStory(clanId);
        return res.json({
          ok: true,
          chapter,
          story,
          certificateId: context.certificate.certificateId,
        });
      } catch (err) {
        logger.error("dynasty-story generation failed", err);
        return res.status(500).json({ error: "Dynasty story failed" });
      }
    },
  );

  app.get("/api/vaultfront/dynasty-story/:clanId", async (req, res) => {
    const clanId = req.params.clanId?.slice(0, 64) ?? "";
    const story = await clanStore.getDynastyStory(clanId);
    return res.json({ ok: true, story });
  });

  // ── Bot Persona Backstories ───────────────────────────────────────────────
  const personaCache = new Map<string, string>();

  const BOT_PERSONA_SYSTEM_PROMPT =
    "Generate a VaultFront bot commander persona. Format: 'CODENAME — one sentence origin story (max 100 chars)'. Tone: gritty, tactical, specific to the personality archetype. No quotes around the output.";

  app.get("/api/vaultfront/bot-persona", async (req, res) => {
    const personality = String(req.query["personality"] ?? "").slice(0, 32);
    const seed = String(req.query["seed"] ?? "").slice(0, 32);
    const cacheKey = `${personality}:${seed}`;
    const cached = personaCache.get(cacheKey);
    if (cached) return res.json({ ok: true, persona: cached });

    const archetypes: Record<string, string> = {
      aggressor: "relentless attacker who sacrifices economy for dominance",
      economist: "trade-focused strategist who wins through convoy supremacy",
      diplomat: "alliance builder who betrays at the critical moment",
      ghost: "deception specialist who moves convoys through ghost routes",
    };
    const archetype = archetypes[personality] ?? "mysterious commander";
    try {
      if (!reserveRemoteAiCall("other").allowed) {
        return res.status(503).json({ error: "Persona service unavailable" });
      }
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        system: [
          {
            type: "text",
            text: BOT_PERSONA_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: `Personality: ${personality} — ${archetype}. Seed: ${seed}`,
          },
        ],
      });
      const persona =
        (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
      if (persona) personaCache.set(cacheKey, persona);
      return res.json({ ok: true, persona });
    } catch (err) {
      logger.error("bot-persona generation failed", err);
      return res.status(500).json({ error: "Persona generation failed" });
    }
  });

  // ── Living Match Narrator (SSE) ──────────────────────────────────────────
  const narratorEventRateLimit = rateLimit({ windowMs: 2_000, max: 3 }); // 3/2s per IP

  const NarratorEventSchema = z.object({
    activity: z.string().max(64),
    label: z.string().max(128).optional(),
    persistentId: z.string().max(64).optional(),
    context: z
      .object({
        tickBucket: z.enum(["early", "mid", "late"]),
        leadingPlayer: z.string().max(32),
        siteBalance: z.string().max(32),
        mutator: z.string().max(32),
      })
      .optional(),
  });

  // Spectators / clients subscribe to commentary stream
  app.get("/api/vaultfront/narrator/:gameId", (req, res) => {
    const gameId = req.params.gameId;
    if (!gameId || gameId.length > 64) {
      return res.status(400).end();
    }
    const rawPersona = req.query.persona;
    const persona: NarratorPersona =
      rawPersona === "tactical" || rawPersona === "comedic"
        ? rawPersona
        : "hype";
    const clientKey =
      ipAnonymize(req.ip ?? req.socket.remoteAddress ?? "unknown") ?? "unknown";
    const admission = narratorBus.admit(gameId, clientKey);
    if (!admission.accepted) {
      return res
        .status(admission.reason === "worker-capacity" ? 503 : 429)
        .json({ error: `Narrator stream ${admission.reason}` });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    narratorBus.subscribe(gameId, res, clientKey, persona);
  });

  // Game clients push activity events for narration
  app.post(
    "/api/vaultfront/narrator/:gameId/event",
    narratorEventRateLimit,
    (req, res) => {
      const gameId = req.params.gameId;
      if (!gameId || gameId.length > 64) {
        return res.status(400).json({ error: "Invalid gameId" });
      }
      const parsed = NarratorEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid event" });
      }
      const label =
        parsed.data.label ?? parsed.data.activity.replace(/_/g, " ");
      narratorBus.queueEvent(gameId, label, parsed.data.context);

      return res.json({ ok: true });
    },
  );

  // ── Vault Intelligence Market ────────────────────────────────────────────
  // In-memory per-game intel listings: gameId → Map<sellerId, routeRisk>
  const intelListings = new Map<
    string,
    Map<
      string,
      { routeRisk: number; interceptProbability: number; tileRef: number }
    >
  >();

  const intelRateLimit = rateLimit({ windowMs: 10_000, max: 5 });

  app.post(
    "/api/vaultfront/intel-purchase",
    intelRateLimit,
    async (req, res) => {
      const parsed = z
        .object({
          gameId: z.string().max(64),
          buyerPersistentId: z.string().max(64),
          sellerId: z.string().max(64),
          tileRef: z.number().int().optional(),
        })
        .safeParse(req.body);

      if (!parsed.success)
        return res.status(400).json({ error: "Invalid request" });

      const { gameId, sellerId, tileRef } = parsed.data;
      const gameListings = intelListings.get(gameId);
      const listing = gameListings?.get(sellerId);

      // Return available intel (or synthesised from route geometry)
      const routeRisk = listing?.routeRisk ?? Math.random() * 0.6 + 0.2;
      const interceptProbability =
        listing?.interceptProbability ?? routeRisk * 0.8;

      log.info("intel-purchase", { gameId, sellerId, tileRef });
      return res.json({
        ok: true,
        routeRisk: Math.round(routeRisk * 100) / 100,
        interceptProbability: Math.round(interceptProbability * 100) / 100,
        tileRef: tileRef ?? listing?.tileRef ?? 0,
        goldCost: 2000,
      });
    },
  );

  app.post("/api/vaultfront/intel-list", intelRateLimit, (req, res) => {
    const parsed = z
      .object({
        gameId: z.string().max(64),
        sellerId: z.string().max(64),
        routeRisk: z.number().min(0).max(1),
        interceptProbability: z.number().min(0).max(1),
        tileRef: z.number().int(),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid listing" });

    const { gameId, sellerId, routeRisk, interceptProbability, tileRef } =
      parsed.data;
    if (!intelListings.has(gameId)) intelListings.set(gameId, new Map());
    intelListings
      .get(gameId)!
      .set(sellerId, { routeRisk, interceptProbability, tileRef });
    return res.json({ ok: true });
  });

  // ── Pre-Match Intelligence Brief ─────────────────────────────────────────
  const prematchBriefRateLimit = rateLimit({ windowMs: 30_000, max: 3 });
  const PREMATCH_BRIEF_SYSTEM_PROMPT =
    "You are a VaultFront tactical analyst. Generate a 2-sentence personalized pre-match brief for the player. Be specific: reference the map, the player's style, and their recent streak. Tone: confident, strategic. Maximum 180 characters total.";

  app.get(
    "/api/vaultfront/prematch-brief",
    prematchBriefRateLimit,
    async (req, res) => {
      const claimedPersistentId = String(req.query.persistentId ?? "").slice(
        0,
        64,
      );
      const mapName = String(req.query.mapName ?? "Unknown Map").slice(0, 64);
      if (!claimedPersistentId) {
        return res.status(400).json({ error: "Missing persistentId" });
      }
      const actor = await requireVaultFrontActor(req, res);
      if (!actor || !acceptActorClaim(actor, claimedPersistentId, res)) return;
      const persistentId = actor.persistentId;
      const history = await playerStatsStore
        .getHistory(persistentId, 5)
        .catch(() => []);
      const wins = history.filter((h: MatchHistoryEntry) => h.won).length;
      const streak =
        wins >= 4
          ? "4-5 win streak"
          : wins >= 3
            ? "winning"
            : wins <= 1
              ? "losing streak"
              : "mixed";
      const style = String(req.query.style ?? "mixed").slice(0, 32);
      const briefKey = `prematch:${style}:${mapName.slice(0, 12)}:${streak}`;
      const cached = aiCacheGet(briefKey);
      if (cached) return res.json({ ...cached, cached: true });
      try {
        if (!reserveRemoteAiCall("briefing").allowed) {
          return res.status(503).json({ error: "Brief service unavailable" });
        }
        const msg = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 120,
          system: [
            {
              type: "text",
              text: PREMATCH_BRIEF_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: `Style: ${style}. Map: ${mapName}. Recent form: ${streak}. Last 5 results: ${wins}/5 wins.`,
            },
          ],
        });
        const brief =
          (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
        const result = { ok: true, brief };
        aiCacheSet(briefKey, result);
        return res.json(result);
      } catch (err) {
        logger.error("prematch-brief failed", err);
        return res.status(500).json({ error: "Brief generation failed" });
      }
    },
  );

  // ── AI Sports-Journalism Match Recap ─────────────────────────────────────
  const recapRateLimit = rateLimit({ windowMs: 60_000, max: 5 });
  const RECAP_SYSTEM_PROMPT =
    "You are a sports journalist covering VaultFront, a browser real-time strategy game. Write a 3-sentence dramatic match recap that reads like ESPN coverage. Reference the actual winner, key events, and what made this match special. Tone: exciting, specific, human. No bullet points.";
  const matchRecapCache = new BoundedTtlCache<{
    recap: string;
    receipt: ReturnType<typeof buildCanonicalAiResponseReceipt>;
  }>({
    maxEntries: 500,
    ttlMs: 24 * 60 * 60 * 1_000,
  });

  assertRoutePolicyBinding(
    "match-recap",
    "GET",
    "/api/vaultfront/match-recap/:gameId",
  );
  app.get(
    "/api/vaultfront/match-recap/:gameId",
    recapRateLimit,
    async (req, res) => {
      const gameId = req.params.gameId?.slice(0, 64) ?? "";
      if (!gameId) return res.status(400).json({ error: "Missing gameId" });
      const actor = await requireVaultFrontActor(req, res);
      if (!actor) return;
      const context = await loadCertifiedAiContext(
        gameId,
        actor,
        "match-recap",
        res,
      );
      if (!context) return;
      const canonicalInputs = {
        info: context.record.info,
        turns: context.record.turns,
        result: context.certificate.result,
      };
      const evidence = buildCanonicalAiEvidence({
        feature: "recap",
        certificate: context.certificate,
        canonicalInputs,
        requester: actor.persistentId,
      });
      const cached = matchRecapCache.get(evidence.cacheKey);
      if (cached)
        return res.json({ ok: true, ...cached, cached: true, evidence });
      try {
        if (!reserveRemoteAiCall("debrief").allowed) {
          return res.status(503).json({ error: "Recap service unavailable" });
        }
        const msg = await withAiDeadline(
          (signal) =>
            anthropic.messages.create(
              {
                model: "claude-haiku-4-5-20251001",
                max_tokens: 160,
                system: [
                  {
                    type: "text",
                    text: RECAP_SYSTEM_PROMPT,
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
          (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
        const { recap } = parseRecapProviderOutput(raw);
        const receipt = buildCanonicalAiResponseReceipt({
          evidence,
          output: { recap },
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
        });
        matchRecapCache.set(evidence.cacheKey, { recap, receipt });
        return res.json({ ok: true, recap, evidence, receipt });
      } catch (err) {
        logger.error("match-recap failed", err);
        return res.status(500).json({ error: "Recap generation failed" });
      }
    },
  );

  // ── Post-Match AI Coach Debrief ───────────────────────────────────────────
  const coachDebriefRateLimit = rateLimit({ windowMs: 60_000, max: 3 });
  const COACH_DEBRIEF_SYSTEM_PROMPT =
    "You are a VaultFront strategic coach analyzing a player's key decision moments. Identify 2-3 specific decision points where a different choice would have changed the outcome. For each: state the tick/moment, what happened, what the optimal play was, and why. Be specific, direct, and constructive. Format as a JSON array: [{tick, decision, optimal, why}].";
  const coachDebriefCache = new BoundedTtlCache<{
    moments: ReturnType<typeof parseCoachProviderOutput>;
    receipt: ReturnType<typeof buildCanonicalAiResponseReceipt>;
  }>({ maxEntries: 500, ttlMs: 24 * 60 * 60 * 1_000 });

  assertRoutePolicyBinding(
    "coach-debrief",
    "POST",
    "/api/vaultfront/coach-debrief",
  );
  app.post(
    "/api/vaultfront/coach-debrief",
    coachDebriefRateLimit,
    async (req, res) => {
      const parsed = z
        .object({
          persistentId: z.string().max(64).optional(),
          gameId: z.string().max(64),
          // Kept for wire compatibility only; never used as AI evidence.
          activityLog: z.unknown().optional(),
          matchStats: z.unknown().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Invalid request" });
      const actor = await requireVaultFrontActor(req, res);
      if (!actor || !acceptActorClaim(actor, parsed.data.persistentId, res))
        return;
      const context = await loadCertifiedAiContext(
        parsed.data.gameId,
        actor,
        "coach-debrief",
        res,
      );
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
      const cached = coachDebriefCache.get(evidence.cacheKey);
      if (cached)
        return res.json({ ok: true, ...cached, cached: true, evidence });
      try {
        if (!reserveRemoteAiCall("debrief").allowed) {
          return res.status(503).json({ error: "Coach debrief unavailable" });
        }
        const msg = await withAiDeadline(
          (signal) =>
            anthropic.messages.create(
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
          (msg.content[0] as { type: string; text: string }).text?.trim() ??
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
        coachDebriefCache.set(evidence.cacheKey, { moments, receipt });
        return res.json({ ok: true, moments, evidence, receipt });
      } catch (err) {
        logger.error("coach-debrief failed", err);
        return res.status(500).json({ error: "Coach debrief failed" });
      }
    },
  );

  // ── Streaming Overlay API ────────────────────────────────────────────────
  // Streamers add this as an OBS browser source (transparent, 1280×200):
  //   https://your-server/api/stream/:gameId/overlay
  app.get("/api/stream/:gameId/overlay", (req, res) => {
    const gameId = req.params.gameId;
    if (!gameId || gameId.length > 64) {
      return res.status(400).end();
    }
    const clientKey =
      ipAnonymize(req.ip ?? req.socket.remoteAddress ?? "unknown") ?? "unknown";
    const admission = streamingBus.admit(gameId, clientKey);
    if (!admission.accepted) {
      return res
        .status(admission.reason === "worker-capacity" ? 503 : 429)
        .json({ error: `Overlay stream ${admission.reason}` });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    streamingBus.subscribe(gameId, res, clientKey);
  });

  // ── Achievement Profile + Meta-Chains API ────────────────────────────────
  const achievementProfileRateLimit = rateLimit({ windowMs: 60_000, max: 30 });
  registerAchievementRoutes(app, {
    authenticate: (req, res) => requireVaultFrontActor(req, res),
    rateLimit: achievementProfileRateLimit,
    getProgress: (persistentId) => achievementStore.getProgress(persistentId),
    getMetaChainProgress: (persistentId) =>
      achievementStore.getMetaChainProgress(persistentId),
    reportError: (error) =>
      log.error("achievement profile unavailable", { error: String(error) }),
  });

  // ── Vault Fortune Post-Win Draw ───────────────────────────────────────────
  const fortuneRateLimit = rateLimit({ windowMs: 60_000, max: 5 });

  app.post(
    "/api/vaultfront/win-fortune",
    fortuneRateLimit,
    async (req, res) => {
      const parsed = z
        .object({
          persistentId: z.string().max(64).optional(),
          matchId: z.string().max(64),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Invalid request" });
      const actor = await requireVaultFrontActor(req, res);
      if (!actor || !acceptActorClaim(actor, parsed.data.persistentId, res))
        return;
      const { item, alreadyOwned } = fortuneDeck.draw(
        actor.persistentId,
        parsed.data.matchId,
      );
      return res.json({ ok: true, item, alreadyOwned });
    },
  );

  // ── Clan War Scheduler ────────────────────────────────────────────────────
  const clanWarRateLimit = rateLimit({ windowMs: 60_000, max: 10 });

  app.post(
    "/api/vaultfront/clan-war/challenge",
    clanWarRateLimit,
    async (req, res) => {
      const parsed = z
        .object({
          challengerClanId: z.string().max(64),
          targetClanId: z.string().max(64),
          proposedAt: z
            .number()
            .int()
            .min(Date.now() - 60_000), // not too far in past
          mapName: z.string().max(64).optional(),
          notes: z.string().max(200).optional(),
          seriesFormat: z.enum(["bo3", "bo1"]).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Invalid request" });
      const actor = await requireVaultFrontActor(req, res);
      if (!actor) return;
      if (
        !canManageClan(
          clanStore.getClan(parsed.data.challengerClanId),
          actor.persistentId,
        )
      ) {
        return res.status(403).json({ error: "Clan officer role required" });
      }
      const war = clanWarStore.challenge(parsed.data);
      return res.json({ ok: true, war });
    },
  );

  app.post(
    "/api/vaultfront/clan-war/accept",
    clanWarRateLimit,
    async (req, res) => {
      const parsed = z
        .object({
          warId: z.string().max(32),
          byPersistentId: z.string().max(64).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Invalid request" });
      const actor = await requireVaultFrontActor(req, res);
      if (!actor || !acceptActorClaim(actor, parsed.data.byPersistentId, res))
        return;
      const pendingWar = clanWarStore.getWar(parsed.data.warId);
      if (!pendingWar) return res.status(404).json({ error: "War not found" });
      if (
        !canManageClan(
          clanStore.getClan(pendingWar.targetClanId),
          actor.persistentId,
        )
      ) {
        return res
          .status(403)
          .json({ error: "Target clan officer role required" });
      }
      const war = clanWarStore.accept(parsed.data.warId, actor.persistentId);
      if (!war)
        return res
          .status(404)
          .json({ error: "War not found or already accepted" });
      return res.json({ ok: true, war });
    },
  );

  app.post(
    "/api/vaultfront/clan-war/decline",
    clanWarRateLimit,
    async (req, res) => {
      const parsed = z
        .object({ warId: z.string().max(32) })
        .safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Invalid request" });
      const actor = await requireVaultFrontActor(req, res);
      if (!actor) return;
      const pendingWar = clanWarStore.getWar(parsed.data.warId);
      if (!pendingWar) return res.status(404).json({ error: "War not found" });
      if (
        !canManageClan(
          clanStore.getClan(pendingWar.targetClanId),
          actor.persistentId,
        )
      ) {
        return res
          .status(403)
          .json({ error: "Target clan officer role required" });
      }
      const war = clanWarStore.decline(parsed.data.warId);
      if (!war) return res.status(404).json({ error: "War not found" });
      return res.json({ ok: true, war });
    },
  );

  app.get("/api/vaultfront/clan-war/upcoming", (req, res) => {
    return res.json({ ok: true, wars: clanWarStore.getUpcoming() });
  });

  app.get("/api/vaultfront/clan-war/:clanId", (req, res) => {
    const clanId = String(req.params.clanId ?? "").slice(0, 64);
    return res.json({ ok: true, wars: clanWarStore.getForClan(clanId) });
  });

  registerProgressionRoutes(app, {
    authenticate: (req, res) => requireVaultFrontActor(req, res),
    reportError: (error) =>
      log.error("Progression routes unavailable", { err: String(error) }),
  });

  // ── Player Stats / Leaderboard API ───────────────────────────────────────
  const statsRateLimit = rateLimit({
    windowMs: 60_000, // 1 minute
    max: 30, // 30 requests per IP per minute
  });

  app.get(
    "/api/player/history/:persistentId",
    statsRateLimit,
    async (req, res) => {
      const parsed = PersistentIdSchema.safeParse(req.params.persistentId);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid persistentId" });
      }
      try {
        const history = await playerStatsStore.getHistory(parsed.data, 20);
        return res.json(history);
      } catch (err) {
        log.error("Error fetching player history", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  app.get("/api/leaderboard", statsRateLimit, async (_req, res) => {
    try {
      const projection = await playerStatsStore.getLeaderboardProjection(50);
      res.setHeader("X-VaultFront-Projection", projection.source);
      res.setHeader("X-VaultFront-Projection-As-Of", projection.computedAt);
      return res.json(projection.entries);
    } catch (err) {
      log.error("Error fetching leaderboard", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get(
    "/api/player/stats/:persistentId",
    statsRateLimit,
    async (req, res) => {
      const parsed = PersistentIdSchema.safeParse(req.params.persistentId);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid persistentId" });
      }
      try {
        const stats = await playerStatsStore.getPlayerStats(parsed.data);
        if (!stats) {
          return res.status(404).json({ error: "Player not found" });
        }
        return res.json({
          ...stats,
          eloLabel: EloRating.ratingLabel(stats.eloRating),
        });
      } catch (err) {
        log.error("Error fetching player stats", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );
  // ─────────────────────────────────────────────────────────────────────────

  // ── Replay API ───────────────────────────────────────────────────────────
  app.get("/api/replays", async (_req, res) => {
    const list = await replayStore.listReplays(40);
    res.json(list);
  });

  app.get("/api/replay/:id", async (req, res) => {
    const gameId = req.params.id;
    if (!gameId) return res.status(400).json({ error: "Missing game ID" });
    const manifest = await replayStore.getReplay(gameId);
    if (!manifest) return res.status(404).json({ error: "Replay not found" });
    // Strip raw binary intents from the response (turns[] is sufficient for playback)
    const { intents: _intents, ...safe } = manifest;
    void _intents;
    return res.json(safe);
  });
  // ─────────────────────────────────────────────────────────────────────────

  // ── Match invite deep links ───────────────────────────────────────────────
  app.get("/api/invite/:gameId", (req, res) => {
    const { gameId } = req.params;
    if (!gameId) return res.status(400).json({ error: "Missing gameId" });

    const game = gm.game(gameId as GameID);
    const playerCount = game?.numClients() ?? 0;
    const mapName = game?.gameConfig.gameMap ?? "Unknown Map";
    const phase = game?.phase() ?? "unknown";

    const playBase =
      process.env.PLAY_BASE_URL ??
      "https://play-vaultfront.vaultsparkstudios.com";
    const shareUrl = `${playBase}/join?gameId=${encodeURIComponent(gameId)}`;

    return res.json({
      gameId,
      mapName,
      playerCount,
      phase,
      shareUrl,
      ogTitle: `Join my VaultFront match — ${mapName}`,
      ogDescription: `${playerCount} player${playerCount !== 1 ? "s" : ""} in a live vault siege. Click to join!`,
      ogImageUrl: `${playBase}/resources/maps/${encodeURIComponent(mapName)}.webp`,
    });
  });
  // ─────────────────────────────────────────────────────────────────────────

  registerGamePreviewRoute({
    app,
    gm,
    config,
    workerId,
    log,
    baseDir: __dirname,
  });

  app.post("/api/archive_singleplayer_game", async (req, res) => {
    try {
      const record = req.body;

      const result = PartialGameRecordSchema.safeParse(record);
      if (!result.success) {
        const error = z.prettifyError(result.error);
        log.info(error);
        return res.status(400).json({ error });
      }
      const gameRecord = result.data;

      if (gameRecord.info.config.gameType !== GameType.Singleplayer) {
        log.warn(
          `cannot archive singleplayer with game type ${gameRecord.info.config.gameType}`,
          {
            gameID: gameRecord.info.gameID,
          },
        );
        return res.status(400).json({ error: "Invalid request" });
      }

      if (result.data.info.players.length !== 1) {
        log.warn(`cannot archive singleplayer game multiple players`, {
          gameID: gameRecord.info.gameID,
        });
        return res.status(400).json({ error: "Invalid request" });
      }

      log.info("archiving singleplayer game", {
        gameID: gameRecord.info.gameID,
      });

      archive(finalizeGameRecord(gameRecord));
      res.json({
        success: true,
      });
    } catch (error) {
      log.error("Error processing archive request:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Clan / Squad API ─────────────────────────────────────────────────────
  const clanRateLimit = rateLimit({ windowMs: 60_000, max: 30 });

  app.post("/api/clans", clanRateLimit, async (req, res) => {
    const parsed = z
      .object({
        name: z.string().min(2).max(32),
        tag: z.string().min(2).max(6),
        founderId: z.string().min(1).max(64),
        description: z.string().max(256).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const actor = await requireVaultFrontActor(req, res);
    if (!actor || !acceptActorClaim(actor, parsed.data.founderId, res)) return;
    const result = await clanStore.createClan(
      parsed.data.name,
      parsed.data.tag,
      actor.persistentId,
      parsed.data.description,
    );
    if ("error" in result) return res.status(409).json(result);
    return res.status(201).json(result);
  });

  app.get("/api/clans/leaderboard", clanRateLimit, (_req, res) =>
    res.json(clanStore.getClanLeaderboard(50)),
  );

  app.get("/api/clans/:clanId", clanRateLimit, (req, res) => {
    const clan = clanStore.getClan(req.params.clanId);
    if (!clan) return res.status(404).json({ error: "Clan not found" });
    return res.json(clan);
  });

  app.get("/api/clans/player/:persistentId", clanRateLimit, (req, res) => {
    const clan = clanStore.getClanByPlayer(req.params.persistentId);
    if (!clan) return res.status(404).json({ error: "Not in a clan" });
    return res.json(clan);
  });

  app.post("/api/clans/:clanId/join", clanRateLimit, async (req, res) => {
    const parsed = z
      .object({ persistentId: z.string().min(1).max(64) })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Missing persistentId" });
    const actor = await requireVaultFrontActor(req, res);
    if (!actor || !acceptActorClaim(actor, parsed.data.persistentId, res))
      return;
    const result = await clanStore.joinClan(
      req.params.clanId,
      actor.persistentId,
    );
    if ("error" in result) return res.status(409).json(result);
    return res.json(result);
  });

  app.post("/api/clans/leave", clanRateLimit, async (req, res) => {
    const parsed = z
      .object({ persistentId: z.string().min(1).max(64) })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Missing persistentId" });
    const actor = await requireVaultFrontActor(req, res);
    if (!actor || !acceptActorClaim(actor, parsed.data.persistentId, res))
      return;
    const result = await clanStore.leaveClan(actor.persistentId);
    if (result && "error" in result) return res.status(409).json(result);
    return res.json({ ok: true });
  });
  // ─────────────────────────────────────────────────────────────────────────

  // ── Tutorial API ──────────────────────────────────────────────────────────
  app.get("/api/tutorial/state/:persistentId", (req, res) => {
    const state = tutorialOrchestrator.getState(req.params.persistentId);
    return res.json(state);
  });

  app.post("/api/tutorial/complete", async (req, res) => {
    const parsed = z
      .object({
        persistentId: z.string().min(1).max(64).optional(),
        step: z.string().min(1).max(64),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Missing fields" });
    const actor = await requireVaultFrontActor(req, res);
    if (!actor || !acceptActorClaim(actor, parsed.data.persistentId, res))
      return;
    const state = tutorialOrchestrator.completeStep(
      actor.persistentId,
      parsed.data.step,
    );
    return res.json(state);
  });

  app.post("/api/tutorial/reset", async (req, res) => {
    const parsed = z
      .object({ persistentId: z.string().min(1).max(64).optional() })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid request" });
    const actor = await requireVaultFrontActor(req, res);
    if (!actor || !acceptActorClaim(actor, parsed.data.persistentId, res))
      return;
    tutorialOrchestrator.resetProgress(actor.persistentId);
    return res.json({ ok: true });
  });
  // ─────────────────────────────────────────────────────────────────────────

  // ── Tournament API ────────────────────────────────────────────────────────
  const tourneyRateLimit = rateLimit({ windowMs: 60_000, max: 20 });

  app.post("/api/tournaments", tourneyRateLimit, async (req, res) => {
    const parsed = z
      .object({
        name: z.string().min(3).max(64),
        mapName: z.string().max(128).optional(),
        maxPlayers: z.number().int().min(4).max(64).optional(),
        createdBy: z.string().min(1).max(64),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    const actor = await requireVaultFrontActor(req, res);
    if (!actor || !acceptActorClaim(actor, parsed.data.createdBy, res)) return;
    const t = await tournamentStore.create({
      ...parsed.data,
      createdBy: actor.persistentId,
    });
    return res.status(201).json(t);
  });

  app.get("/api/tournaments", tourneyRateLimit, async (_req, res) =>
    res.json(await tournamentStore.list()),
  );

  app.get("/api/tournaments/:id", tourneyRateLimit, async (req, res) => {
    const t = await tournamentStore.get(req.params.id);
    if (!t) return res.status(404).json({ error: "Tournament not found" });
    return res.json(t);
  });

  app.get(
    "/api/tournaments/:id/bracket",
    tourneyRateLimit,
    async (req, res) => {
      const bracket = await tournamentStore.getBracket(req.params.id);
      if (!bracket)
        return res.status(404).json({ error: "Tournament not found" });
      return res.json(bracket);
    },
  );

  app.post(
    "/api/tournaments/:id/register",
    tourneyRateLimit,
    async (req, res) => {
      const parsed = z
        .object({
          persistentId: z.string().min(1).max(64),
          eloRating: z.number().int().min(0).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Missing persistentId" });
      const actor = await requireVaultFrontActor(req, res);
      if (!actor || !acceptActorClaim(actor, parsed.data.persistentId, res))
        return;
      const result = await tournamentStore.register(
        req.params.id,
        actor.persistentId,
        parsed.data.eloRating ?? 1200,
      );
      if ("error" in result) return res.status(409).json(result);
      return res.json(result);
    },
  );

  app.post("/api/tournaments/:id/seed", tourneyRateLimit, async (req, res) => {
    const actor = await requireVaultFrontActor(req, res);
    if (!actor) return;
    const tournament = await tournamentStore.get(req.params.id);
    if (!canManageTournament(tournament, actor.persistentId)) {
      return res
        .status(403)
        .json({ error: "Only the tournament creator can seed the bracket" });
    }
    const result = await tournamentStore.seedBracket(req.params.id);
    if ("error" in result) return res.status(409).json(result);
    recordVaultFrontPlaytestPulse({
      surface: "tournament",
      event: "seed_bracket",
    });
    return res.json(result);
  });

  app.post(
    "/api/tournaments/matches/:matchId/report",
    tourneyRateLimit,
    async (req, res) => {
      const parsed = z
        .object({ gameId: z.string().min(1).max(64) })
        .safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Certified gameId required" });
      const actor = await requireVaultFrontActor(req, res);
      if (!actor) return;
      const matchId = parseInt(req.params.matchId);
      const tournament = await tournamentStore.getTournamentForMatch(matchId);
      if (!canManageTournament(tournament, actor.persistentId))
        return res
          .status(403)
          .json({ error: "Only the tournament creator can report results" });
      const match = tournamentStore.getMatch(matchId);
      if (!match?.playerA || !match.playerB)
        return res.status(409).json({ error: "Playable match not found." });
      const certified = certifyArchivedGame(
        parsed.data.gameId,
        await readGameRecord(parsed.data.gameId as GameID),
      );
      if ("error" in certified) return res.status(409).json(certified);
      if (
        !certificateBindsPersistentIds(certified, [
          match.playerA,
          match.playerB,
        ])
      )
        return res.status(409).json({
          error: "Certificate does not bind both bracket participants.",
        });
      const winners = certifiedWinnerPersistentIds(certified);
      if (
        winners.length !== 1 ||
        ![match.playerA, match.playerB].includes(winners[0]!)
      )
        return res
          .status(409)
          .json({ error: "Certificate does not name one bracket winner." });
      const result = await tournamentStore.reportCertifiedResult(
        matchId,
        winners[0]!,
        parsed.data.gameId,
        certified.certificate.certificateId,
      );
      if ("error" in result) return res.status(409).json(result);
      recordVaultFrontPlaytestPulse({
        surface: "tournament",
        event: "report_winner",
      });
      return res.json(result);
    },
  );
  // ─────────────────────────────────────────────────────────────────────────

  // ── Rematch queue ─────────────────────────────────────────────────────────
  const rematchRateLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
  });

  registerRematchRoutes(app, {
    authenticate: (req, res) => requireVaultFrontActor(req, res),
    resolveAuthorizedSource: async (gameId, actor) => {
      const live = gm.game(gameId as GameID);
      if (live?.getClientIdForPersistentId(actor.persistentId)) {
        return {
          config: live.gameConfig,
          mapName: String(live.gameConfig.gameMap),
          evidence: "live-participant" as const,
        };
      }
      const record = await readGameRecord(gameId as GameID);
      return authorizeArchivedRematchSource(record, gameId, actor.persistentId);
    },
    joinExisting: (gameId, actorKey) => rematchStore.join(gameId, actorKey),
    createLobby: (sourceConfig, creatorPersistentId) => {
      const allocation = createVerifiedWorkerRoutedGameId({
        workerId,
        workerIndex: (gameId) => config.workerIndex(gameId),
        isTaken: (gameId) => gm.game(gameId) !== undefined,
      });
      if (!allocation.ok) {
        log.warn(
          "Failed to allocate worker-routed rematch game ID",
          allocation,
        );
        return null;
      }
      const lobbyId = allocation.gameId;
      gm.createGame(lobbyId, sourceConfig, creatorPersistentId);
      const playBase = (
        process.env.PLAY_BASE_URL ??
        "https://play-vaultfront.vaultsparkstudios.com"
      ).replace(/\/+$/, "");
      const workerPath = config.workerPath(lobbyId).replace(/^\/+|\/+$/g, "");
      return {
        lobbyId,
        joinUrl: `${playBase}/${workerPath}/game/${encodeURIComponent(lobbyId)}?lobby`,
      };
    },
    createEntry: (input) => rematchStore.create(input),
    get: (gameId) => rematchStore.get(gameId),
    getByCode: (code) => rematchStore.getByCode(code),
    rateLimit: rematchRateLimit,
  });
  // ─────────────────────────────────────────────────────────────────────────

  // ── Replay highlight clips ────────────────────────────────────────────────
  app.get("/api/replay/:gameId/highlight", async (req, res) => {
    const { gameId } = req.params;
    if (!gameId) return res.status(400).json({ error: "Missing gameId" });
    const manifest = await replayStore.getReplay(gameId);
    if (!manifest) return res.status(404).json({ error: "Replay not found" });
    const highlight = replayHighlightStore.getOrCreate(gameId, manifest);
    return res.json(highlight);
  });

  const CustomClipSchema = z.object({
    startTick: z.number().int().min(0),
    endTick: z.number().int().min(0),
  });

  const clipRateLimit = rateLimit({ windowMs: 60_000, max: 20 });

  assertRoutePolicyBinding(
    "replay-custom-clip",
    "POST",
    "/api/replay/:gameId/clip",
  );
  app.post(
    "/api/replay/:gameId/clip",
    clipRateLimit,
    async (req: Request, res: Response) => {
      const { gameId } = req.params;
      if (!gameId) return res.status(400).json({ error: "Missing gameId" });

      const parsed = CustomClipSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid clip range" });
      }
      const { startTick, endTick } = parsed.data;
      if (endTick <= startTick) {
        return res.status(400).json({ error: "endTick must be > startTick" });
      }

      const manifest = await replayStore.getReplay(gameId);
      if (!manifest) return res.status(404).json({ error: "Replay not found" });

      let share;
      try {
        share = createReplayShareProjection(manifest, {
          kind: "clip",
          startTurn: startTick,
          endTurn: endTick,
        });
      } catch (error) {
        if (error instanceof ReplayShareContractError) {
          return res
            .status(409)
            .json({ error: error.message, code: error.code });
        }
        throw error;
      }

      return res.json({
        clipId: share.shareId,
        shareUrl: share.shareUrl,
        gameId,
        startTick: share.startTurn,
        endTick: share.endTurn,
        mapName: manifest.mapName ?? "Unknown Map",
        evidence: {
          contractVersion: share.contractVersion,
          replayEvidenceDigest: share.replayEvidenceDigest,
          replayDurationTurns: share.replayDurationTurns,
        },
      });
    },
  );
  // ─────────────────────────────────────────────────────────────────────────

  // WebSocket handling
  wss.on("connection", (ws: WebSocket, req) => {
    ws.on("message", async (message: string) => {
      const forwarded = req.headers["x-forwarded-for"];
      const ip = Array.isArray(forwarded)
        ? forwarded[0]
        : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          forwarded || req.socket.remoteAddress || "unknown";

      try {
        // Parse and handle client messages
        const parsed = ClientMessageSchema.safeParse(
          JSON.parse(message.toString()),
        );
        if (!parsed.success) {
          const error = z.prettifyError(parsed.error);
          log.warn("Error parsing client message", error);
          ws.send(
            JSON.stringify({
              type: "error",
              error: error.toString(),
            } satisfies ServerErrorMessage),
          );
          ws.close(1002, "ClientJoinMessageSchema");
          return;
        }
        const clientMsg = parsed.data;

        if (clientMsg.type === "ping") {
          // Ignore ping
          return;
        } else if (clientMsg.type !== "join" && clientMsg.type !== "rejoin") {
          log.warn(
            `Invalid message before join: ${JSON.stringify(clientMsg, replacer)}`,
          );
          return;
        }

        // Verify this worker should handle this game
        const expectedWorkerId = config.workerIndex(clientMsg.gameID);
        if (expectedWorkerId !== workerId) {
          log.warn(
            `Worker mismatch: Game ${clientMsg.gameID} should be on worker ${expectedWorkerId}, but this is worker ${workerId}`,
          );
          return;
        }

        // Verify token signature
        const result = await verifyClientToken(clientMsg.token, config);
        if (result.type === "error") {
          log.warn(`Invalid token: ${result.message}`, {
            gameID: clientMsg.gameID,
          });
          ws.close(1002, `Unauthorized: invalid token`);
          return;
        }
        const { persistentId, claims } = result;

        if (clientMsg.type === "rejoin") {
          log.info("rejoining game", {
            gameID: clientMsg.gameID,
            persistentID: persistentId,
          });
          const wasFound = gm.rejoinClient(
            ws,
            persistentId,
            clientMsg.gameID,
            clientMsg.lastTurn,
          );
          if (!wasFound) {
            log.warn(
              `game ${clientMsg.gameID} not found on worker ${workerId}`,
            );
            ws.close(1002, "Game not found");
          }
          return;
        }

        // Try to reconnect an existing client (e.g., page refresh)
        // If successful, skip all authorization (but pass updated username
        // so players can rename in the pre-game lobby)
        const censoredUsername = privilegeRefresher
          .get()
          .censorUsername(clientMsg.username);
        if (
          gm.rejoinClient(
            ws,
            persistentId,
            clientMsg.gameID,
            0,
            censoredUsername,
          )
        ) {
          return;
        }

        let roles: string[] | undefined;
        let flares: string[] | undefined;

        const allowedFlares = config.allowedFlares();
        if (claims === null) {
          if (allowedFlares !== undefined) {
            log.warn("Unauthorized: Anonymous user attempted to join game");
            ws.close(1002, "Unauthorized");
            return;
          }
        } else {
          // Verify token and get player permissions
          const result = await getUserMe(clientMsg.token, config);
          if (result.type === "error") {
            log.warn(`Unauthorized: ${result.message}`, {
              persistentID: persistentId,
              gameID: clientMsg.gameID,
            });
            ws.close(1002, "Unauthorized: user me fetch failed");
            return;
          }
          roles = result.response.player.roles;
          flares = result.response.player.flares;

          if (allowedFlares !== undefined) {
            const allowed =
              allowedFlares.length === 0 ||
              allowedFlares.some((f) => flares?.includes(f));
            if (!allowed) {
              log.warn(
                "Forbidden: player without an allowed flare attempted to join game",
              );
              ws.close(1002, "Forbidden");
              return;
            }
          }
        }

        const cosmeticResult = privilegeRefresher
          .get()
          .isAllowed(flares ?? [], clientMsg.cosmetics ?? {});

        if (cosmeticResult.type === "forbidden") {
          log.warn(`Forbidden: ${cosmeticResult.reason}`, {
            persistentID: persistentId,
            gameID: clientMsg.gameID,
          });
          ws.close(1002, cosmeticResult.reason);
          return;
        }

        if (config.env() !== GameEnv.Dev) {
          const turnstileResult = await verifyTurnstileToken(
            ip,
            clientMsg.turnstileToken,
            config.turnstileSecretKey(),
          );
          switch (turnstileResult.status) {
            case "approved":
              break;
            case "rejected":
              log.warn("Unauthorized: Turnstile token rejected", {
                persistentID: persistentId,
                gameID: clientMsg.gameID,
                reason: turnstileResult.reason,
              });
              ws.close(1002, "Unauthorized: Turnstile token rejected");
              return;
            case "error":
              // Fail open, allow the client to join.
              log.error("Turnstile token error", {
                persistentID: persistentId,
                gameID: clientMsg.gameID,
                reason: turnstileResult.reason,
              });
          }
        }

        // Create client and add to game
        const client = new Client(
          generateID(),
          persistentId,
          claims,
          roles,
          flares,
          ip,
          censoredUsername,
          clientMsg.username,
          ws,
          cosmeticResult.cosmetics,
        );

        const joinResult = gm.joinClient(client, clientMsg.gameID);

        if (joinResult === "not_found") {
          log.info(`game ${clientMsg.gameID} not found on worker ${workerId}`);
          ws.close(1002, "Game not found");
        } else if (joinResult === "kicked") {
          log.warn(`kicked client tried to join game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(1002, "Cannot join game");
        } else if (joinResult === "rejected") {
          log.info(`client rejected from game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(1002, "Lobby full");
        }

        // Handle other message types
      } catch (error) {
        ws.close(1011, "Internal server error");
        log.warn(
          `error handling websocket message for ${ipAnonymize(ip)}: ${error}`.substring(
            0,
            250,
          ),
        );
      }
    });

    ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        ws.close(1002, "WS_ERR_UNEXPECTED_RSV_1");
      }
    });
    ws.on("close", () => {
      ws.removeAllListeners();
    });
  });

  // The load balancer will handle routing to this server based on path
  const PORT = config.workerPortByIndex(workerId);
  server.listen(PORT, () => {
    log.info(`running on http://localhost:${PORT}`);
    log.info(`Handling requests with path prefix /w${workerId}/`);
    // Signal to the master process that this worker is ready
    lobbyService.sendReady(workerId);
    log.info(`signaled ready state to master`);
    publishWorkerHealth();
    workerHealthHeartbeatTimer = setInterval(publishWorkerHealth, 1_000);
    workerHealthHeartbeatTimer.unref();
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error(`Error in ${req.method} ${req.path}:`, err);
    res.status(500).json({ error: "An unexpected error occurred" });
  });

  // Process-level error handlers
  process.on("uncaughtException", (err) => {
    log.error(`uncaught exception:`, err);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error(`unhandled rejection at:`, promise, "reason:", reason);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  let isShuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (workerHealthHeartbeatTimer) {
      clearInterval(workerHealthHeartbeatTimer);
      workerHealthHeartbeatTimer = null;
    }
    log.info(
      `[worker ${workerId}] received ${signal} — starting graceful shutdown`,
    );

    // Stop the HTTP server from accepting new connections
    server.close(() => {
      log.info(`[worker ${workerId}] HTTP server closed`);
    });

    // Wait up to 30 s for active games to finish
    const DRAIN_TIMEOUT_MS = 30_000;
    const POLL_INTERVAL_MS = 1_000;
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const active = gm.activeGameCount();
      if (active === 0) break;
      log.info(`[worker ${workerId}] draining ${active} active game(s)…`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    log.info(`[worker ${workerId}] shutdown complete`);
    process.exit(0);
  }

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
  // ─────────────────────────────────────────────────────────────────────────
}

async function startMatchmakingPolling(gm: GameManager) {
  startPolling(
    async () => {
      try {
        const url = `${config.jwtIssuer() + "/matchmaking/checkin"}`;
        const allocation = createVerifiedWorkerRoutedGameId({
          workerId,
          workerIndex: (gameId) => config.workerIndex(gameId),
          isTaken: (gameId) => gm.game(gameId) !== undefined,
        });
        if (!allocation.ok) {
          log.warn("Failed to allocate matchmaking game ID", allocation);
          return;
        }
        const gameId = allocation.gameId;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.apiKey(),
          },
          body: JSON.stringify({
            id: workerId,
            gameId: gameId,
            ccu: gm.activeClients(),
            instanceId: process.env.INSTANCE_ID,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          log.warn(
            `Failed to poll lobby: ${response.status} ${response.statusText}`,
          );
          return;
        }

        const data = await response.json();
        log.info(`Lobby poll successful:`, data);

        if (data.assignment) {
          gm.createGame(
            gameId,
            playlist.get1v1Config(),
            undefined,
            Date.now() + 7000,
          );
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          // Abort is expected if no game is scheduled on this worker.
          return;
        }
        log.error(`Error polling lobby:`, error);
      }
    },
    5000 + Math.random() * 1000,
  );
}
