import z from "zod";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import {
  GameID,
  GameRecord,
  GameRecordSchema,
  ID,
  PartialGameRecord,
} from "../core/Schemas";
import {
  ArchiveDeliveryManager,
  HybridArchiveDeliveryOutbox,
  type ArchiveDeliveryKind,
  type ArchiveDeliveryReceipt,
  type ArchiveDeliverySnapshot,
} from "./ArchiveDelivery";
import { logger } from "./Logger";

const config = getServerConfigFromServer();

const log = logger.child({ component: "Archive" });

export const archiveDeliveryManager = new ArchiveDeliveryManager({
  outbox: new HybridArchiveDeliveryOutbox(),
  endpointForGame: (gameId) =>
    `${config.jwtIssuer()}/game/${encodeURIComponent(gameId)}`,
  apiKey: () => config.apiKey(),
});

export function archiveDeliveryPosture(): ArchiveDeliverySnapshot {
  return archiveDeliveryManager.snapshot();
}

export async function archive(
  gameRecord: GameRecord,
  kind: ArchiveDeliveryKind = gameRecord.telemetry?.resultCertificate
    ? "certified"
    : "incomplete",
): Promise<ArchiveDeliveryReceipt> {
  const parsed = GameRecordSchema.safeParse(gameRecord);
  if (!parsed.success) {
    const error = `invalid-game-record:${z.prettifyError(parsed.error)}`;
    log.error("invalid game record rejected before archive delivery", {
      gameID: gameRecord.info.gameID,
      kind,
      error,
    });
    return {
      deliveryId: `rejected:${kind}:${gameRecord.info.gameID}`,
      gameId: gameRecord.info.gameID,
      kind,
      certificateId:
        gameRecord.telemetry?.resultCertificate?.certificateId ?? null,
      state: "rejected",
      durability: archiveDeliveryManager.snapshot().durability,
      attempts: 0,
      lastError: error.slice(0, 160),
    };
  }
  const receipt = await archiveDeliveryManager.deliver(parsed.data, kind);
  if (receipt.state === "delivered") {
    log.info("game archive delivery receipt", receipt);
  } else {
    log.warn("game archive delivery receipt", receipt);
  }
  return receipt;
}

export async function readGameRecord(
  gameId: GameID,
): Promise<GameRecord | null> {
  try {
    if (!ID.safeParse(gameId).success) {
      log.error(`invalid game ID: ${gameId}`);
      return null;
    }
    const url = `${config.jwtIssuer()}/game/${gameId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const record = await response.json();
    if (!response.ok) {
      log.error(`error reading game record: ${response.statusText}`, {
        gameID: gameId,
      });
      return null;
    }
    return GameRecordSchema.parse(record);
  } catch (error) {
    log.error(`error reading game record: ${error}`, {
      gameID: gameId,
    });
    return null;
  }
}

export function finalizeGameRecord(
  clientRecord: PartialGameRecord,
): GameRecord {
  return {
    ...clientRecord,
    gitCommit: config.gitCommit(),
    subdomain: config.subdomain(),
    domain: config.domain(),
  };
}
