import { Logger } from "winston";
import WebSocket from "ws";
import { ServerConfig } from "../core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import { GameConfig, GameID, PublicGameType } from "../core/Schemas";
import { simpleHash } from "../core/Util";
import { Client } from "./Client";
import { gameAllocationDecision } from "./GameCreationAdmission";
import {
  buildGameLoopHealthSnapshot,
  type GameLoopHealthSnapshot,
} from "./GameLoopHealth";
import { GamePhase, GameServer } from "./GameServer";

export class GameManager {
  private games: Map<GameID, GameServer> = new Map();
  private lastTickCompletedAt = Date.now();
  private readonly maxGamesPerWorker: number;

  constructor(
    private config: ServerConfig,
    private log: Logger,
    options?: { maxGamesPerWorker?: number },
  ) {
    const configuredLimit = Number(
      options?.maxGamesPerWorker ??
        process.env.VAULTFRONT_MAX_GAMES_PER_WORKER ??
        512,
    );
    this.maxGamesPerWorker = Number.isFinite(configuredLimit)
      ? Math.max(1, Math.min(5_000, Math.floor(configuredLimit)))
      : 512;
    setInterval(() => this.tick(), 1000);
  }

  public game(id: GameID): GameServer | null {
    return this.games.get(id) ?? null;
  }

  public publicLobbies(): GameServer[] {
    return Array.from(this.games.values()).filter(
      (g) => g.phase() === GamePhase.Lobby && g.isPublic(),
    );
  }

  public activeGameCount(): number {
    return Array.from(this.games.values()).filter(
      (g) => g.phase() === GamePhase.Active,
    ).length;
  }

  public mapName(gameId: GameID): string {
    return this.games.get(gameId)?.gameConfig.gameMap ?? "";
  }

  joinClient(
    client: Client,
    gameID: GameID,
  ): "joined" | "kicked" | "rejected" | "not_found" {
    const game = this.games.get(gameID);
    if (!game) return "not_found";
    return game.joinClient(client);
  }

  rejoinClient(
    ws: WebSocket,
    persistentID: string,
    gameID: GameID,
    lastTurn: number = 0,
    newUsername?: string,
  ): boolean {
    const game = this.games.get(gameID);
    if (!game) return false;
    return game.rejoinClient(ws, persistentID, lastTurn, newUsername);
  }

  createGame(
    id: GameID,
    gameConfig: GameConfig | undefined,
    creatorPersistentID?: string,
    startsAt?: number,
    publicGameType?: PublicGameType,
  ) {
    const allocation = gameAllocationDecision(
      this.games.has(id),
      this.games.size,
      this.maxGamesPerWorker,
    );
    if (allocation === "collision") {
      throw new GameAllocationError("collision", `game ${id} already exists`);
    }
    if (allocation === "capacity") {
      throw new GameAllocationError(
        "capacity",
        `worker game capacity ${this.maxGamesPerWorker} reached`,
      );
    }
    const runtimeAssignment = this.assignVaultRuntimeExperiment(id);
    const mergedConfig = {
      donateGold: false,
      donateTroops: false,
      gameMap: GameMapType.World,
      gameType: GameType.Private,
      gameMapSize: GameMapSize.Normal,
      difficulty: Difficulty.Medium,
      nations: "default",
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: false,
      gameMode: GameMode.FFA,
      bots: 400,
      disabledUnits: [],
      ...gameConfig,
      vaultRuntimeExperiment:
        gameConfig?.vaultRuntimeExperiment ?? runtimeAssignment,
      vaultWeeklyMutator:
        gameConfig?.vaultWeeklyMutator ?? this.assignVaultWeeklyMutator(),
      vaultConvoyRewardTuning:
        gameConfig?.vaultConvoyRewardTuning ??
        this.variantRewardTuning(runtimeAssignment.rewardVariant),
    } satisfies GameConfig;

    const game = new GameServer(
      id,
      this.log,
      Date.now(),
      this.config,
      mergedConfig,
      creatorPersistentID,
      startsAt,
      publicGameType,
    );
    this.games.set(id, game);
    return game;
  }

