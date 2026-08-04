import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionRecoveryPresenter,
  projectConnectionRecoveryView,
} from "../../src/client/ConnectionRecoveryPresenter";
import {
  TransportConnectionStateEvent,
  TransportOutboxOverflowEvent,
} from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";

describe("player-visible transport recovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("projects exact retry and protected-command state", () => {
    expect(
      projectConnectionRecoveryView(
        new TransportConnectionStateEvent(
          "waiting",
          2,
          3,
          1_250,
          "socket-error",
        ),
        true,
      ),
    ).toMatchObject({
      state: "waiting",
      title: "Connection interrupted",
      detail: "Retrying in 2s · 3 commands protected",
    });
  });

  it("renders recovery, synchronization, restored, and overflow states accessibly", () => {
    const bus = new EventBus();
    const presenter = new ConnectionRecoveryPresenter(bus);
    const element = document.querySelector("#connection-recovery-status")!;

    bus.emit(
      new TransportConnectionStateEvent("waiting", 1, 2, 250, "socket-error"),
    );
    expect(element.getAttribute("role")).toBe("status");
    expect(element.textContent).toContain("2 commands protected");

    bus.emit(new TransportConnectionStateEvent("synchronizing", 1, 2));
    expect((element as HTMLElement).dataset.state).toBe("synchronizing");
    expect(element.textContent).toContain("Synchronizing server turns");

    bus.emit(new TransportConnectionStateEvent("open", 0, 0));
    expect((element as HTMLElement).dataset.state).toBe("restored");
    expect(element.textContent).toContain("delivered in order");
    vi.advanceTimersByTime(2_500);
    expect((element as HTMLElement).hidden).toBe(true);

    bus.emit(new TransportOutboxOverflowEvent(256, 256, "intent"));
    expect(element.getAttribute("role")).toBe("alert");
    expect(element.textContent).toContain("newest intent command was not sent");
    presenter.dispose();
    expect(document.querySelector("#connection-recovery-status")).toBeNull();
  });

  it("renders protocol refusal without exposing raw server text", () => {
    const bus = new EventBus();
    const presenter = new ConnectionRecoveryPresenter(bus);
    bus.emit(
      new TransportConnectionStateEvent(
        "closed",
        1,
        0,
        null,
        "sensitive provider detail",
      ),
    );
    const element = document.querySelector("#connection-recovery-status")!;
    expect(element.getAttribute("role")).toBe("alert");
    expect(element.textContent).toContain("Connection refused");
    expect(element.textContent).not.toContain("sensitive provider detail");
    presenter.dispose();
  });
});
