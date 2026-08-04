import { z } from "zod";
import { EventBus, GameEvent } from "../core/EventBus";
import {
  AllPlayers,
  GameType,
  Gold,
  PlayerID,
  Tick,
  UnitType,
} from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { PlayerView } from "../core/game/GameView";
import { workerSocketUrl } from "../core/RuntimeUrls";
import {
  AllPlayersStats,
  ClientHashMessage,
  ClientIntentMessage,
  ClientJoinMessage,
  ClientMessage,
  ClientPingMessage,
  ClientRejoinMessage,
  ClientSendWinnerMessage,
  GameConfig,
  Intent,
  ServerMessage,
  ServerMessageSchema,
  Winner,
} from "../core/Schemas";
import { replacer } from "../core/Util";
import { getPlayToken } from "./Auth";
import { LobbyConfig } from "./ClientGameRunner";
import { LocalServer } from "./LocalServer";

export class PauseGameIntentEvent implements GameEvent {
  constructor(public readonly paused: boolean) {}
}

export class SendAllianceRequestIntentEvent implements GameEvent {
  constructor(
    public readonly requestor: PlayerView,
    public readonly recipient: PlayerView,
  ) {}
}

export class SendBreakAllianceIntentEvent implements GameEvent {
  constructor(
    public readonly requestor: PlayerView,
    public readonly recipient: PlayerView,
  ) {}
}

export class SendUpgradeStructureIntentEvent implements GameEvent {
  constructor(
    public readonly unitId: number,
    public readonly unitType: UnitType,
  ) {}
}

export class SendAllianceRejectIntentEvent implements GameEvent {
  constructor(public readonly requestor: PlayerView) {}
}

export class SendAllianceExtensionIntentEvent implements GameEvent {
  constructor(public readonly recipient: PlayerView) {}
}

export class SendSpawnIntentEvent implements GameEvent {
  constructor(public readonly tile: TileRef) {}
}

export class SendAttackIntentEvent implements GameEvent {
  constructor(
    public readonly targetID: PlayerID | null,
    public readonly troops: number,
  ) {}
}

export class SendBoatAttackIntentEvent implements GameEvent {
  constructor(
    public readonly dst: TileRef,
    public readonly troops: number,
  ) {}
}

export class BuildUnitIntentEvent implements GameEvent {
  constructor(
    public readonly unit: UnitType,
    public readonly tile: TileRef,
    public readonly rocketDirectionUp?: boolean,
  ) {}
}

export class SendTargetPlayerIntentEvent implements GameEvent {
  constructor(public readonly targetID: PlayerID) {}
}

export class SendEmojiIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView | typeof AllPlayers,
    public readonly emoji: number,
  ) {}
}

export class SendDonateGoldIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly gold: Gold | null,
  ) {}
}

export class SendDonateTroopsIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly troops: number | null,
  ) {}
}

export class SendQuickChatEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly quickChatKey: string,
    public readonly target?: PlayerID,
  ) {}
}

export class SendEmbargoIntentEvent implements GameEvent {
  constructor(
    public readonly target: PlayerView,
    public readonly action: "start" | "stop",
  ) {}
}

export class SendEmbargoAllIntentEvent implements GameEvent {
  constructor(public readonly action: "start" | "stop") {}
}

export class SendDeleteUnitIntentEvent implements GameEvent {
  constructor(public readonly unitId: number) {}
}

export class CancelAttackIntentEvent implements GameEvent {
  constructor(public readonly attackID: string) {}
}

export class CancelBoatIntentEvent implements GameEvent {
  constructor(public readonly unitID: number) {}
}

export class SendWinnerEvent implements GameEvent {
  constructor(
    public readonly winner: Winner,
    public readonly allPlayersStats: AllPlayersStats,
  ) {}
}
export class SendHashEvent implements GameEvent {
  constructor(
    public readonly tick: Tick,
    public readonly hash: number,
  ) {}
}

export class MoveWarshipIntentEvent implements GameEvent {
  constructor(
    public readonly unitId: number,
    public readonly tile: number,
  ) {}
}

