import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  RemoteAiSingleflight,
  RemoteAiWaiterDisconnectedError,
} from "../../src/server/RemoteAiSingleflight";

class ResponseStub extends EventEmitter {
  writableEnded = false;
}

describe("RemoteAiSingleflight", () => {
  it("coalesces one request and survives one waiter disconnect", async () => {
    let finish!: (value: string) => void;
    let sharedSignal!: AbortSignal;
    const operation = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          sharedSignal = signal;
          finish = resolve;
        }),
    );
    const flights = new RemoteAiSingleflight();
    const firstResponse = new ResponseStub();
    const secondResponse = new ResponseStub();
    const first = flights.run(
      "recap:one",
      firstResponse as any,
      operation,
      1_000,
    );
    const second = flights.run(
      "recap:one",
      secondResponse as any,
      operation,
      1_000,
    );
    firstResponse.emit("close");
    await expect(first).rejects.toBeInstanceOf(RemoteAiWaiterDisconnectedError);
    expect(sharedSignal.aborted).toBe(false);
    finish("shared recap");
    await expect(second).resolves.toEqual({
      value: "shared recap",
      joined: true,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("aborts only after the final waiter disconnects", async () => {
    let sharedSignal!: AbortSignal;
    const operation = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        sharedSignal = signal;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    const flights = new RemoteAiSingleflight();
    const response = new ResponseStub();
    const pending = flights.run("recap:two", response as any, operation, 1_000);
    response.emit("close");
    await expect(pending).rejects.toBeInstanceOf(
      RemoteAiWaiterDisconnectedError,
    );
    expect(sharedSignal.aborted).toBe(true);
  });
});
