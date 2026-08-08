import { EventEmitter } from "node:events";
import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { WebSocketServer } from "ws";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import type { GameManager } from "../../src/server/GameManager";
import { logger } from "../../src/server/Logger";
import { spectatorBus } from "../../src/server/SpectatorBus";
import {
  WebSocketIngressGuard,
  WorkerLobbyService,
  websocketIngressIp,
} from "../../src/server/WorkerLobbyService";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createMockWs(readyState = 1 /* WebSocket.OPEN */) {
  return {
    readyState,
    bufferedAmount: 0,
    on: vi.fn(),
    send: vi.fn((_data: unknown, cb?: (err?: Error) => void) => cb?.()),
    close: vi.fn(),
  };
}

function createUpgradeSocket() {
  return {
    once: vi.fn(),
    write: vi.fn(),
    destroy: vi.fn(),
  };
}

function createUpgradeRequest(url: string, remoteAddress = "203.0.113.5") {
  return {
    url,
    headers: {},
    socket: { remoteAddress },
  } as unknown as http.IncomingMessage;
}

function createService(publicLobbies: () => unknown[] = () => []) {
  const server = new EventEmitter() as unknown as http.Server;
  const gameWss = Object.assign(new EventEmitter(), {
    handleUpgrade: vi.fn(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(createMockWs()),
    ),
  });
  const gameManager = {
    game: vi.fn((_id: string): unknown => null),
    createGame: vi.fn(),
    publicLobbies: vi.fn(publicLobbies),
  };

  let messageHandler: (raw: unknown) => void = () => {};
  const onSpy = vi.spyOn(process, "on").mockImplementation(((
    event: string,
    handler: (...args: unknown[]) => void,
  ) => {
    if (event === "message") {
      messageHandler = handler as (raw: unknown) => void;
    }
    return process;
  }) as typeof process.on);

  const service = new WorkerLobbyService(
    server,
    gameWss as unknown as WebSocketServer,
    gameManager as unknown as GameManager,
    logger,
  );
  onSpy.mockRestore();

  return { service, server, gameWss, gameManager, messageHandler };
}

describe("WorkerLobbyService IPC health", () => {
  it("returns a fresh connected IPC health snapshot", () => {
    const service = Object.create(
      WorkerLobbyService.prototype,
    ) as WorkerLobbyService;
    Object.defineProperty(service, "lastMasterMessageAt", {
      configurable: true,
      value: 9_950,
      writable: true,
    });
    const connectedDescriptor = Object.getOwnPropertyDescriptor(
      process,
      "connected",
    );

    try {
      Object.defineProperty(process, "connected", {
        configurable: true,
        value: true,
        writable: true,
      });

      expect(service.ipcHealthSnapshot(10_000, 100)).toEqual({
        scope: "process-local-worker",
        connected: true,
        healthy: true,
        lastMasterMessageAt: 9_950,
        ageMs: 50,
        maxAgeMs: 100,
      });
    } finally {
      if (connectedDescriptor) {
        Object.defineProperty(process, "connected", connectedDescriptor);
      } else {
        Reflect.deleteProperty(process, "connected");
      }
    }
  });

  it("emits exact ready and health heartbeat messages", () => {
    const service = Object.create(
      WorkerLobbyService.prototype,
    ) as WorkerLobbyService;
    const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
    const send = vi.fn();

    try {
      Object.defineProperty(process, "send", {
        configurable: true,
        value: send,
        writable: true,
      });

      service.sendReady(7);
      service.sendHealthHeartbeat(7, {
        observedAt: 12_345,
        healthy: false,
        reasons: ["ipc-stale"],
      });

      expect(send).toHaveBeenNthCalledWith(1, {
        type: "workerReady",
        workerId: 7,
      });
      expect(send).toHaveBeenNthCalledWith(2, {
        type: "workerHealth",
        workerId: 7,
        observedAt: 12_345,
        healthy: false,
        reasons: ["ipc-stale"],
      });
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      if (sendDescriptor) {
        Object.defineProperty(process, "send", sendDescriptor);
      } else {
        Reflect.deleteProperty(process, "send");
      }
    }
  });
});