export class SendKickPlayerIntentEvent implements GameEvent {
  constructor(public readonly target: string) {}
}

export class SendUpdateGameConfigIntentEvent implements GameEvent {
  constructor(public readonly config: Partial<GameConfig>) {}
}

export class SendResourceFocusIntentEvent implements GameEvent {
  constructor(public readonly focus: number) {}
}

export class SendVaultConvoyCommandIntentEvent implements GameEvent {
  constructor(
    public readonly command:
      | "reroute_city"
      | "reroute_port"
      | "reroute_factory"
      | "reroute_silo"
      | "reroute_safest"
      | "escort"
      | "sell_intel"
      | "vault_heist",
  ) {}
}

export class SendDefenseFactoryCommandIntentEvent implements GameEvent {
  constructor(public readonly command: "jam_breaker") {}
}

export class SendVaultRolePingIntentEvent implements GameEvent {
  constructor(
    public readonly ping: "escort_convoy" | "intercept_lane" | "pulse_soon",
  ) {}
}

export type TransportConnectionState =
  "idle" | "connecting" | "synchronizing" | "open" | "waiting" | "closed";

export class TransportConnectionStateEvent implements GameEvent {
  constructor(
    public readonly state: TransportConnectionState,
    public readonly reconnectAttempt: number,
    public readonly outboxDepth: number,
    public readonly retryInMs: number | null = null,
    public readonly reason: string | null = null,
  ) {}
}

export class TransportOutboxOverflowEvent implements GameEvent {
  constructor(
    public readonly capacity: number,
    public readonly outboxDepth: number,
    public readonly rejectedMessageType: ClientMessage["type"],
  ) {}
}

export interface TransportRecoveryOptions {
  maxOutboxMessages?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  createWebSocket?: (url: string) => WebSocket;
  scheduleTimeout?: (callback: () => void, delayMs: number) => number;
  cancelTimeout?: (timer: number) => void;
  jitterDelay?: (delayMs: number, reconnectAttempt: number) => number;
}

interface OutboxEntry {
  payload: string;
  messageType: ClientMessage["type"];
}

export class Transport {
  private socket: WebSocket | null = null;

  private localServer: LocalServer;

  private readonly outbox: OutboxEntry[] = [];

  private onconnect: () => void | Promise<void>;
  private onmessage: (msg: ServerMessage) => void;

  private connectionState: TransportConnectionState = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private connectionGeneration = 0;
  private intentionalShutdown = false;

  private readonly maxOutboxMessages: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly createWebSocket: (url: string) => WebSocket;
  private readonly scheduleTimeout: (
    callback: () => void,
    delayMs: number,
  ) => number;
  private readonly cancelTimeout: (timer: number) => void;
  private readonly jitterDelay: (
    delayMs: number,
    reconnectAttempt: number,
  ) => number;

  private pingInterval: number | null = null;
  public readonly isLocal: boolean;

