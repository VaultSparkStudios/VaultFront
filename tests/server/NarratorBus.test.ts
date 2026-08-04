import { EventEmitter } from "events";
import { describe, expect, test, vi } from "vitest";
import { NarratorBus } from "../../src/server/NarratorBus";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function response() {
  const emitter = new EventEmitter() as any;
  emitter.write = vi.fn().mockReturnValue(true);
  emitter.end = vi.fn();
  return emitter;
}

describe("NarratorBus", () => {
  test("broadcasts a certified deterministic baseline when remote AI is off", () => {
    const oldEnabled = process.env.VAULTFRONT_REMOTE_AI_ENABLED;
    process.env.VAULTFRONT_REMOTE_AI_ENABLED = "false";
    const bus = new NarratorBus();
    const client = response();
    bus.subscribe("game-local", client, "ip:local");
    bus.queueCertifiedEvent("game-local", {
      authority: "accepted-game-intent",
      intentType: "attack",
      label: "A new offensive crossed the line.",
    });

    const lines = client.write.mock.calls
      .map(([line]: [string]) => line)
      .join("");
    expect(lines).toContain("A new offensive crossed the line.");
    expect(lines).toContain('"authority":"accepted-game-intent"');
    expect(lines).toContain('"baseline":true');
    bus.closeGame("game-local");
    if (oldEnabled === undefined)
      delete process.env.VAULTFRONT_REMOTE_AI_ENABLED;
    else process.env.VAULTFRONT_REMOTE_AI_ENABLED = oldEnabled;
  });

  test("deduplicates adjacent pending labels and caps queue length", () => {
    const oldKey = process.env.ANTHROPIC_API_KEY;
    const oldEnabled = process.env.VAULTFRONT_REMOTE_AI_ENABLED;
    const oldCap = process.env.VAULTFRONT_REMOTE_AI_MAX_CALLS_PER_HOUR;
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.VAULTFRONT_REMOTE_AI_ENABLED = "true";
    process.env.VAULTFRONT_REMOTE_AI_MAX_CALLS_PER_HOUR = "10";
    const bus = new NarratorBus();
    bus.subscribe("game-1", response(), "ip:test");

    const certified = (label: string) => ({
      authority: "accepted-game-intent" as const,
      intentType: "attack" as const,
      label,
    });
    bus.queueCertifiedEvent("game-1", certified("convoy intercepted"));
    bus.queueCertifiedEvent("game-1", certified("convoy intercepted"));
    for (let i = 0; i < 20; i++) {
      bus.queueCertifiedEvent("game-1", certified(`event ${i}`));
    }

    expect(bus.debugState("game-1").pendingEvents).toBe(12);
    bus.closeGame("game-1");
    if (oldKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = oldKey;
    }
    if (oldEnabled === undefined) {
      delete process.env.VAULTFRONT_REMOTE_AI_ENABLED;
    } else {
      process.env.VAULTFRONT_REMOTE_AI_ENABLED = oldEnabled;
    }
    if (oldCap === undefined) {
      delete process.env.VAULTFRONT_REMOTE_AI_MAX_CALLS_PER_HOUR;
    } else {
      process.env.VAULTFRONT_REMOTE_AI_MAX_CALLS_PER_HOUR = oldCap;
    }
  });
});
