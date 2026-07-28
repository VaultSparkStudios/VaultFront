import { z } from "zod";
import {
  GameConfigSchema,
  PublicGameInfoSchema,
  PublicGamesSchema,
  PublicGameTypeSchema,
} from "../core/Schemas";

export type WorkerLobbyList = z.infer<typeof WorkerLobbyListSchema>;
export type WorkerReady = z.infer<typeof WorkerReadySchema>;
export type WorkerHealthHeartbeat = z.infer<typeof WorkerHealthHeartbeatSchema>;
export type WorkerHealthReason = z.infer<typeof WorkerHealthReasonSchema>;
export type MasterLobbiesBroadcast = z.infer<
  typeof MasterLobbiesBroadcastSchema
>;

export type MasterUpdateGame = z.infer<typeof MasterUpdateGameSchema>;
export type MasterCreateGame = z.infer<typeof MasterCreateGameSchema>;
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;
export type MasterMessage = z.infer<typeof MasterMessageSchema>;

// --- Worker Messages ---

// Worker tells the master about its lobbies.
const WorkerLobbyListSchema = z.object({
  type: z.literal("lobbyList"),
  lobbies: z.array(PublicGameInfoSchema),
});

const WorkerReadySchema = z.object({
  type: z.literal("workerReady"),
  workerId: z.number().int().nonnegative(),
});

export const WorkerHealthReasonSchema = z.enum([
  "game-loop-stale",
  "ipc-disconnected",
  "ipc-stale",
  "persistence-connecting",
  "persistence-failed",
]);

const WorkerHealthHeartbeatSchema = z
  .object({
    type: z.literal("workerHealth"),
    workerId: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
    healthy: z.boolean(),
    reasons: z.array(WorkerHealthReasonSchema).max(5),
  })
  .refine((value) => value.healthy === (value.reasons.length === 0), {
    message: "healthy must agree with reasons",
  });

export const WorkerMessageSchema = z.discriminatedUnion("type", [
  WorkerLobbyListSchema,
  WorkerReadySchema,
  WorkerHealthHeartbeatSchema,
]);

// --- Master Messages ---

const MasterUpdateGameSchema = z.object({
  type: z.literal("updateLobby"),
  gameID: z.string(),
  startsAt: z.number(),
});

// Broadcasts all public game info to all workers.
// Workers need information on all public lobbies so
// it can send it to the client.
const MasterLobbiesBroadcastSchema = z.object({
  type: z.literal("lobbiesBroadcast"),
  publicGames: PublicGamesSchema,
});

// Master sends a message to worker to schedule a new public game/lobby.
const MasterCreateGameSchema = z.object({
  type: z.literal("createGame"),
  gameID: z.string(),
  gameConfig: GameConfigSchema,
  publicGameType: PublicGameTypeSchema,
});

export const MasterMessageSchema = z.discriminatedUnion("type", [
  MasterLobbiesBroadcastSchema,
  MasterCreateGameSchema,
  MasterUpdateGameSchema,
]);
