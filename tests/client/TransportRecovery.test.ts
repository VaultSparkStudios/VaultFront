import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SendVaultRolePingIntentEvent,
  Transport,
  TransportConnectionStateEvent,
  TransportOutboxOverflowEvent,
} from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";

class FakeWebSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];
  failNextSend = false;
  clientCloseCode = 1000;
  emitCloseOnClientClose = true;

  send(payload: string): void {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("deterministic send failure");
    }
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("send while socket is not open");
    }
    this.sent.push(payload);
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    if (this.emitCloseOnClientClose) {
      this.onclose?.({
        code: this.clientCloseCode,
        reason: "",
      } as CloseEvent);
    }
  }

  serverOpen(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  serverClose(code = 1006, reason = "network-loss"): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  serverError(): void {
    this.onerror?.(new Event("error"));
  }
}

function createHarness(maxOutboxMessages = 8) {
  const eventBus = new EventBus();
  const sockets: FakeWebSocket[] = [];
  const states: TransportConnectionStateEvent[] = [];
  const overflows: TransportOutboxOverflowEvent[] = [];
  eventBus.on(TransportConnectionStateEvent, (event) => states.push(event));
  eventBus.on(TransportOutboxOverflowEvent, (event) => overflows.push(event));
  const transport = new Transport(
    {
      gameID: "recovery-game",
      playerName: "tester",
      serverConfig: { workerPath: () => "/worker/recovery-game" },
      cosmetics: {},
      turnstileToken: null,
      gameStartInfo: { config: { gameType: "Public" } },
    } as any,
    eventBus,
    {
      maxOutboxMessages,
      reconnectBaseDelayMs: 250,
      reconnectMaxDelayMs: 1000,
      jitterDelay: (delay) => delay,
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    },
  );
  return { eventBus, overflows, sockets, states, transport };
}

function sentMessages(socket: FakeWebSocket): any[] {
  return socket.sent.map((payload) => JSON.parse(payload));
}

