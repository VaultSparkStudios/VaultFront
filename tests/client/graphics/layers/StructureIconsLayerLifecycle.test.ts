import { afterEach, describe, expect, test, vi } from "vitest";
import { StructureIconsLayer } from "../../../../src/client/graphics/layers/StructureIconsLayer";
import { EventBus } from "../../../../src/core/EventBus";

describe("StructureIconsLayer lifecycle", () => {
  afterEach(() => vi.restoreAllMocks());

  test("dispose releases resize and match-bus listeners exactly once", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const eventBus = new EventBus();
    const layer = new StructureIconsLayer(
      { config: () => ({ theme: () => "dark" }) } as any,
      eventBus,
      { ghostStructure: null } as any,
      {} as any,
    );
    vi.spyOn(layer, "setupRenderer").mockResolvedValue();

    await layer.init();
    const resizeHandler = add.mock.calls.find(
      ([type]) => String(type) === "resize",
    )?.[1];
    expect(resizeHandler).toBeTypeOf("function");
    expect(eventBus.listenerCountForTest()).toBe(3);

    layer.dispose();
    layer.dispose();

    expect(remove).toHaveBeenCalledWith("resize", resizeHandler);
    expect(eventBus.listenerCountForTest()).toBe(0);
  });
});
