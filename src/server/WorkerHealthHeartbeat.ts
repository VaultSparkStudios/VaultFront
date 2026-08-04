import type { GameLoopHealthSnapshot } from "./GameLoopHealth";
import type {
  WorkerHealthHeartbeat,
  WorkerHealthReason,
} from "./IPCBridgeSchema";
import type { IpcHealthSnapshot } from "./IpcHealth";
import type { DatabasePosture } from "./db/pool";

export function buildWorkerHealthHeartbeat(
  input: {
    gameLoop: GameLoopHealthSnapshot;
    ipc: IpcHealthSnapshot;
    database: DatabasePosture;
    persistenceRequired?: boolean;
  },
  observedAt = Date.now(),
): Omit<WorkerHealthHeartbeat, "type" | "workerId"> {
  const reasons: WorkerHealthReason[] = [];
  if (!input.gameLoop.healthy) reasons.push("game-loop-stale");
  if (!input.ipc.connected) reasons.push("ipc-disconnected");
  else if (!input.ipc.healthy) reasons.push("ipc-stale");
  if (input.database.state === "connecting") {
    reasons.push("persistence-connecting");
  }
  if (input.database.state === "failed") reasons.push("persistence-failed");
  if (input.persistenceRequired && input.database.state === "disabled") {
    reasons.push("persistence-disabled");
  }
  return { observedAt, healthy: reasons.length === 0, reasons };
}
