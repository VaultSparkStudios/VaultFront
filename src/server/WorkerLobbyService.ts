import http from "http";
import { isIP } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import { GameManager } from "./GameManager";
import {
  MasterMessageSchema,
  WorkerHealthHeartbeat,
  WorkerLobbyList,
  WorkerReady,
} from "./IPCBridgeSchema";
import { buildIpcHealthSnapshot, type IpcHealthSnapshot } from "./IpcHealth";
import { logger } from "./Logger";
import { spectatorBus } from "./SpectatorBus";

export const LOBBY_WS_MAX_PAYLOAD_BYTES = 64 * 1024;
export const SPECTATOR_WS_MAX_PAYLOAD_BYTES = 64 * 1024;
export const WS_UPGRADE_WINDOW_MS = 60_000;
export const WS_MAX_UPGRADES_PER_IP_PER_WINDOW = 120;
export const WS_MAX_CONNECTIONS_PER_IP = 256;
export const LOBBY_MAX_BUFFERED_BYTES = 256 * 1024;

type UpgradeDenialReason = "connection-limit" | "rate-limit";

type UpgradeReservation =
  | { allowed: false; reason: UpgradeDenialReason }
  | { allowed: true; release: () => void };

interface UpgradeWindow {
  count: number;
  startedAt: number;
}

/** Process-local admission guard for all worker WebSocket upgrades. */
export class WebSocketIngressGuard {
  private readonly attempts = new Map<string, UpgradeWindow>();
  private readonly activeConnections = new Map<string, number>();
  private reservationsSincePrune = 0;

  constructor(
    private readonly maxUpgradesPerWindow = WS_MAX_UPGRADES_PER_IP_PER_WINDOW,
    private readonly maxConnectionsPerIp = WS_MAX_CONNECTIONS_PER_IP,
    private readonly windowMs = WS_UPGRADE_WINDOW_MS,
  ) {}

  reserve(ip: string, now = Date.now()): UpgradeReservation {
    this.pruneOccasionally(now);

    const previous = this.attempts.get(ip);
    const window =
      previous === undefined || now - previous.startedAt >= this.windowMs
        ? { count: 0, startedAt: now }
        : previous;
    if (window.count >= this.maxUpgradesPerWindow) {
      return { allowed: false, reason: "rate-limit" };
    }
    window.count += 1;
    this.attempts.set(ip, window);

    const active = this.activeConnections.get(ip) ?? 0;
    if (active >= this.maxConnectionsPerIp) {
      return { allowed: false, reason: "connection-limit" };
    }
    this.activeConnections.set(ip, active + 1);

    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        const next = (this.activeConnections.get(ip) ?? 1) - 1;
        if (next <= 0) this.activeConnections.delete(ip);
        else this.activeConnections.set(ip, next);
      },
    };
  }

  activeForIp(ip: string): number {
    return this.activeConnections.get(ip) ?? 0;
  }

  private pruneOccasionally(now: number): void {
    this.reservationsSincePrune += 1;
    if (this.reservationsSincePrune < 256) return;
    this.reservationsSincePrune = 0;
    for (const [ip, window] of this.attempts) {
      if (
        now - window.startedAt >= this.windowMs * 2 &&
        !this.activeConnections.has(ip)
      ) {
        this.attempts.delete(ip);
      }
    }
  }
}

function isLoopback(address: string): boolean {
  const normalized = address.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
  return normalized === "::1" || normalized.startsWith("127.");
}

function validForwardedIp(value: string | string[] | undefined): string | null {
  const first = (Array.isArray(value) ? value[0] : value)
    ?.split(",")[0]
    ?.trim();
  return first && isIP(first) !== 0 ? first : null;
}

/** Trust proxy-provided client IPs only when the immediate peer is loopback. */
export function websocketIngressIp(request: http.IncomingMessage): string {
  const peer = request.socket.remoteAddress ?? "unknown";
  if (!isLoopback(peer)) return peer;
  return (
    validForwardedIp(request.headers["x-real-ip"]) ??
    validForwardedIp(request.headers["x-forwarded-for"]) ??
    peer
  );
}

function rejectUpgrade(
  socket: NodeJS.WritableStream & { destroy: () => void },
  reason: UpgradeDenialReason,
): void {
  const status = reason === "rate-limit" ? "429 Too Many Requests" : "503 Busy";
  socket.write(
    "HTTP/1.1 " + status + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
  );
  socket.destroy();
}

export class WorkerLobbyService {
  private readonly lobbiesWss: WebSocketServer;
  private readonly spectatorWss: WebSocketServer;
  private readonly lobbyClients: Set<WebSocket> = new Set();
  private readonly ingressGuard = new WebSocketIngressGuard();
  private lastMasterMessageAt = Date.now();

  constructor(
    private readonly server: http.Server,
    private readonly gameWss: WebSocketServer,
    private readonly gm: GameManager,
    private readonly log: typeof logger,
  ) {
    this.lobbiesWss = new WebSocketServer({
      noServer: true,
      maxPayload: LOBBY_WS_MAX_PAYLOAD_BYTES,
    });
    this.spectatorWss = new WebSocketServer({
      noServer: true,
      maxPayload: SPECTATOR_WS_MAX_PAYLOAD_BYTES,
    });
    this.setupUpgradeHandler();
    this.setupLobbiesWebSocket();
    this.setupSpectatorWebSocket();
    this.setupIPCListener();
  }

