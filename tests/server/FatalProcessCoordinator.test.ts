import { describe, expect, it, vi } from "vitest";
import { FatalProcessCoordinator } from "../../src/server/FatalProcessCoordinator";

describe("FatalProcessCoordinator", () => {
  it("stops admission immediately, drains once, and exits nonzero once", async () => {
    const record = vi.fn();
    const stopAdmission = vi.fn();
    const drain = vi.fn().mockResolvedValue(undefined);
    const exportCrash = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const coordinator = new FatalProcessCoordinator({
      process: "worker",
      processId: 7,
      now: () => 123,
      record,
      stopAdmission,
      drain,
      exportCrash,
      exit,
    });

    const first = coordinator.handleFatal(
      "uncaughtException",
      new Error("boom"),
    );
    const duplicate = coordinator.handleFatal("unhandledRejection", "later");
    expect(coordinator.isAccepting()).toBe(false);
    expect(stopAdmission).toHaveBeenCalledOnce();
    expect(duplicate).toBe(first);
    await first;

    expect(record).toHaveBeenCalledWith({
      process: "worker",
      processId: 7,
      kind: "uncaughtException",
      message: "boom",
      at: 123,
    });
    expect(drain).toHaveBeenCalledOnce();
    expect(exportCrash).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("rejects ordinary requests while allowing health probes during drain", () => {
    const coordinator = new FatalProcessCoordinator({
      process: "master",
      record: () => undefined,
      stopAdmission: () => undefined,
      drain: async () => undefined,
      exportCrash: async () => undefined,
      exit: () => undefined,
    });
    void coordinator.handleFatal("uncaughtException", "boom");
    const next = vi.fn();
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    coordinator.admissionMiddleware()(
      { path: "/api/game" } as any,
      response as any,
      next,
    );
    expect(response.status).toHaveBeenCalledWith(503);
    coordinator.admissionMiddleware()(
      { path: "/_health" } as any,
      response as any,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
