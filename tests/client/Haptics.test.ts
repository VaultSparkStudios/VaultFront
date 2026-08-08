import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { triggerHaptic } from "../../src/client/Utils";
import { UserSettings } from "../../src/core/game/UserSettings";

describe("UserSettings.hapticsEnabled (S99 audit #182)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("defaults to false pending a real playtest signal", () => {
    expect(new UserSettings().hapticsEnabled()).toBe(false);
  });

  test("respects an explicit opt-in", () => {
    const settings = new UserSettings();
    settings.set("settings.hapticsEnabled", true);
    expect(settings.hapticsEnabled()).toBe(true);
  });
});

describe("triggerHaptic", () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  test("calls navigator.vibrate with the given pattern when supported", () => {
    const vibrate = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate },
      configurable: true,
    });
    triggerHaptic([40, 30, 60]);
    expect(vibrate).toHaveBeenCalledWith([40, 30, 60]);
  });

  test("silently no-ops when navigator.vibrate is unsupported (desktop/iOS Safari)", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    expect(() => triggerHaptic([40])).not.toThrow();
  });

  test("silently no-ops when navigator.vibrate throws", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        vibrate: () => {
          throw new Error("blocked");
        },
      },
      configurable: true,
    });
    expect(() => triggerHaptic([40])).not.toThrow();
  });
});

describe("haptic call sites are gated by hapticsEnabled (S99 audit #182)", () => {
  const read = (relative: string) =>
    readFileSync(resolve(__dirname, "../..", relative), "utf8");

  test("InterceptCelebration checks hapticsEnabled before vibrating", () => {
    const source = read("src/client/graphics/layers/InterceptCelebration.ts");
    expect(source).toContain(
      "this.game.config().userSettings()?.hapticsEnabled()",
    );
    expect(source).toContain("triggerHaptic(");
  });

  test("FxLayer's major nuke explosion checks hapticsEnabled before vibrating", () => {
    const source = read("src/client/graphics/layers/FxLayer.ts");
    expect(source).toContain(
      "this.game.config().userSettings()?.hapticsEnabled()",
    );
    expect(source).toContain("triggerHaptic(");
  });
});
