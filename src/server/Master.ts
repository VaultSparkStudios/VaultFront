import cluster from "cluster";
import cors from "cors";
import crypto from "crypto";
import express from "express";
import helmet from "helmet";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { certifiedLoopEvidenceStore } from "./CertifiedLoopEvidenceStore";
import { databaseReady, pool } from "./db/pool";
import { FatalProcessCoordinator } from "./FatalProcessCoordinator";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { MasterLobbyService } from "./MasterLobbyService";
import { readObeliskConfig, registerObeliskAuthRoutes } from "./ObeliskAuth";
import { playtestEvidenceStore } from "./PlaytestEvidenceStore";
import { PlaytestSummaryService } from "./PlaytestSummaryService";
import { projectPublicPlaytestSummary } from "./PublicPlaytestSummary";
import { createRenderedHtmlDocument } from "./RenderHtml";
import { installPreparseRequestAdmission } from "./RequestAdmission";
import { loadRuntimeReleaseEvidence } from "./RuntimeReleaseEvidence";
import {
  serverCrashStore,
  truncateServerCrashMessage,
} from "./ServerCrashStore";
import {
  installStripeSupportBodyParsers,
  loadRevenueObservation,
  registerStripeSupportRoutes,
} from "./StripeSupport";
import { shutdownTelemetry } from "./TelemetryLifecycle";
import { buildVaultFrontReadiness } from "./VaultFrontReadiness";
import { createWorkerApiProxy } from "./WorkerApiProxy";