  constructor(
    private lobbyConfig: LobbyConfig,
    private eventBus: EventBus,
    recovery: TransportRecoveryOptions = {},
  ) {
    this.maxOutboxMessages = recovery.maxOutboxMessages ?? 256;
    this.reconnectBaseDelayMs = recovery.reconnectBaseDelayMs ?? 250;
    this.reconnectMaxDelayMs = recovery.reconnectMaxDelayMs ?? 8000;
    this.createWebSocket =
      recovery.createWebSocket ?? ((url) => new WebSocket(url));
    this.scheduleTimeout =
      recovery.scheduleTimeout ??
      ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.cancelTimeout =
      recovery.cancelTimeout ?? ((timer) => window.clearTimeout(timer));
    this.jitterDelay =
      recovery.jitterDelay ??
      ((delayMs) => Math.round(delayMs * (0.8 + Math.random() * 0.4)));
    // If gameRecord is not null, we are replaying an archived game.
    // For multiplayer games, GameConfig is not known until game starts.
    this.isLocal =
      lobbyConfig.gameRecord !== undefined ||
      lobbyConfig.gameStartInfo?.config.gameType === GameType.Singleplayer;

    this.eventBus.on(SendAllianceRequestIntentEvent, (e) =>
      this.onSendAllianceRequest(e),
    );
    this.eventBus.on(SendAllianceRejectIntentEvent, (e) =>
      this.onAllianceRejectUIEvent(e),
    );
    this.eventBus.on(SendAllianceExtensionIntentEvent, (e) =>
      this.onSendAllianceExtensionIntent(e),
    );
    this.eventBus.on(SendBreakAllianceIntentEvent, (e) =>
      this.onBreakAllianceRequestUIEvent(e),
    );
    this.eventBus.on(SendSpawnIntentEvent, (e) =>
      this.onSendSpawnIntentEvent(e),
    );
    this.eventBus.on(SendAttackIntentEvent, (e) => this.onSendAttackIntent(e));
    this.eventBus.on(SendUpgradeStructureIntentEvent, (e) =>
      this.onSendUpgradeStructureIntent(e),
    );
    this.eventBus.on(SendBoatAttackIntentEvent, (e) =>
      this.onSendBoatAttackIntent(e),
    );
    this.eventBus.on(SendTargetPlayerIntentEvent, (e) =>
      this.onSendTargetPlayerIntent(e),
    );
    this.eventBus.on(SendEmojiIntentEvent, (e) => this.onSendEmojiIntent(e));
    this.eventBus.on(SendDonateGoldIntentEvent, (e) =>
      this.onSendDonateGoldIntent(e),
    );
    this.eventBus.on(SendDonateTroopsIntentEvent, (e) =>
      this.onSendDonateTroopIntent(e),
    );
    this.eventBus.on(SendQuickChatEvent, (e) => this.onSendQuickChatIntent(e));
    this.eventBus.on(SendEmbargoIntentEvent, (e) =>
      this.onSendEmbargoIntent(e),
    );
    this.eventBus.on(SendEmbargoAllIntentEvent, (e) =>
      this.onSendEmbargoAllIntent(e),
    );
    this.eventBus.on(BuildUnitIntentEvent, (e) => this.onBuildUnitIntent(e));

    this.eventBus.on(PauseGameIntentEvent, (e) => this.onPauseGameIntent(e));
    this.eventBus.on(SendWinnerEvent, (e) => this.onSendWinnerEvent(e));
    this.eventBus.on(SendHashEvent, (e) => this.onSendHashEvent(e));
    this.eventBus.on(CancelAttackIntentEvent, (e) =>
      this.onCancelAttackIntentEvent(e),
    );
    this.eventBus.on(CancelBoatIntentEvent, (e) =>
      this.onCancelBoatIntentEvent(e),
    );

    this.eventBus.on(MoveWarshipIntentEvent, (e) => {
      this.onMoveWarshipEvent(e);
    });

    this.eventBus.on(SendDeleteUnitIntentEvent, (e) =>
      this.onSendDeleteUnitIntent(e),
    );

    this.eventBus.on(SendKickPlayerIntentEvent, (e) =>
      this.onSendKickPlayerIntent(e),
    );

    this.eventBus.on(SendUpdateGameConfigIntentEvent, (e) =>
      this.onSendUpdateGameConfigIntent(e),
    );

    this.eventBus.on(SendResourceFocusIntentEvent, (e) =>
      this.onSendResourceFocusIntent(e),
    );
    this.eventBus.on(SendVaultConvoyCommandIntentEvent, (e) =>
      this.onSendVaultConvoyCommandIntent(e),
    );
    this.eventBus.on(SendDefenseFactoryCommandIntentEvent, (e) =>
      this.onSendDefenseFactoryCommandIntent(e),
    );
    this.eventBus.on(SendVaultRolePingIntentEvent, (e) =>
      this.onSendVaultRolePingIntent(e),
    );
  }