  private setupIPCListener() {
    process.on("message", (raw: unknown) => {
      const result = MasterMessageSchema.safeParse(raw);
      if (!result.success) {
        this.log.error("Invalid IPC message from master:", raw);
        return;
      }

      this.lastMasterMessageAt = Date.now();
      const msg = result.data;
      switch (msg.type) {
        case "lobbiesBroadcast":
          // Forward message to all clients
          this.broadcastLobbiesToClients(msg.publicGames);
          // Update master with my lobby info
          this.sendMyLobbiesToMaster();
          break;
        case "createGame":
          if (this.gm.game(msg.gameID) !== null) {
            this.log.warn(`Game ${msg.gameID} already exists, skipping create`);
            return;
          }
          this.log.info(`Creating public game ${msg.gameID} from master`);
          this.gm.createGame(
            msg.gameID,
            msg.gameConfig,
            undefined,
            undefined,
            msg.publicGameType,
          );
          break;
        case "updateLobby": {
          const game = this.gm.game(msg.gameID);
          if (!game) {
            this.log.warn("cannot update game, not found", {
              gameID: msg.gameID,
            });
            return;
          }
          game.setStartsAt(msg.startsAt);
          break;
        }
      }
    });
  }

  ipcHealthSnapshot(now = Date.now(), maxAgeMs = 2_000): IpcHealthSnapshot {
    return buildIpcHealthSnapshot(
      this.lastMasterMessageAt,
      process.connected !== false,
      now,
      maxAgeMs,
    );
  }

  sendReady(workerId: number) {
    const msg: WorkerReady = { type: "workerReady", workerId };
    process.send?.(msg);
  }

  sendHealthHeartbeat(
    workerId: number,
    evidence: Omit<WorkerHealthHeartbeat, "type" | "workerId">,
  ): void {
    process.send?.({ type: "workerHealth", workerId, ...evidence });
  }

  private sendMyLobbiesToMaster() {
    const lobbies = this.gm
      .publicLobbies()
      .map((g) => g.gameInfo())
      .map((gi) => {
        return {
          gameID: gi.gameID,
          numClients: gi.clients?.length ?? 0,
          startsAt: gi.startsAt,
          gameConfig: gi.gameConfig,
          publicGameType: gi.publicGameType!,
        } satisfies PublicGameInfo;
      });
    process.send?.({ type: "lobbyList", lobbies } satisfies WorkerLobbyList);
  }

  private setupUpgradeHandler() {
    this.server.on("upgrade", (request, socket, head) => {
      const reservation = this.ingressGuard.reserve(
        websocketIngressIp(request),
      );
      if (!reservation.allowed) {
        rejectUpgrade(socket, reservation.reason);
        return;
      }
      socket.once("close", reservation.release);

      const pathname = request.url ?? "";
      try {
        if (pathname === "/lobbies" || pathname.endsWith("/lobbies")) {
          this.lobbiesWss.handleUpgrade(request, socket, head, (ws) => {
            this.lobbiesWss.emit("connection", ws, request);
          });
        } else if (
          pathname.startsWith("/spectate/") ||
          pathname.includes("/spectate/")
        ) {
          this.spectatorWss.handleUpgrade(request, socket, head, (ws) => {
            this.spectatorWss.emit("connection", ws, request);
          });
        } else {
          this.gameWss.handleUpgrade(request, socket, head, (ws) => {
            this.gameWss.emit("connection", ws, request);
          });
        }
      } catch (error) {
        reservation.release();
        socket.destroy(error instanceof Error ? error : undefined);
      }
    });
  }

  private setupSpectatorWebSocket() {
    this.spectatorWss.on("connection", (ws: WebSocket, req) => {
      // Extract gameId from path: /spectate/:gameId or /wN/spectate/:gameId
      const url = req.url ?? "";
      const match = url.match(/\/spectate\/([^/?#]+)/);
      if (!match) {
        ws.close(1002, "Invalid spectate path");
        return;
      }
      const gameId = decodeURIComponent(match[1]);
      const game = this.gm.game(gameId);
      if (!game) {
        ws.close(1008, "Game not found");
        return;
      }
      this.log.info(`Spectator joined game ${gameId}`);
      if (!spectatorBus.join(gameId, ws)) {
        ws.close(1013, "Spectator capacity reached");
      }
    });
  }

  private setupLobbiesWebSocket() {
    this.lobbiesWss.on("connection", (ws: WebSocket) => {
      this.lobbyClients.add(ws);
      ws.on("close", () => {
        this.lobbyClients.delete(ws);
      });

      ws.on("error", (error) => {
        this.log.error(`Lobbies WebSocket error:`, error);
        this.lobbyClients.delete(ws);
        try {
          if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
          ) {
            ws.close(1011, "WebSocket internal error");
          }
        } catch (closeError) {
          this.log.error("Error closing lobbies WebSocket:", closeError);
        }
      });
    });
  }

  private broadcastLobbiesToClients(publicGames: PublicGames) {
    const message = JSON.stringify(publicGames);

    const clientsToRemove: WebSocket[] = [];
    this.lobbyClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        if (client.bufferedAmount > LOBBY_MAX_BUFFERED_BYTES) {
          client.close(1013, "Lobby client is too slow");
          clientsToRemove.push(client);
          return;
        }
        client.send(message, (error) => {
          if (error) {
            this.lobbyClients.delete(client);
            client.close(1011, "Lobby broadcast failed");
          }
        });
      } else {
        clientsToRemove.push(client);
      }
    });

    clientsToRemove.forEach((client) => {
      this.lobbyClients.delete(client);
    });
  }
}
