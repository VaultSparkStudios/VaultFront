import { Worker } from "cluster";
import winston from "winston";
import { ServerConfig } from "../core/configuration/Config";
import { PublicGameInfo, PublicGameType } from "../core/Schemas";
import { generateID } from "../core/Util";
import {
  MasterCreateGame,
  MasterLobbiesBroadcast,
  MasterUpdateGame,
  WorkerMessageSchema,
  type WorkerHealthHeartbeat,
} from "./IPCBridgeSchema";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { startPolling } from "./PollingLoop";

export interface MasterLobbyServiceOptions {
  config: ServerConfig;
  playlist: MapPlaylist;
  log: typeof logger;
}

export const WORKER_HEALTH_MAX_AGE_MS = 3_500;

interface WorkerHealthEvidence {
  heartbeat: WorkerHealthHeartbeat;
  receivedAt: number;
}

export interface MasterWorkerHealthSnapshot {
  healthy: boolean;
  started: boolean;
  registeredWorkers: number;
  requiredHealthyWorkers: number;
  freshHealthyWorkers: number;
  maxAgeMs: number;
  workers: Array<{
    workerId: number;
    status: "missing" | "stale" | "degraded" | "healthy";
    ageMs: number | null;
    reasons: string[];
  }>;
}

export class MasterLobbyService {
  private readonly workers = new Map<number, Worker>();
  // Worker id => the lobbies it owns.
  private readonly workerLobbies = new Map<number, PublicGameInfo[]>();
  private readonly readyWorkers = new Set<number>();
  private readonly workerHealth = new Map<number, WorkerHealthEvidence>();
  private started = false;

  constructor(
    private config: ServerConfig,
    private playlist: MapPlaylist,
    private log: winston.Logger,
  ) {}

  registerWorker(workerId: number, worker: Worker) {
    this.workers.set(workerId, worker);

    worker.on("message", (raw: unknown) => {
      const result = WorkerMessageSchema.safeParse(raw);
      if (!result.success) {
        this.log.error("Invalid IPC message from worker:", raw);
        return;
      }

      const msg = result.data;
      if ("workerId" in msg && msg.workerId !== workerId) {
        this.log.error(
          `Worker ${workerId} sent evidence for worker ${msg.workerId}`,
        );
        return;
      }
      switch (msg.type) {
        case "workerReady":
          this.handleWorkerReady(msg.workerId);
          break;
        case "lobbyList":
          this.workerLobbies.set(workerId, msg.lobbies);
          break;
        case "workerHealth":
          this.workerHealth.set(workerId, {
            heartbeat: msg,
            receivedAt: Date.now(),
          });
          break;
      }
    });
  }

  removeWorker(workerId: number) {
    this.workers.delete(workerId);
    this.workerLobbies.delete(workerId);
    this.readyWorkers.delete(workerId);
    this.workerHealth.delete(workerId);
  }

  healthSnapshot(now = Date.now()): MasterWorkerHealthSnapshot {
    const requiredHealthyWorkers = Math.max(
      Math.ceil(this.config.numWorkers() / 2),
      1,
    );
    const workers = [...this.workers.keys()]
      .sort((a, b) => a - b)
      .map((workerId) => {
        const evidence = this.workerHealth.get(workerId);
        if (!evidence) {
          return {
            workerId,
            status: "missing" as const,
            ageMs: null,
            reasons: ["missing-heartbeat"],
          };
        }
        const sourceAgeMs = Math.max(0, now - evidence.heartbeat.observedAt);
        const transportAgeMs = Math.max(0, now - evidence.receivedAt);
        const ageMs = Math.max(sourceAgeMs, transportAgeMs);
        if (ageMs > WORKER_HEALTH_MAX_AGE_MS) {
          return {
            workerId,
            status: "stale" as const,
            ageMs,
            reasons: ["stale-heartbeat"],
          };
        }
        if (!evidence.heartbeat.healthy) {
          return {
            workerId,
            status: "degraded" as const,
            ageMs,
            reasons: evidence.heartbeat.reasons,
          };
        }
        return {
          workerId,
          status: "healthy" as const,
          ageMs,
          reasons: [],
        };
      });
    const freshHealthyWorkers = workers.filter(
      (worker) => worker.status === "healthy",
    ).length;
    return {
      healthy: this.started && freshHealthyWorkers >= requiredHealthyWorkers,
      started: this.started,
      registeredWorkers: this.workers.size,
      requiredHealthyWorkers,
      freshHealthyWorkers,
      maxAgeMs: WORKER_HEALTH_MAX_AGE_MS,
      workers,
    };
  }

