import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MultiTabDetector } from "../../src/client/MultiTabDetector";

describe("MultiTabDetector lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  test("starts once and tears down timers, storage ownership, and listeners", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const detector = new MultiTabDetector();
    const penalty = vi.fn();

    detector.startMonitoring(penalty);
    detector.startMonitoring(penalty);
    expect(detector.debugStateForTest()).toMatchObject({
      listening: true,
      running: true,
    });
    expect(
      add.mock.calls.filter(([name]) => String(name) === "storage"),
    ).toHaveLength(1);
    expect(
      add.mock.calls.filter(([name]) => String(name) === "beforeunload"),
    ).toHaveLength(1);

    detector.stopMonitoring();
    expect(detector.debugStateForTest()).toMatchObject({
      listening: false,
      running: false,
      penaltyPending: false,
    });
    expect(localStorage.getItem("multi-tab-lock")).toBeNull();
    expect(
      remove.mock.calls.filter(([name]) => String(name) === "storage"),
    ).toHaveLength(1);
    expect(
      remove.mock.calls.filter(([name]) => String(name) === "beforeunload"),
    ).toHaveLength(1);
  });

  test("rejects malformed locks and applies one truthful collision penalty", () => {
    const detector = new MultiTabDetector();
    const penalty = vi.fn();
    detector.startMonitoring(penalty);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "multi-tab-lock",
        newValue: '{"owner":[],"timestamp":"spoof"}',
      }),
    );
    expect(penalty).not.toHaveBeenCalled();

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "multi-tab-lock",
        newValue: JSON.stringify({ owner: "other-tab", timestamp: Date.now() }),
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "multi-tab-lock",
        newValue: JSON.stringify({ owner: "other-tab", timestamp: Date.now() }),
      }),
    );
    expect(penalty).toHaveBeenCalledOnce();
    expect(detector.debugStateForTest().punishmentCount).toBe(1);
    detector.stopMonitoring();
  });
});
