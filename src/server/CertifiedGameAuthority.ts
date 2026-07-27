import type { GameRecord, MatchResultCertificate } from "../core/Schemas";
import { verifyMatchResultCertificate } from "./MatchResultCertificate";

export type CertifiedGameContext = {
  record: GameRecord;
  certificate: MatchResultCertificate;
  persistentByClientId: ReadonlyMap<string, string>;
};

export function certifyArchivedGame(
  gameId: string,
  record: GameRecord | null,
): CertifiedGameContext | { error: string } {
  if (!record) return { error: "Certified game not found." };
  const certificate = record.telemetry?.resultCertificate;
  if (
    !certificate ||
    certificate.gameID !== gameId ||
    !verifyMatchResultCertificate(certificate)
  ) {
    return { error: "Verified result certificate required." };
  }
  const persistentByClientId = new Map<string, string>();
  for (const player of record.info.players) {
    if (player.persistentID) {
      persistentByClientId.set(player.clientID, player.persistentID);
    }
  }
  return { record, certificate, persistentByClientId };
}

export function certifiedWinnerPersistentIds(
  context: CertifiedGameContext,
): string[] {
  const winner = context.certificate.result.winner;
  if (!winner || winner[0] === "nation") return [];
  const clientIds = winner[0] === "player" ? [winner[1]] : winner.slice(2);
  return clientIds
    .map((clientId) => context.persistentByClientId.get(clientId))
    .filter((id): id is string => Boolean(id));
}

export function certificateBindsPersistentIds(
  context: CertifiedGameContext,
  persistentIds: readonly string[],
): boolean {
  const bound = new Set(context.persistentByClientId.values());
  return (
    persistentIds.length > 0 &&
    new Set(persistentIds).size === persistentIds.length &&
    persistentIds.every((id) => bound.has(id))
  );
}