describe("Transport recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("keeps accepted intents FIFO and rejects newest overflow", async () => {
    const { eventBus, overflows, sockets, transport } = createHarness(2);
    transport.connect(
      () => {},
      () => {},
    );

    eventBus.emit(new SendVaultRolePingIntentEvent("escort_convoy"));
    eventBus.emit(new SendVaultRolePingIntentEvent("intercept_lane"));
    eventBus.emit(new SendVaultRolePingIntentEvent("pulse_soon"));

    expect(transport.connectionSnapshot().outboxDepth).toBe(2);
    expect(overflows).toEqual([
      expect.objectContaining({
        capacity: 2,
        outboxDepth: 2,
        rejectedMessageType: "intent",
      }),
    ]);

    sockets[0].serverOpen();
    await vi.runAllTicks();

    expect(
      sentMessages(sockets[0]).map((message) => message.intent.ping),
    ).toEqual(["escort_convoy", "intercept_lane"]);
    expect(transport.connectionSnapshot()).toEqual({
      state: "open",
      reconnectAttempt: 0,
      outboxDepth: 0,
    });
  });

  test("uses exponential backoff and resets attempts after open", async () => {
    const { sockets, states, transport } = createHarness();
    transport.connect(
      () => {},
      () => {},
    );
    sockets[0].serverClose();

    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        state: "waiting",
        reconnectAttempt: 1,
        retryInMs: 250,
      }),
    );
    await vi.advanceTimersByTimeAsync(249);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    sockets[1].serverClose();
    expect(states.at(-1)?.retryInMs).toBe(500);
    await vi.advanceTimersByTimeAsync(500);
    sockets[2].serverOpen();
    await vi.runAllTicks();
    expect(transport.connectionSnapshot().reconnectAttempt).toBe(0);

    sockets[2].serverClose();
    expect(states.at(-1)?.retryInMs).toBe(250);
  });

  test("does not double-schedule when an error is followed by close 1000", async () => {
    const { sockets, states, transport } = createHarness();
    transport.connect(
      () => {},
      () => {},
    );

    sockets[0].serverError();
    expect(transport.connectionSnapshot().state).toBe("waiting");
    expect(states.filter((event) => event.state === "waiting")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);

    expect(sockets).toHaveLength(2);
  });

  test("protocol refusal cancels a retry already scheduled by socket error", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { sockets, states, transport } = createHarness();
    transport.connect(
      () => {},
      () => {},
    );
    sockets[0].clientCloseCode = 1002;

    sockets[0].serverError();
    expect(transport.connectionSnapshot().state).toBe("closed");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sockets).toHaveLength(1);
    expect(alert).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({
      state: "closed",
      reason: "protocol-refused",
    });
  });

  test("scheduled recovery replaces a stale socket even without a close event", async () => {
    const { sockets, transport } = createHarness();
    transport.connect(
      () => {},
      () => {},
    );
    sockets[0].emitCloseOnClientClose = false;

    sockets[0].serverError();
    await vi.advanceTimersByTimeAsync(250);

    expect(sockets).toHaveLength(2);
    expect(transport.connectionSnapshot().state).toBe("connecting");
  });

  test("leave cancels recovery, clears the outbox, and suppresses stale sockets", async () => {
    const { eventBus, sockets, transport } = createHarness();
    transport.connect(
      () => {},
      () => {},
    );
    const staleOpen = sockets[0].onopen;
    eventBus.emit(new SendVaultRolePingIntentEvent("escort_convoy"));
    sockets[0].serverClose();

    transport.leaveGame();
    staleOpen?.(new Event("open"));
    await vi.advanceTimersByTimeAsync(2000);

    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toEqual([]);
    expect(transport.connectionSnapshot()).toEqual({
      state: "closed",
      reconnectAttempt: 1,
      outboxDepth: 0,
    });
  });

  test("synchronizes first, then flushes queued intents in order", async () => {
    const { eventBus, sockets, states, transport } = createHarness();
    transport.connect(
      async () => {
        (transport as any).sendMsg(
          {
            type: "rejoin",
            gameID: "recovery-game",
            lastTurn: 42,
            token: "test-token",
          },
          { allowDuringSynchronization: true },
        );
      },
      () => {},
    );
    eventBus.emit(new SendVaultRolePingIntentEvent("pulse_soon"));

    sockets[0].serverOpen();
    await vi.runAllTicks();

    expect(sentMessages(sockets[0]).map((message) => message.type)).toEqual([
      "rejoin",
      "intent",
    ]);
    const openStates = states.filter((event) => event.state === "open");
    expect(openStates).toHaveLength(1);
    expect(openStates[0].outboxDepth).toBe(0);
  });

  test("backs off failed control synchronization without flushing gameplay", async () => {
    const { eventBus, sockets, states, transport } = createHarness();
    const synchronize = async () => {
      const accepted = (transport as any).sendMsg(
        {
          type: "rejoin",
          gameID: "recovery-game",
          lastTurn: 42,
          token: "test-token",
        },
        { allowDuringSynchronization: true, buffer: false },
      );
      if (!accepted) throw new Error("control synchronization rejected");
    };
    transport.connect(synchronize, () => {});
    eventBus.emit(new SendVaultRolePingIntentEvent("pulse_soon"));
    sockets[0].failNextSend = true;

    sockets[0].serverOpen();
    await vi.runAllTicks();
    expect(sockets[0].sent).toEqual([]);
    expect(transport.connectionSnapshot().outboxDepth).toBe(1);
    expect(states.at(-1)?.retryInMs).toBe(250);

    await vi.advanceTimersByTimeAsync(250);
    sockets[1].failNextSend = true;
    sockets[1].serverOpen();
    await vi.runAllTicks();
    expect(sockets[1].sent).toEqual([]);
    expect(states.at(-1)?.retryInMs).toBe(500);

    await vi.advanceTimersByTimeAsync(500);
    sockets[2].serverOpen();
    await vi.runAllTicks();
    expect(sentMessages(sockets[2]).map((message) => message.type)).toEqual([
      "rejoin",
      "intent",
    ]);
    expect(transport.connectionSnapshot()).toEqual({
      state: "open",
      reconnectAttempt: 0,
      outboxDepth: 0,
    });
  });

  test("retains the failed FIFO head without duplicating earlier sends", async () => {
    const { eventBus, sockets, transport } = createHarness();
    transport.connect(
      () => {},
      () => {},
    );
    eventBus.emit(new SendVaultRolePingIntentEvent("escort_convoy"));
    eventBus.emit(new SendVaultRolePingIntentEvent("intercept_lane"));
    eventBus.emit(new SendVaultRolePingIntentEvent("pulse_soon"));
    sockets[0].failNextSend = true;

    sockets[0].serverOpen();
    await vi.runAllTicks();
    expect(transport.connectionSnapshot().outboxDepth).toBe(3);
    await vi.advanceTimersByTimeAsync(250);
    sockets[1].serverOpen();
    await vi.runAllTicks();

    expect(
      sentMessages(sockets[1]).map((message) => message.intent.ping),
    ).toEqual(["escort_convoy", "intercept_lane", "pulse_soon"]);
    expect(transport.connectionSnapshot().outboxDepth).toBe(0);
  });
});