describe("WebSocketIngressGuard", () => {
  it("enforces a fixed-window upgrade rate", () => {
    const guard = new WebSocketIngressGuard(2, 10, 1_000);
    const first = guard.reserve("203.0.113.10", 100);
    const second = guard.reserve("203.0.113.10", 200);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    if (first.allowed) first.release();
    if (second.allowed) second.release();

    expect(guard.reserve("203.0.113.10", 300)).toEqual({
      allowed: false,
      reason: "rate-limit",
    });
    expect(guard.reserve("203.0.113.10", 1_100).allowed).toBe(true);
  });

  it("caps active connections and releases reservations idempotently", () => {
    const guard = new WebSocketIngressGuard(10, 1, 1_000);
    const reservation = guard.reserve("203.0.113.11", 100);
    expect(reservation.allowed).toBe(true);
    expect(guard.activeForIp("203.0.113.11")).toBe(1);
    expect(guard.reserve("203.0.113.11", 200)).toEqual({
      allowed: false,
      reason: "connection-limit",
    });

    if (reservation.allowed) {
      reservation.release();
      reservation.release();
    }
    expect(guard.activeForIp("203.0.113.11")).toBe(0);
    expect(guard.reserve("203.0.113.11", 300).allowed).toBe(true);
  });
});

describe("websocketIngressIp", () => {
  function request(
    remoteAddress: string,
    headers: http.IncomingHttpHeaders,
  ): http.IncomingMessage {
    return {
      headers,
      socket: { remoteAddress },
    } as unknown as http.IncomingMessage;
  }

  it("ignores spoofable proxy headers from non-loopback peers", () => {
    expect(
      websocketIngressIp(
        request("198.51.100.22", {
          "x-forwarded-for": "203.0.113.99",
          "x-real-ip": "203.0.113.98",
        }),
      ),
    ).toBe("198.51.100.22");
  });

  it("accepts only valid proxy IPs from the local reverse proxy", () => {
    expect(
      websocketIngressIp(
        request("127.0.0.1", {
          "x-forwarded-for": "203.0.113.44, 127.0.0.1",
          "x-real-ip": "not-an-ip",
        }),
      ),
    ).toBe("203.0.113.44");
  });
});