  private startPing() {
    if (this.isLocal) return;
    this.pingInterval ??= window.setInterval(() => {
      if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
        this.sendMsg(
          {
            type: "ping",
          } satisfies ClientPingMessage,
          {
            allowDuringSynchronization: true,
            buffer: false,
          },
        );
      }
    }, 5 * 1000);
  }

  private stopPing() {
    if (this.pingInterval) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public connect(
    onconnect: () => void | Promise<void>,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.isLocal) {
      this.connectLocal(onconnect, onmessage);
    } else {
      this.connectRemote(onconnect, onmessage);
    }
  }

  public updateCallback(
    onconnect: () => void | Promise<void>,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.isLocal) {
      this.localServer.updateCallback(onconnect, onmessage);
    } else {
      this.onconnect = onconnect;
      this.onmessage = onmessage;
    }
  }

  private connectLocal(
    onconnect: () => void | Promise<void>,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.localServer = new LocalServer(
      this.lobbyConfig,
      this.lobbyConfig.gameRecord !== undefined,
      this.eventBus,
    );
    this.localServer.updateCallback(onconnect, onmessage);
    this.localServer.start();
  }

  private connectRemote(
    onconnect: () => void | Promise<void>,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.intentionalShutdown = false;
    this.clearReconnectTimer();
    this.startPing();
    this.killExistingSocket();
    const workerPath = this.lobbyConfig.serverConfig.workerPath(
      this.lobbyConfig.gameID,
    );
    const generation = ++this.connectionGeneration;
    const socket = this.createWebSocket(workerSocketUrl(workerPath));
    this.socket = socket;
    this.onconnect = onconnect;
    this.onmessage = onmessage;
    this.publishConnectionState("connecting");
    socket.onopen = async () => {
      if (!this.isCurrentSocket(socket, generation)) return;
      console.log("Connected to game server!");
      this.publishConnectionState("synchronizing");
      try {
        await onconnect();
      } catch (error) {
        console.error("Transport synchronization failed:", error);
        if (this.isCurrentSocket(socket, generation)) {
          this.scheduleReconnect("synchronization-failed");
          socket.close();
        }
        return;
      }
      if (!this.isCurrentSocket(socket, generation)) return;
      this.reconnectAttempt = 0;
      this.publishConnectionState("open");
      this.flushOutbox(socket);
    };
    socket.onmessage = (event: MessageEvent) => {
      if (!this.isCurrentSocket(socket, generation)) return;
      try {
        const parsed = JSON.parse(event.data);
        const result = ServerMessageSchema.safeParse(parsed);
        if (!result.success) {
          const error = z.prettifyError(result.error);
          console.error("Error parsing server message", error);
          return;
        }
        this.onmessage(result.data);
      } catch (e) {
        console.error("Error in onmessage handler:", e, event.data);
        return;
      }
    };
    socket.onerror = (err) => {
      if (!this.isCurrentSocket(socket, generation)) return;
      console.error("Socket encountered error: ", err, "Closing socket");
      this.scheduleReconnect("socket-error");
      socket.close();
    };
    socket.onclose = (event: CloseEvent) => {
      if (!this.isCurrentSocket(socket, generation)) return;
      this.socket = null;
      console.log(
        `WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`,
      );
      if (this.intentionalShutdown) {
        this.publishConnectionState("closed", null, "intentional-shutdown");
        return;
      }
      if (event.code === 1002) {
        this.clearReconnectTimer();
        this.publishConnectionState("closed", null, event.reason);
        // TODO: make this a modal
        alert(`connection refused: ${event.reason}`);
      } else if (event.code !== 1000) {
        console.log(`received error code ${event.code}, scheduling reconnect`);
        this.scheduleReconnect(`socket-close-${event.code}`);
      } else if (this.reconnectTimer === null) {
        this.publishConnectionState("closed", null, event.reason || null);
      }
    };
  }

  public reconnect() {
    if (this.isLocal || this.intentionalShutdown) return;
    this.clearReconnectTimer();
    this.connectRemote(this.onconnect, this.onmessage);
  }

  public connectionSnapshot() {
    return {
      state: this.connectionState,
      reconnectAttempt: this.reconnectAttempt,
      outboxDepth: this.outbox.length,
    } as const;
  }

  public turnComplete() {
    if (this.isLocal) {
      this.localServer.turnComplete();
    }
  }

  async joinGame() {
    const accepted = this.sendMsg(
      {
        type: "join",
        gameID: this.lobbyConfig.gameID,
        // Note: clientID is not sent - server assigns it based on persistentID
        username: this.lobbyConfig.playerName,
        cosmetics: this.lobbyConfig.cosmetics,
        turnstileToken: this.lobbyConfig.turnstileToken,
        token: await getPlayToken(),
      } satisfies ClientJoinMessage,
      { allowDuringSynchronization: true, buffer: false },
    );
    if (!accepted)
      throw new Error("join message was not accepted by transport");
  }

  async rejoinGame(lastTurn: number) {
    const accepted = this.sendMsg(
      {
        type: "rejoin",
        gameID: this.lobbyConfig.gameID,
        // Note: clientID is not sent - server looks it up from persistentID in token
        lastTurn: lastTurn,
        token: await getPlayToken(),
      } satisfies ClientRejoinMessage,
      { allowDuringSynchronization: true, buffer: false },
    );
    if (!accepted) {
      throw new Error("rejoin message was not accepted by transport");
    }
  }

  leaveGame() {
    if (this.isLocal) {
      this.localServer.endGame();
      return;
    }
    this.intentionalShutdown = true;
    this.connectionGeneration += 1;
    this.clearReconnectTimer();
    this.stopPing();
    this.outbox.length = 0;
    this.killExistingSocket();
    this.publishConnectionState("closed", null, "intentional-shutdown");
  }

  private onSendAllianceRequest(event: SendAllianceRequestIntentEvent) {
    this.sendIntent({
      type: "allianceRequest",
      recipient: event.recipient.id(),
    });
  }

  private onAllianceRejectUIEvent(event: SendAllianceRejectIntentEvent) {
    this.sendIntent({
      type: "allianceReject",
      requestor: event.requestor.id(),
    });
  }

  private onBreakAllianceRequestUIEvent(event: SendBreakAllianceIntentEvent) {
    this.sendIntent({
      type: "breakAlliance",
      recipient: event.recipient.id(),
    });
  }

  private onSendAllianceExtensionIntent(
    event: SendAllianceExtensionIntentEvent,
  ) {
    this.sendIntent({
      type: "allianceExtension",
      recipient: event.recipient.id(),
    });
  }

  private onSendSpawnIntentEvent(event: SendSpawnIntentEvent) {
    this.sendIntent({
      type: "spawn",
      tile: event.tile,
    });
  }

  private onSendAttackIntent(event: SendAttackIntentEvent) {
    this.sendIntent({
      type: "attack",
      targetID: event.targetID,
      troops: event.troops,
    });
  }

  private onSendBoatAttackIntent(event: SendBoatAttackIntentEvent) {
    this.sendIntent({
      type: "boat",
      troops: event.troops,
      dst: event.dst,
    });
  }

  private onSendUpgradeStructureIntent(event: SendUpgradeStructureIntentEvent) {
    this.sendIntent({
      type: "upgrade_structure",
      unit: event.unitType,
      unitId: event.unitId,
    });
  }

  private onSendTargetPlayerIntent(event: SendTargetPlayerIntentEvent) {
    this.sendIntent({
      type: "targetPlayer",
      target: event.targetID,
    });
  }

  private onSendEmojiIntent(event: SendEmojiIntentEvent) {
    this.sendIntent({
      type: "emoji",
      recipient:
        event.recipient === AllPlayers ? AllPlayers : event.recipient.id(),
      emoji: event.emoji,
    });
  }

  private onSendDonateGoldIntent(event: SendDonateGoldIntentEvent) {
    this.sendIntent({
      type: "donate_gold",
      recipient: event.recipient.id(),
      gold: event.gold ? Number(event.gold) : null,
    });
  }

  private onSendDonateTroopIntent(event: SendDonateTroopsIntentEvent) {
    this.sendIntent({
      type: "donate_troops",
      recipient: event.recipient.id(),
      troops: event.troops,
    });
  }

  private onSendQuickChatIntent(event: SendQuickChatEvent) {
    this.sendIntent({
      type: "quick_chat",
      recipient: event.recipient.id(),
      quickChatKey: event.quickChatKey,
      target: event.target,
    });
  }

  private onSendEmbargoIntent(event: SendEmbargoIntentEvent) {
    this.sendIntent({
      type: "embargo",
      targetID: event.target.id(),
      action: event.action,
    });
  }

  private onSendEmbargoAllIntent(event: SendEmbargoAllIntentEvent) {
    this.sendIntent({
      type: "embargo_all",
      action: event.action,
    });
  }

  private onBuildUnitIntent(event: BuildUnitIntentEvent) {
    this.sendIntent({
      type: "build_unit",
      unit: event.unit,
      tile: event.tile,
      rocketDirectionUp: event.rocketDirectionUp,
    });
  }

  private onPauseGameIntent(event: PauseGameIntentEvent) {
    this.sendIntent({
      type: "toggle_pause",
      paused: event.paused,
    });
  }

  private onSendWinnerEvent(event: SendWinnerEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "winner",
        winner: event.winner,
        allPlayersStats: event.allPlayersStats,
      } satisfies ClientSendWinnerMessage);
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket?.readyState,
      );
      console.log("attempting reconnect");
    }
  }

  private onSendHashEvent(event: SendHashEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "hash",
        turnNumber: event.tick,
        hash: event.hash,
      } satisfies ClientHashMessage);
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket?.readyState,
      );
      console.log("attempting reconnect");
    }
  }

  private onCancelAttackIntentEvent(event: CancelAttackIntentEvent) {
    this.sendIntent({
      type: "cancel_attack",
      attackID: event.attackID,
    });
  }

  private onCancelBoatIntentEvent(event: CancelBoatIntentEvent) {
    this.sendIntent({
      type: "cancel_boat",
      unitID: event.unitID,
    });
  }

  private onMoveWarshipEvent(event: MoveWarshipIntentEvent) {
    this.sendIntent({
      type: "move_warship",
      unitId: event.unitId,
      tile: event.tile,
    });
  }

  private onSendDeleteUnitIntent(event: SendDeleteUnitIntentEvent) {
    this.sendIntent({
      type: "delete_unit",
      unitId: event.unitId,
    });
  }

  private onSendKickPlayerIntent(event: SendKickPlayerIntentEvent) {
    this.sendIntent({
      type: "kick_player",
      target: event.target,
    });
  }

  private onSendUpdateGameConfigIntent(event: SendUpdateGameConfigIntentEvent) {
    this.sendIntent({
      type: "update_game_config",
      config: event.config,
    });
  }

  private onSendResourceFocusIntent(event: SendResourceFocusIntentEvent) {
    this.sendIntent({
      type: "set_resource_focus",
      focus: event.focus,
    });
  }

  private onSendVaultConvoyCommandIntent(
    event: SendVaultConvoyCommandIntentEvent,
  ) {
    this.sendIntent({
      type: "vault_convoy_command",
      command: event.command,
    });
  }

  private onSendDefenseFactoryCommandIntent(
    event: SendDefenseFactoryCommandIntentEvent,
  ) {
    this.sendIntent({
      type: "defense_factory_command",
      command: event.command,
    });
  }

  private onSendVaultRolePingIntent(event: SendVaultRolePingIntentEvent) {
    this.sendIntent({
      type: "vault_role_ping",
      ping: event.ping,
    });
  }

  private sendIntent(intent: Intent) {
    this.sendMsg({
      type: "intent",
      intent: intent,
    } satisfies ClientIntentMessage);
  }

  private sendMsg(
    msg: ClientMessage,
    options: { allowDuringSynchronization?: boolean; buffer?: boolean } = {},
  ): boolean {
    if (this.isLocal) {
      // Forward message to local server
      this.localServer.onMessage(msg);
      return true;
    }
    const str = JSON.stringify(msg, replacer);
    const canSend =
      this.socket?.readyState === WebSocket.OPEN &&
      (this.connectionState !== "synchronizing" ||
        options.allowDuringSynchronization === true);
    let sendFailed = false;
    if (canSend) {
      try {
        this.socket?.send(str);
        return true;
      } catch (error) {
        console.warn(
          "Socket send failed; retaining message for recovery:",
          error,
        );
        sendFailed = true;
      }
    }
    if (options.buffer === false || this.intentionalShutdown) {
      if (sendFailed) {
        this.scheduleReconnect("control-message-send-failed");
        this.socket?.close();
      }
      return false;
    }
    const accepted = this.enqueueMessage(str, msg.type);
    if (
      sendFailed ||
      this.socket === null ||
      this.socket.readyState === WebSocket.CLOSED ||
      this.socket.readyState === WebSocket.CLOSING
    ) {
      this.scheduleReconnect("outbox-awaiting-connection");
      if (sendFailed) this.socket?.close();
    }
    return accepted;
  }

  private enqueueMessage(
    payload: string,
    messageType: ClientMessage["type"],
  ): boolean {
    if (this.outbox.length >= this.maxOutboxMessages) {
      this.eventBus.emit(
        new TransportOutboxOverflowEvent(
          this.maxOutboxMessages,
          this.outbox.length,
          messageType,
        ),
      );
      return false;
    }
    this.outbox.push({ payload, messageType });
    this.publishConnectionState(this.connectionState);
    return true;
  }

  private flushOutbox(socket: WebSocket): void {
    while (
      this.socket === socket &&
      socket.readyState === WebSocket.OPEN &&
      this.outbox.length > 0
    ) {
      const next = this.outbox[0];
      try {
        socket.send(next.payload);
        this.outbox.shift();
      } catch (error) {
        console.warn("Outbox flush paused after send failure:", error);
        this.scheduleReconnect("outbox-flush-failed");
        socket.close();
        break;
      }
    }
    this.publishConnectionState(this.connectionState);
  }

  private scheduleReconnect(reason: string): void {
    if (
      this.isLocal ||
      this.intentionalShutdown ||
      this.reconnectTimer !== null
    ) {
      return;
    }
    const attempt = this.reconnectAttempt + 1;
    const exponentialDelay = Math.min(
      this.reconnectBaseDelayMs * 2 ** (attempt - 1),
      this.reconnectMaxDelayMs,
    );
    const delay = Math.max(
      0,
      Math.round(this.jitterDelay(exponentialDelay, attempt)),
    );
    const generation = this.connectionGeneration;
    this.reconnectAttempt = attempt;
    this.publishConnectionState("waiting", delay, reason);
    this.reconnectTimer = this.scheduleTimeout(() => {
      this.reconnectTimer = null;
      if (
        this.intentionalShutdown ||
        generation !== this.connectionGeneration
      ) {
        return;
      }
      this.connectRemote(this.onconnect, this.onmessage);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    this.cancelTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private isCurrentSocket(socket: WebSocket, generation: number): boolean {
    return this.socket === socket && this.connectionGeneration === generation;
  }

  private publishConnectionState(
    state: TransportConnectionState,
    retryInMs: number | null = null,
    reason: string | null = null,
  ): void {
    this.connectionState = state;
    this.eventBus.emit(
      new TransportConnectionStateEvent(
        state,
        this.reconnectAttempt,
        this.outbox.length,
        retryInMs,
        reason,
      ),
    );
  }

  private killExistingSocket(): void {
    if (this.socket === null) {
      return;
    }
    // Remove all event listeners
    this.socket.onmessage = null;
    this.socket.onopen = null;
    this.socket.onclose = null;
    this.socket.onerror = null;

    // Close the connection if it's still open or still connecting
    try {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
    } catch (e) {
      console.warn("Error while closing WebSocket:", e);
    }

    this.socket = null;
  }
}