  private assignVaultRuntimeExperiment(id: GameID): {
    experimentId: "vault_runtime_v1";
    rewardVariant: "control" | "high_risk_high_reward";
    hudVariant: "default" | "mobile_priority";
  } {
    const bucket = simpleHash(`vault_runtime_v1:${id}`) % 100;
    const rewardVariant = bucket < 50 ? "control" : "high_risk_high_reward";
    const hudVariant = bucket % 2 === 0 ? "default" : "mobile_priority";
    return {
      experimentId: "vault_runtime_v1",
      rewardVariant,
      hudVariant,
    };
  }

  private variantRewardTuning(variant: "control" | "high_risk_high_reward"): {
    version: "v1";
    values: Record<string, number>;
  } {
    if (variant === "high_risk_high_reward") {
      return {
        version: "v1",
        values: {
          riskMultiplierBase: 0.86,
          riskMultiplierScale: 0.65,
          rewardMultiplierMax: 1.62,
          baselineGoldRiskScale: 0.42,
          distanceGoldRiskScale: 0.82,
          troopsDistanceRiskScale: 7.4,
        },
      };
    }
    return {
      version: "v1",
      values: {},
    };
  }

  private assignVaultWeeklyMutator():
    "none" | "lane_fog" | "accelerated_cooldowns" | "double_passive" {
    const now = new Date();
    const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1);
    const dayMs = 24 * 60 * 60 * 1000;
    const dayOfYear = Math.floor((now.getTime() - yearStart) / dayMs);
    const weekIndex = Math.floor(dayOfYear / 7);
    const cycle = [
      "lane_fog",
      "accelerated_cooldowns",
      "double_passive",
    ] as const;
    return cycle[weekIndex % cycle.length];
  }

  activeGames(): number {
    return this.games.size;
  }

  allocationSnapshot(): {
    activeGames: number;
    maxGamesPerWorker: number;
    availableSlots: number;
  } {
    return {
      activeGames: this.games.size,
      maxGamesPerWorker: this.maxGamesPerWorker,
      availableSlots: Math.max(0, this.maxGamesPerWorker - this.games.size),
    };
  }

  activeClients(): number {
    let totalClients = 0;
    this.games.forEach((game: GameServer) => {
      totalClients += game.activeClients.length;
    });
    return totalClients;
  }

  desyncCount(): number {
    let totalDesyncs = 0;
    this.games.forEach((game: GameServer) => {
      totalDesyncs += game.desyncCount;
    });
    return totalDesyncs;
  }

  public healthSnapshot(
    now = Date.now(),
    maxAgeMs = 3_500,
  ): GameLoopHealthSnapshot {
    return buildGameLoopHealthSnapshot(this.lastTickCompletedAt, now, maxAgeMs);
  }

  tick() {
    const active = new Map<GameID, GameServer>();
    for (const [id, game] of this.games) {
      const phase = game.phase();
      if (phase === GamePhase.Active) {
        if (!game.hasStarted()) {
          // Prestart tells clients to start loading the game.
          game.prestart();
          // Start game on delay to allow time for clients to connect.
          setTimeout(() => {
            try {
              game.start();
            } catch (error) {
              this.log.error(`error starting game ${id}: ${error}`);
            }
          }, 2000);
        }
      }

      if (phase === GamePhase.Finished) {
        void game.end().catch((error) => {
          this.log.error(`error ending game ${id}: ${error}`);
        });
      } else {
        active.set(id, game);
      }
    }
    this.games = active;
    this.lastTickCompletedAt = Date.now();
  }

  /**
   * Bounded deployment fallback: normal draining waits for matches to finish.
   * At the explicit drain deadline, finalize every remaining replay/archive as
   * an incomplete session before the process is allowed to exit.
   */
  public async endAllForShutdown(): Promise<void> {
    const remaining = [...this.games.values()];
    this.games = new Map();
    const outcomes = await Promise.allSettled(
      remaining.map((game) => game.end()),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        this.log.error(
          `error finalizing game during shutdown: ${outcome.reason}`,
        );
      }
    }
  }
}

export class GameAllocationError extends Error {
  constructor(
    readonly code: "collision" | "capacity",
    message: string,
  ) {
    super(message);
    this.name = "GameAllocationError";
  }
}
