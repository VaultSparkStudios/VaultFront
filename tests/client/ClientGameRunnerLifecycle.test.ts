import { describe, expect, test, vi } from "vitest";

const soundMock = vi.hoisted(() => ({
  playBackgroundMusic: vi.fn(),
  stopBackgroundMusic: vi.fn(),
}));
vi.mock("../../src/client/sound/SoundManager", () => ({
  default: soundMock,
}));

import { ClientGameRunner } from "../../src/client/ClientGameRunner";

describe("ClientGameRunner lifecycle", () => {
  test("tears down a constructed match even when it closes before start", () => {
    const renderer = { destroy: vi.fn() };
    const input = { destroy: vi.fn() };
    const transport = { leaveGame: vi.fn() };
    const worker = { cleanup: vi.fn() };
    const touch = { destroy: vi.fn() };
    const runner = new ClientGameRunner(
      { playerName: "captain" } as any,
      "client-1" as any,
      {} as any,
      renderer as any,
      input as any,
      transport as any,
      worker as any,
      {} as any,
      touch as any,
    );

    runner.stop();
    runner.stop();
    runner.start();

    expect(worker.cleanup).toHaveBeenCalledOnce();
    expect(transport.leaveGame).toHaveBeenCalledOnce();
    expect(renderer.destroy).toHaveBeenCalledOnce();
    expect(input.destroy).toHaveBeenCalledOnce();
    expect(touch.destroy).toHaveBeenCalledOnce();
    expect(soundMock.stopBackgroundMusic).toHaveBeenCalledOnce();
    expect(soundMock.playBackgroundMusic).not.toHaveBeenCalled();
  });
});