describe("WorkerLobbyService upgrade routing", () => {
  it("routes /lobbies upgrades to the lobbies websocket server and wires client lifecycle handlers", () => {
    const { service, server } = createService();
    const ws = createMockWs();
    vi.spyOn((service as any).lobbiesWss, "handleUpgrade").mockImplementation(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(ws),
    );

    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies"),
      createUpgradeSocket(),
      Buffer.alloc(0),
    );

    expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(ws.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("stops broadcasting lobby updates to a client after it disconnects", () => {
    const { service, server, messageHandler } = createService();
    const ws = createMockWs();
    vi.spyOn((service as any).lobbiesWss, "handleUpgrade").mockImplementation(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(ws),
    );

    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies"),
      createUpgradeSocket(),
      Buffer.alloc(0),
    );

    const closeHandler = ws.on.mock.calls.find(
      ([event]) => event === "close",
    )?.[1] as () => void;
    closeHandler();

    messageHandler({
      type: "lobbiesBroadcast",
      publicGames: {
        serverTime: 1,
        games: { ffa: [], team: [], special: [] },
      },
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("closes the lobby socket and removes it from tracked clients on error", () => {
    const { service, server } = createService();
    const ws = createMockWs(1 /* WebSocket.OPEN */);
    vi.spyOn((service as any).lobbiesWss, "handleUpgrade").mockImplementation(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(ws),
    );

    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies"),
      createUpgradeSocket(),
      Buffer.alloc(0),
    );

    const errorHandler = ws.on.mock.calls.find(
      ([event]) => event === "error",
    )?.[1] as (err: Error) => void;
    errorHandler(new Error("boom"));

    expect(ws.close).toHaveBeenCalledWith(1011, "WebSocket internal error");
    expect(logger.error).toHaveBeenCalledWith(
      "Lobbies WebSocket error:",
      expect.any(Error),
    );
  });

  it("does not attempt to close an already-closed lobby socket on error", () => {
    const { service, server } = createService();
    const ws = createMockWs(3 /* WebSocket.CLOSED */);
    vi.spyOn((service as any).lobbiesWss, "handleUpgrade").mockImplementation(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(ws),
    );

    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies"),
      createUpgradeSocket(),
      Buffer.alloc(0),
    );

    const errorHandler = ws.on.mock.calls.find(
      ([event]) => event === "error",
    )?.[1] as (err: Error) => void;
    errorHandler(new Error("boom"));

    expect(ws.close).not.toHaveBeenCalled();
  });

  it("routes non-lobby, non-spectate upgrades to the primary game websocket server", () => {
    const { server, gameWss } = createService();
    const request = createUpgradeRequest("/some/game/path");
    const emitSpy = vi.spyOn(gameWss, "emit");

    server.emit("upgrade", request, createUpgradeSocket(), Buffer.alloc(0));

    expect(gameWss.handleUpgrade).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(
      "connection",
      expect.anything(),
      request,
    );
  });
});

describe("WorkerLobbyService spectator upgrade routing", () => {
  it("closes the socket for an unparsable spectate path", () => {
    const { service, server, gameManager } = createService();
    const ws = createMockWs();
    vi.spyOn((service as any).spectatorWss, "handleUpgrade").mockImplementation(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(ws),
    );

    server.emit(
      "upgrade",
      createUpgradeRequest("/spectate/"),
      createUpgradeSocket(),
      Buffer.alloc(0),
    );

    expect(ws.close).toHaveBeenCalledWith(1002, "Invalid spectate path");
    expect(gameManager.game).not.toHaveBeenCalled();
  });

  it("closes the socket when the game does not exist", () => {
    const { service, server, gameManager } = createService();
    gameManager.game.mockReturnValueOnce(null);
    const ws = createMockWs();
    vi.spyOn((service as any).spectatorWss, "handleUpgrade").mockImplementation(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(ws),
    );

    server.emit(
      "upgrade",
      createUpgradeRequest("/spectate/missing-game"),
      createUpgradeSocket(),
      Buffer.alloc(0),
    );

    expect(gameManager.game).toHaveBeenCalledWith("missing-game");
    expect(ws.close).toHaveBeenCalledWith(1008, "Game not found");
  });

  it("closes the socket when the spectator bus rejects capacity", () => {
    const { service, server, gameManager } = createService();
    gameManager.game.mockReturnValueOnce({} as never);
    const joinSpy = vi.spyOn(spectatorBus, "join").mockReturnValue(false);
    const ws = createMockWs();
    vi.spyOn((service as any).spectatorWss, "handleUpgrade").mockImplementation(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(ws),
    );

    try {
      server.emit(
        "upgrade",
        createUpgradeRequest("/spectate/game-1"),
        createUpgradeSocket(),
        Buffer.alloc(0),
      );

      expect(joinSpy).toHaveBeenCalledWith("game-1", ws);
      expect(ws.close).toHaveBeenCalledWith(1013, "Spectator capacity reached");
    } finally {
      joinSpy.mockRestore();
    }
  });

  it("does not close the socket when the spectator joins successfully", () => {
    const { service, server, gameManager } = createService();
    gameManager.game.mockReturnValueOnce({} as never);
    const joinSpy = vi.spyOn(spectatorBus, "join").mockReturnValue(true);
    const ws = createMockWs();
    vi.spyOn((service as any).spectatorWss, "handleUpgrade").mockImplementation(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(ws),
    );

    try {
      server.emit(
        "upgrade",
        createUpgradeRequest("/spectate/game-1"),
        createUpgradeSocket(),
        Buffer.alloc(0),
      );

      expect(ws.close).not.toHaveBeenCalled();
    } finally {
      joinSpy.mockRestore();
    }
  });
});

describe("WorkerLobbyService upgrade admission", () => {
  it("rejects upgrades once the per-IP rate limit is exceeded", () => {
    const { service, server } = createService();
    (service as any).ingressGuard = new WebSocketIngressGuard(1, 10, 1_000);
    vi.spyOn((service as any).lobbiesWss, "handleUpgrade").mockImplementation(
      () => {},
    );

    const ip = "203.0.113.30";
    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies", ip),
      createUpgradeSocket(),
      Buffer.alloc(0),
    );

    const socket = createUpgradeSocket();
    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies", ip),
      socket,
      Buffer.alloc(0),
    );

    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining("429 Too Many Requests"),
    );
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects upgrades once the per-IP connection cap is exceeded", () => {
    const { service, server } = createService();
    (service as any).ingressGuard = new WebSocketIngressGuard(10, 1, 1_000);
    vi.spyOn((service as any).lobbiesWss, "handleUpgrade").mockImplementation(
      () => {},
    );

    const ip = "203.0.113.31";
    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies", ip),
      createUpgradeSocket(),
      Buffer.alloc(0),
    );

    const socket = createUpgradeSocket();
    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies", ip),
      socket,
      Buffer.alloc(0),
    );

    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining("503 Busy"),
    );
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("releases the reservation and destroys the socket when handleUpgrade throws", () => {
    const { service, server } = createService();
    const error = new Error("handshake failed");
    vi.spyOn((service as any).lobbiesWss, "handleUpgrade").mockImplementation(
      () => {
        throw error;
      },
    );

    const ip = "203.0.113.32";
    const socket = createUpgradeSocket();
    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies", ip),
      socket,
      Buffer.alloc(0),
    );

    expect(socket.destroy).toHaveBeenCalledWith(error);
    expect((service as any).ingressGuard.activeForIp(ip)).toBe(0);
  });
});

