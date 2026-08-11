import type WebSocket from "ws";
import type { TokenPayload } from "../core/ApiSchemas";
import { normalizeFortuneTitle } from "../core/PlayerIdentity";
import type { PlayerCosmetics } from "../core/Schemas";
import { generateID } from "../core/Util";
import { Client } from "./Client";

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

interface FortuneTitleReader {
  getEquippedTitle(persistentId: string): Promise<string | null>;
}

interface AdmissionLogger {
  warn(message: string, metadata: Record<string, unknown>): unknown;
}

export function resolveAdmissionFortuneTitle(
  persistentId: string,
  gameID: string,
  reader: FortuneTitleReader,
  log: AdmissionLogger,
): Promise<string | null> {
  return resolveEquippedFortuneTitle(
    persistentId,
    (id) => reader.getEquippedTitle(id),
    (error) =>
      log.warn("equipped Fortune title unavailable during admission", {
        gameID,
        error: String(error),
      }),
  );
}

interface AdmittedClientInput {
  persistentId: string;
  claims: TokenPayload | null;
  roles: string[] | undefined;
  flares: string[] | undefined;
  ip: string;
  username: string;
  uncensoredUsername: string;
  ws: WebSocket;
  cosmetics: PlayerCosmetics | undefined;
  gameID: string;
  reader: FortuneTitleReader;
  log: AdmissionLogger;
}

export async function createAdmittedClient(
  input: AdmittedClientInput,
): Promise<Client> {
  const title = await resolveAdmissionFortuneTitle(
    input.persistentId,
    input.gameID,
    input.reader,
    input.log,
  );
  return new Client(
    generateID(),
    input.persistentId,
    input.claims,
    input.roles,
    input.flares,
    input.ip,
    input.username,
    input.uncensoredUsername,
    input.ws,
    input.cosmetics,
    title,
  );
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
