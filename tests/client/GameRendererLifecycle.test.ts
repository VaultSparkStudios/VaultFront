import { afterEach, describe, expect, test, vi } from "vitest";
import { GameRenderer } from "../../src/client/graphics/GameRenderer";
import { EventBus } from "../../src/core/EventBus";

class DurableEvent {}

describe("GameRenderer lifecycle", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  test("owns its frame, canvas, layer lifecycle, and match-scoped bus listeners", () => {
    const eventBus = new EventBus();
    eventBus.on(DurableEvent, () => undefined);
    const layer = { init: vi.fn(), dispose: vi.fn() };
    const spectator = { start: vi.fn(), stop: vi.fn(), tick: vi.fn() };
    const transform = {
      updateCanvasBoundingRect: vi.fn(),
      centerAll: vi.fn(),
      resetChanged: vi.fn(),
    };
    const canvas = document.createElement("canvas");
    const cancel = vi.spyOn(window, "cancelAnimationFrame");

    const renderer = new GameRenderer(
      {} as any,
      eventBus,
      canvas,
      transform as any,
      {} as any,
      [layer],
      {} as any,
      spectator as any,
    );
    renderer.initialize();
    expect(document.body.contains(canvas)).toBe(true);
    expect(eventBus.listenerCountForTest()).toBe(2);

    renderer.destroy();
    renderer.destroy();

    expect(layer.init).toHaveBeenCalledOnce();
    expect(layer.dispose).toHaveBeenCalledOnce();
    expect(spectator.start).toHaveBeenCalledOnce();
    expect(spectator.stop).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(document.body.contains(canvas)).toBe(false);
    expect(eventBus.listenerCountForTest()).toBe(1);
  });
});
