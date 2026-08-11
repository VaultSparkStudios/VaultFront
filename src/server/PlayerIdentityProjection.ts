import { normalizeFortuneTitle } from "../core/PlayerIdentity";
import type { Client } from "./Client";

export async function resolveEquippedFortuneTitle(
  persistentId: string,
  readTitle: (persistentId: string) => Promise<string | null>,
  reportError: (error: unknown) => void,
): Promise<string | null> {
  try {
    return normalizeFortuneTitle(await readTitle(persistentId));
  } catch (error) {
    reportError(error);
    return null;
  }
}

export function projectMatchPlayer(
  client: Pick<
    Client,
    "username" | "clientID" | "cosmetics" | "equippedFortuneTitle"
  >,
  isLobbyCreator: boolean,
) {
  return {
    username: client.username,
    clientID: client.clientID,
    cosmetics: client.cosmetics,
    equippedFortuneTitle: client.equippedFortuneTitle ?? undefined,
    isLobbyCreator,
  };
}
