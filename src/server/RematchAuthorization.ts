import type { GameConfig, MatchResultCertificate } from "../core/Schemas";
import { verifyMatchResultCertificate } from "./MatchResultCertificate";
import type { AuthorizedRematchSource } from "./RematchRouter";

export interface ArchivedRematchRecord {
  info: {
    config: GameConfig;
    players: Array<{ clientID: string; persistentID: string | null }>;
  };
  telemetry?: {
    resultCertificate?: MatchResultCertificate;
  };
}

export function authorizeArchivedRematchSource(
  record: ArchivedRematchRecord | null,
  gameId: string,
  persistentId: string,
): AuthorizedRematchSource | null {
  const participant = record?.info.players.find(
    (player) => player.persistentID === persistentId,
  );
  const certificate = record?.telemetry?.resultCertificate;
  if (
    !record ||
    !participant ||
    !certificate ||
    certificate.gameID !== gameId ||
    !verifyMatchResultCertificate(certificate) ||
    !certificate.result.allPlayersStats[participant.clientID]
  ) {
    return null;
  }
  return {
    config: record.info.config,
    mapName: String(record.info.config.gameMap),
    evidence: "archived-participant",
  };
}