  isHealthy(now = Date.now()): boolean {
    return this.healthSnapshot(now).healthy;
  }

  private handleWorkerReady(workerId: number) {
    this.readyWorkers.add(workerId);
    this.log.info(
      `Worker ${workerId} is ready. (${this.readyWorkers.size}/${this.config.numWorkers()} ready)`,
    );
    if (this.readyWorkers.size === this.config.numWorkers() && !this.started) {
      this.started = true;
      this.log.info("All workers ready, starting game scheduling");
      startPolling(async () => this.broadcastLobbies(), 250);
      startPolling(async () => await this.maybeScheduleLobby(), 1000);
    }
  }

  private getAllLobbies(): Record<PublicGameType, PublicGameInfo[]> {
    const lobbies = Array.from(this.workerLobbies.values()).flat();

    const result: Record<PublicGameType, PublicGameInfo[]> = {
      ffa: [],
      team: [],
      special: [],
    };

    for (const lobby of lobbies) {
      result[lobby.publicGameType].push(lobby);
    }

    for (const type of Object.keys(result) as PublicGameType[]) {
      result[type].sort((a, b) => {
        if (a.startsAt === undefined && b.startsAt === undefined) {
          // Sort by game id for stability.
          return a.gameID > b.gameID ? 1 : -1;
        }
        // If a lobby has startsAt set, we assume it's the active one.
        if (a.startsAt === undefined) return 1;
        if (b.startsAt === undefined) return -1;
        return a.startsAt - b.startsAt;
      });
    }

    return result;
  }

  private broadcastLobbies() {
    const msg = {
      type: "lobbiesBroadcast",
      publicGames: {
        serverTime: Date.now(),
        games: this.getAllLobbies(),
      },
    } satisfies MasterLobbiesBroadcast;
    for (const worker of this.workers.values()) {
      worker.send(msg, (e) => {
        if (e) {
          this.log.error("Failed to send lobbies broadcast to worker:", e);
        }
      });
    }
  }

  private async maybeScheduleLobby() {
    const lobbiesByType = this.getAllLobbies();

    for (const type of Object.keys(lobbiesByType) as PublicGameType[]) {
      const lobbies = lobbiesByType[type];
      if (lobbies.length >= 2) {
        continue;
      }
      const nextLobby = lobbies[0];
      if (nextLobby && nextLobby.startsAt === undefined) {
        // The previous game has started, so we need to set the timer on the next game.
        this.sendMessageToWorker({
          type: "updateLobby",
          gameID: nextLobby.gameID,
          startsAt: Date.now() + this.config.gameCreationRate(),
        });
      }

      this.sendMessageToWorker({
        type: "createGame",
        gameID: generateID(),
        gameConfig: await this.playlist.gameConfig(type),
        publicGameType: type,
      } satisfies MasterCreateGame);
    }
  }

  private sendMessageToWorker(msg: MasterCreateGame | MasterUpdateGame): void {
    const workerId = this.config.workerIndex(msg.gameID);
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.log.error(`Worker ${workerId} not found`);
      return;
    }
    worker.send(msg, (e) => {
      if (e) {
        this.log.error("Failed to send message to worker:", e);
      }
    });
  }
}