describe("WorkerLobbyService IPC message handling", () => {
  const validGameConfig = {
    gameMap: GameMapType.World,
    difficulty: Difficulty.Medium,
    donateGold: false,
    donateTroops: false,
    gameType: GameType.Public,
    gameMode: GameMode.FFA,
    gameMapSize: GameMapSize.Normal,
    nations: "default" as const,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
  };

  it("logs and ignores IPC messages that fail schema validation", () => {
    const { messageHandler } = createService();

    messageHandler({ type: "bogus" });

    expect(logger.error).toHaveBeenCalledWith(
      "Invalid IPC message from master:",
      { type: "bogus" },
    );
  });

  it("skips creating a game that already exists", () => {
    const { messageHandler, gameManager } = createService();
    gameManager.game.mockReturnValueOnce({} as never);

    messageHandler({
      type: "createGame",
      gameID: "dup-game",
      gameConfig: validGameConfig,
      publicGameType: "ffa",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Game dup-game already exists, skipping create",
    );
    expect(gameManager.createGame).not.toHaveBeenCalled();
  });

  it("creates a new game from a master broadcast", () => {
    const { messageHandler, gameManager } = createService();
    gameManager.game.mockReturnValueOnce(null);

    messageHandler({
      type: "createGame",
      gameID: "new-game",
      gameConfig: validGameConfig,
      publicGameType: "ffa",
    });

    expect(logger.info).toHaveBeenCalledWith(
      "Creating public game new-game from master",
    );
    expect(gameManager.createGame).toHaveBeenCalledWith(
      "new-game",
      validGameConfig,
      undefined,
      undefined,
      "ffa",
    );
  });

  it("warns when asked to update a lobby that does not exist", () => {
    const { messageHandler, gameManager } = createService();
    gameManager.game.mockReturnValueOnce(null);

    messageHandler({ type: "updateLobby", gameID: "missing", startsAt: 999 });

    expect(logger.warn).toHaveBeenCalledWith("cannot update game, not found", {
      gameID: "missing",
    });
  });

  it("updates the lobby start time for an existing game", () => {
    const { messageHandler, gameManager } = createService();
    const game = { setStartsAt: vi.fn() };
    gameManager.game.mockReturnValueOnce(game as never);

    messageHandler({ type: "updateLobby", gameID: "live", startsAt: 555 });

    expect(game.setStartsAt).toHaveBeenCalledWith(555);
  });

  it("broadcasts lobby updates to connected clients and reports lobbies to master", () => {
    const { service, server, messageHandler } = createService(
      () =>
        [
          {
            gameInfo: () => ({
              gameID: "abc",
              clients: [{ clientID: "a" }, { clientID: "b" }],
              startsAt: 123,
              gameConfig: undefined,
              publicGameType: "ffa",
            }),
          },
        ] as never,
    );
    const ws = createMockWs();
    vi.spyOn((service as any).lobbiesWss, "handleUpgrade").mockImplementation(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) => cb(ws),
    );
    server.emit(
      "upgrade",
      createUpgradeRequest("/lobbies"),
      createUpgradeSocket(),
      Buffer.alloc(0),
    );

    const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
    const send = vi.fn();
    Object.defineProperty(process, "send", {
      configurable: true,
      value: send,
      writable: true,
    });

    try {
      const publicGames = {
        serverTime: 1_000,
        games: { ffa: [], team: [], special: [] },
      };
      messageHandler({ type: "lobbiesBroadcast", publicGames });

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify(publicGames),
        expect.any(Function),
      );
      expect(send).toHaveBeenCalledWith({
        type: "lobbyList",
        lobbies: [
          {
            gameID: "abc",
            numClients: 2,
            startsAt: 123,
            gameConfig: undefined,
            publicGameType: "ffa",
          },
        ],
      });
    } finally {
      if (sendDescriptor) {
        Object.defineProperty(process, "send", sendDescriptor);
      } else {
        Reflect.deleteProperty(process, "send");
      }
    }
  });
});
