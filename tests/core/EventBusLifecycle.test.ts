import { describe, expect, test, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";

class SessionEvent {
  constructor(readonly value: number) {}
}

describe("EventBus lifecycle", () => {
  test("disposes individual listeners idempotently", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const dispose = bus.on(SessionEvent, listener);
    bus.emit(new SessionEvent(1));
    dispose();
    dispose();
    bus.emit(new SessionEvent(2));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bus.listenerCountForTest()).toBe(0);
  });

  test("restores the listener boundary captured before a match", () => {
    const bus = new EventBus();
    const durable = vi.fn();
    const matchOnly = vi.fn();
    bus.on(SessionEvent, durable);
    const checkpoint = bus.checkpoint();
    bus.on(SessionEvent, matchOnly);
    bus.restore(checkpoint);
    bus.emit(new SessionEvent(3));
    expect(durable).toHaveBeenCalledOnce();
    expect(matchOnly).not.toHaveBeenCalled();
    expect(bus.listenerCountForTest()).toBe(1);
  });
});
