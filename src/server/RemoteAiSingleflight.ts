import type { Response } from "express";
import { executeReservedRemoteAiCall } from "./RemoteAiPolicy";

export class RemoteAiWaiterDisconnectedError extends Error {
  constructor() {
    super("remote-ai-waiter-disconnected");
    this.name = "RemoteAiWaiterDisconnectedError";
  }
}

interface Flight<T> {
  controller: AbortController;
  promise: Promise<T>;
  waiters: Set<symbol>;
}

/** Coalesces one provider call while giving each HTTP waiter its own lifetime. */
export class RemoteAiSingleflight {
  private readonly flights = new Map<string, Flight<unknown>>();

  async run<T>(
    key: string,
    response: Response,
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<{ value: T; joined: boolean }> {
    const present = this.flights.get(key) as Flight<T> | undefined;
    const joined = Boolean(present);
    const flight = present ?? this.createFlight(key, operation, timeoutMs);
    const waiter = Symbol(key);
    flight.waiters.add(waiter);

    let rejectDisconnected!: (error: Error) => void;
    const disconnected = new Promise<never>((_resolve, reject) => {
      rejectDisconnected = reject;
    });
    const detach = () => {
      if (!flight.waiters.delete(waiter)) return;
      rejectDisconnected(new RemoteAiWaiterDisconnectedError());
      if (flight.waiters.size === 0) {
        flight.controller.abort(new RemoteAiWaiterDisconnectedError());
      }
    };
    response.once("close", detach);
    try {
      const value = await Promise.race([flight.promise, disconnected]);
      return { value, joined };
    } finally {
      response.removeListener("close", detach);
      flight.waiters.delete(waiter);
    }
  }

  private createFlight<T>(
    key: string,
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Flight<T> {
    const controller = new AbortController();
    const flight: Flight<T> = {
      controller,
      waiters: new Set(),
      promise: Promise.resolve(undefined as T),
    };
    flight.promise = executeReservedRemoteAiCall(
      operation,
      timeoutMs,
      controller.signal,
    ).finally(() => {
      if (this.flights.get(key) === flight) this.flights.delete(key);
    });
    this.flights.set(key, flight as Flight<unknown>);
    return flight;
  }
}
