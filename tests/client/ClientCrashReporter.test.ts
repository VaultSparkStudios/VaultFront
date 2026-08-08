import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  reportClientCrash: vi.fn().mockResolvedValue(undefined),
}));

import { reportClientCrash } from "../../src/client/Api";
import {
  __testables,
  installClientCrashReporter,
} from "../../src/client/ClientCrashReporter";

describe("ClientCrashReporter (S99 audit #183)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("hashStack is deterministic and never returns the input text", () => {
    const stack = "TypeError: x is not a function\n  at FxLayer.ts:200:5";
    const first = __testables.hashStack(stack);
    const second = __testables.hashStack(stack);
    expect(first).toBe(second);
    expect(first).not.toContain("FxLayer");
    expect(first).not.toContain("TypeError");
    expect(/^[0-9a-f]{8}$/.test(first)).toBe(true);
  });

  test("truncate bounds message length to the server's schema limit", () => {
    expect(__testables.truncate("short")).toBe("short");
    expect(__testables.truncate("x".repeat(600)).length).toBe(500);
  });

  test("reports a window error event with a message and stack digest, never the raw stack", async () => {
    installClientCrashReporter();
    const error = new Error("boom");
    error.stack = "Error: boom\n  at somewhere.ts:1:1";
    window.dispatchEvent(
      Object.assign(new Event("error"), { message: "boom", error }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(reportClientCrash).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(reportClientCrash).mock.calls[0][0];
    expect(payload.kind).toBe("error");
    expect(payload.message).toBe("boom");
    expect(payload).not.toHaveProperty("stack");
    expect(payload.stackHash).toBeDefined();
  });

  test("reports an unhandled promise rejection", async () => {
    installClientCrashReporter();
    const reason = new Error("rejected");
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason }),
    );
    await Promise.resolve();
    await Promise.resolve();

    const calls = vi.mocked(reportClientCrash).mock.calls;
    const rejectionCall = calls.find(
      (call) => call[0].kind === "unhandledrejection",
    );
    expect(rejectionCall).toBeDefined();
    expect(rejectionCall?.[0].message).toBe("rejected");
  });
});