const config = getServerConfigFromServer();
const playlist = new MapPlaylist();
let lobbyService: MasterLobbyService;

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });
const fatalProcess = new FatalProcessCoordinator({
  process: "master",
  processId: process.pid,
  record: (event) =>
    serverCrashStore.record({
      ...event,
      message: truncateServerCrashMessage(event.message),
    }),
  stopAdmission: () => {
    if (server.listening) server.close();
  },
  drain: async () => {
    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.process.kill("SIGTERM");
    }
  },
  exportCrash: async () => {
    const telemetry = await shutdownTelemetry(5_000);
    if (telemetry.failures.length > 0) {
      log.error("fatal telemetry export incomplete", telemetry);
    }
  },
  exit: (code) => process.exit(code),
  reportFailure: (phase, error) =>
    log.error("fatal process drain failed", { phase, error: String(error) }),
});
const playtestSummaryService = new PlaytestSummaryService({
  loadPulse: () => playtestEvidenceStore.summary(),
  loadCertified: (observedAt) =>
    certifiedLoopEvidenceStore
      .getSummary(1_000, observedAt - 24 * 60 * 60 * 1_000)
      .catch(() => null),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexDocument = createRenderedHtmlDocument(
  path.join(__dirname, "../../static/index.html"),
);

// ── Security middleware ─────────────────────────────────────────────────────
const masterAllowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((s) =>
  s.trim(),
) ?? [
  "https://vaultfront.io",
  "https://staging.vaultfront.io",
  "http://localhost:5173",
  "http://localhost:3000",
];
app.use(cors({ origin: masterAllowedOrigins, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(fatalProcess.admissionMiddleware());
installStripeSupportBodyParsers(app);
installPreparseRequestAdmission(app);
const obeliskConfig = readObeliskConfig();
if (config.env() !== GameEnv.Dev && !obeliskConfig) {
  throw new Error(
    "Obelisk Passport v2 configuration is required outside development",
  );
}
if (obeliskConfig) registerObeliskAuthRoutes(app, log);
registerStripeSupportRoutes(app, {
  pool: () => pool,
  reportError: (error) =>
    log.error("Stripe support route failed", { error: String(error) }),
});
// ─────────────────────────────────────────────────────────────────────────

// Middleware to handle HTML files with EJS templating
app.use(async (req, res, next) => {
  if (req.path === "/") {
    try {
      await indexDocument.send(res);
    } catch (error) {
      log.error("Error rendering index.html:", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    next();
  }
});

app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res, path) => {
      // You can conditionally set different cache times based on file types
      if (path.match(/\.(js|css|svg)$/)) {
        // JS, CSS, SVG get long cache with immutable
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (path.match(/\.(bin|dat|exe|dll|so|dylib)$/)) {
        // Binary files also get long cache with immutable
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      // Other file types use the default maxAge setting
    },
  }),
);

// Start the master process
export async function startMaster() {
  if (!cluster.isPrimary) {
    throw new Error(
      "startMaster() should only be called in the primary process",
    );
  }

  log.info(`Primary ${process.pid} is running`);
  await databaseReady;
  log.info(`Setting up ${config.numWorkers()} workers...`);

  lobbyService = new MasterLobbyService(config, playlist, log);
  let masterShuttingDown = false;

  // Generate admin token for worker authentication
  const ADMIN_TOKEN = crypto.randomBytes(16).toString("hex");
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;

  const INSTANCE_ID =
    config.env() === GameEnv.Dev
      ? "DEV_ID"
      : crypto.randomBytes(4).toString("hex");
  process.env.INSTANCE_ID = INSTANCE_ID;

  log.info(`Instance ID: ${INSTANCE_ID}`);
  // Render the immutable shell before opening the listener. The first public
  // visitor must not pay filesystem and EJS initialization costs, and every
  // concurrent request shares this instance-bound result.
  await indexDocument.warm();

  // Fork workers
  for (let i = 0; i < config.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
      ADMIN_TOKEN,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(i, worker);
    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (workerId === undefined) {
      log.error(`worker crashed could not find id`);
      return;
    }

    const workerIdNum = parseInt(workerId);
    lobbyService.removeWorker(workerIdNum);

    if (masterShuttingDown) {
      log.info(`Worker ${workerId} exited during bounded master drain`);
      return;
    }

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    log.info(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
      ADMIN_TOKEN,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(workerIdNum, newWorker);
    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    log.info(`Master HTTP server listening on port ${PORT}`);
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────
  function shutdownMaster(signal: string): void {
    if (masterShuttingDown) return;
    masterShuttingDown = true;
    log.info(`[master] received ${signal} — stopping new game creation`);

    // Stop accepting new master traffic and immediately put every worker into
    // its own bounded match drain. Waiting for server.close before forwarding
    // the signal can deadlock on long-lived upgraded connections.
    server.close(() => {
      log.info(`[master] HTTP server closed`);
    });
    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.process.kill(signal as NodeJS.Signals);
    }
    const configuredDrainSeconds = Number.parseInt(
      process.env.DEPLOY_DRAIN_TIMEOUT_SECONDS ?? "900",
      10,
    );
    const containerStopSeconds =
      Number.isSafeInteger(configuredDrainSeconds) &&
      configuredDrainSeconds >= 45 &&
      configuredDrainSeconds <= 10_800
        ? configuredDrainSeconds
        : 900;
    setTimeout(
      async () => {
        log.info(`[master] bounded drain complete; exiting`);
        const telemetry = await shutdownTelemetry(5_000);
        if (telemetry.failures.length > 0) {
          console.error("telemetry shutdown incomplete", telemetry);
        }
        process.exit(0);
      },
      Math.max(30, containerStopSeconds - 10) * 1_000,
    );
  }

  process.on("SIGTERM", () => shutdownMaster("SIGTERM"));
  process.on("SIGINT", () => shutdownMaster("SIGINT"));

  // Process-level error handlers (S99 second-order follow-up: previously
  // unhandled here, meaning a master-process crash produced no structured
  // record before the process died -- see ServerCrashStore.ts).
  process.on("uncaughtException", (err) => {
    log.error(`uncaught exception:`, err);
    void fatalProcess.handleFatal("uncaughtException", err);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error(`unhandled rejection at:`, promise, "reason:", reason);
    void fatalProcess.handleFatal("unhandledRejection", reason);
  });
  // ─────────────────────────────────────────────────────────────────────────
}

app.get("/api/env", async (req, res) => {
  const env = process.env.GAME_ENV;
  const envConfig = {
    env,
    game_env: env,
  };
  if (!envConfig.game_env) return res.sendStatus(500);
  res.json(envConfig);
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", scope: "master-process", liveness: true });
});

// Canonical infrastructure probe used by staging and release gates.
app.get("/_health", (_req, res) => {
  const workerHealth = lobbyService?.healthSnapshot() ?? null;
  const ready = fatalProcess.isAccepting() && (workerHealth?.healthy ?? false);
  if (ready) {
    res.json({ status: "ok", scope: "master", workerHealth });
  } else {
    res
      .status(503)
      .json({ status: "unavailable", scope: "master", workerHealth });
  }
});

app.get("/api/vaultfront/readiness", async (_req, res) => {
  const healthy =
    fatalProcess.isAccepting() &&
    (lobbyService?.healthSnapshot().healthy ?? false);
  const runtimeReleaseEvidence = loadRuntimeReleaseEvidence();
  const revenueObservation = await loadRevenueObservation(pool).catch(
    (error) => {
      log.error("master revenue evidence unavailable", {
        error: String(error),
      });
      return undefined;
    },
  );
  const releaseEvidence = {
    ...runtimeReleaseEvidence.releaseEvidence,
    observations: {
      ...runtimeReleaseEvidence.releaseEvidence.observations,
      ...(revenueObservation ? { revenueObservation } : {}),
    },
  };
  let playtestPulse;
  try {
    playtestPulse = projectPublicPlaytestSummary(
      await playtestSummaryService.summary(),
    );
  } catch (error) {
    // Runtime health and evidence readiness are separate authorities. Keep the
    // process response available while the absent Alpha summary fails closed.
    log.error("master readiness playtest evidence unavailable", {
      error: String(error),
    });
  }
  res.status(healthy ? 200 : 503).json(
    buildVaultFrontReadiness({
      healthy,
      processRole: "master",
      playtestPulse,
      releaseEvidence,
      revenueSignal: revenueObservation
        ? {
            status: "observed",
            observedAt: revenueObservation.observedAt,
          }
        : { status: "unverified" },
    }),
  );
});

// Public playtest learning must terminate on the same master origin as the
// browser. Worker-only registration is insufficient in clustered production:
// the master owns HTTP and its SPA fallback otherwise turns this JSON route
// into index.html. Both processes read the same durable evidence stores, so
// this projection remains authoritative without proxying to an arbitrary
// worker.
app.get("/api/vaultfront/playtest-pulse/summary", async (_req, res) => {
  try {
    return res.json(
      projectPublicPlaytestSummary(await playtestSummaryService.summary()),
    );
  } catch (error) {
    log.error("master playtest evidence summary failed", {
      error: String(error),
    });
    return res.status(503).json({ error: "Playtest evidence unavailable" });
  }
});

// Project APIs are registered on workers. Keep global calls on one durable
// control-plane shard and preserve canonical game-id routing for live-match
// calls instead of allowing the SPA fallback to return HTML with status 200.
app.use(
  createWorkerApiProxy({
    workerIndex: (gameId) => config.workerIndex(gameId),
    workerPortByIndex: (index) => config.workerPortByIndex(index),
    reportError: (error) =>
      log.error("worker API proxy failed", { error: String(error) }),
  }),
);

// SPA fallback route
app.get("*", async function (_req, res) {
  try {
    await indexDocument.send(res);
  } catch (error) {
    log.error("Error rendering SPA fallback:", error);
    res.status(500).send("Internal Server Error");
  }
});
