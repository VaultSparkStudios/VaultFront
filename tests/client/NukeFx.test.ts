import { describe, expect, test, vi } from "vitest";
import {
  nukeFxFactory,
  ShockwaveFx,
} from "../../src/client/graphics/fx/NukeFx";

function mockContext() {
  return {
    beginPath: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}

describe("ShockwaveFx reduced motion (S99 audit #179)", () => {
  test("defaults to full intensity and the given duration", () => {
    const ctx = mockContext();
    const shockwave = new ShockwaveFx(0, 0, 1000, 100);
    shockwave.renderTick(500, ctx); // t = 0.5
    expect(ctx.strokeStyle).toBe("rgba(255, 255, 255, 0.5)");
    // Still alive just before duration elapses.
    expect(shockwave.renderTick(499, ctx)).toBe(true);
    // Expired once total lifetime reaches duration.
    expect(shockwave.renderTick(1, ctx)).toBe(false);
  });

  test("intensityScale caps peak opacity for reduced-motion callers", () => {
    const ctx = mockContext();
    const shockwave = new ShockwaveFx(0, 0, 1000, 100, 0.5);
    shockwave.renderTick(0, ctx); // t = 0, peak alpha
    // Full alpha (1) scaled by 0.5 -- never reaches the un-softened flash.
    expect(ctx.strokeStyle).toBe("rgba(255, 255, 255, 0.5)");
  });
});

describe("nukeFxFactory reduced motion (S99 audit #179)", () => {
  const loader = {
    createAnimatedSprite: () => null,
  } as any;
  const game = {
    isValidCoord: () => false,
    isLand: () => false,
  } as any;

  test("shortens and softens the shockwave when reduced motion is requested", () => {
    const normal = nukeFxFactory(loader, 0, 0, 70, game, false);
    const reduced = nukeFxFactory(loader, 0, 0, 70, game, true);

    const normalShockwave = normal.find(
      (fx) => fx instanceof ShockwaveFx,
    ) as any;
    const reducedShockwave = reduced.find(
      (fx) => fx instanceof ShockwaveFx,
    ) as any;

    expect(normalShockwave).toBeDefined();
    expect(reducedShockwave).toBeDefined();

    const ctxNormal = mockContext();
    const ctxReduced = mockContext();
    normalShockwave.renderTick(0, ctxNormal);
    reducedShockwave.renderTick(0, ctxReduced);

    // At t=0 both are at peak alpha before scaling; the reduced-motion
    // instance must render measurably softer.
    expect(ctxReduced.strokeStyle).not.toBe(ctxNormal.strokeStyle);
    expect(ctxReduced.strokeStyle).toBe("rgba(255, 255, 255, 0.5)");
    expect(ctxNormal.strokeStyle).toBe("rgba(255, 255, 255, 1)");
  });

  test("defaults to full-intensity when reducedMotion is omitted", () => {
    const fx = nukeFxFactory(loader, 0, 0, 70, game);
    const shockwave = fx.find((f) => f instanceof ShockwaveFx) as any;
    const ctx = mockContext();
    shockwave.renderTick(0, ctx);
    expect(ctx.strokeStyle).toBe("rgba(255, 255, 255, 1)");
  });
});
