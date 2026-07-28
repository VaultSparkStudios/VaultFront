import EventEmitter from "events";
import { describe, expect, it, vi } from "vitest";
import {
  MasterLobbyService,
  WORKER_HEALTH_MAX_AGE_MS,
} from "../../src/server/MasterLobbyService";
import { TestServerConfig } from "../util/TestServerConfig";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

vi.mock("../../src/server/PollingLoop", () => ({
  startPolling: vi.fn(),
}));

function createMockWorker(): EventEmitter {
  const emitter = new EventEmitter();
  (emitter as any).send = vi.fn();
  return emitter;
}

function sendWorkerReady(worker: EventEmitter, workerId: number) {
  worker.emit("message", { type: "workerReady", workerId });
}

function sendWorkerHealth(
  worker: EventEmitter,
  workerId: number,
  input: {
    observedAt?: number;
    healthy?: boolean;
    reasons?: string[];
  } = {},
) {
  const healthy = input.healthy ?? true;
  worker.emit("message", {
    type: "workerHealth",
    workerId,
    observedAt: input.observedAt ?? Date.now(),
    healthy,
    reasons: input.reasons ?? (healthy ? [] : ["game-loop-stale"]),
  });
}

function createService(numWorkers: number): MasterLobbyService {
  const config = new TestServerConfig();
  vi.spyOn(config, "numWorkers").mockReturnValue(numWorkers);
  const log = { info: vi.fn(), error: vi.fn() } as any;
  return new MasterLobbyService(config, {} as any, log);
}

function startAllWorkers(
  service: MasterLobbyService,
  count: number,
): { id: number; w: EventEmitter }[] {
  const workers = Array.from({ length: count }, (_, i) => {
    const id = i + 1;
    const w = createMockWorker();
    service.registerWorker(id, w as any);
    return { id, w };
  });
  for (const { w, id } of workers) {
    sendWorkerReady(w, id);
    sendWorkerHealth(w, id);
  }
  return workers;
}

describe("MasterLobbyService.isHealthy", () => {
  it("unhealthy before any workers register", () => {
    const service = createService(4);
    expect(service.isHealthy()).toBe(false);
  });

  it("unhealthy when workers registered but not ready", () => {
    const service = createService(2);
    service.registerWorker(1, createMockWorker() as any);
    expect(service.isHealthy()).toBe(false);
  });

  it("unhealthy when only some workers are ready (server not started)", () => {
    const service = createService(4);

    // 1 of 4 ready -- not enough to flip `started`
    const w1 = createMockWorker();
    service.registerWorker(1, w1 as any);
    sendWorkerReady(w1, 1);

    expect(service.isHealthy()).toBe(false);
  });

  it("fails closed when all workers are ready but health evidence is missing", () => {
    const service = createService(1);
    const worker = createMockWorker();
    service.registerWorker(1, worker as any);
    sendWorkerReady(worker, 1);

    expect(service.healthSnapshot()).toMatchObject({
      healthy: false,
      freshHealthyWorkers: 0,
      workers: [{ workerId: 1, status: "missing" }],
    });
  });

  it("fails closed when the only worker heartbeat is stale", () => {
    const service = createService(1);
    const worker = createMockWorker();
    service.registerWorker(1, worker as any);
    sendWorkerReady(worker, 1);
    const observedAt = Date.now();
    sendWorkerHealth(worker, 1, { observedAt });

    expect(
      service.healthSnapshot(observedAt + WORKER_HEALTH_MAX_AGE_MS + 1),
    ).toMatchObject({
      healthy: false,
      freshHealthyWorkers: 0,
      workers: [{ workerId: 1, status: "stale" }],
    });
  });

  it("fails closed and preserves reasons for degraded worker evidence", () => {
    const service = createService(1);
    const worker = createMockWorker();
    service.registerWorker(1, worker as any);
    sendWorkerReady(worker, 1);
    sendWorkerHealth(worker, 1, {
      healthy: false,
      reasons: ["ipc-disconnected", "persistence-failed"],
    });

    expect(service.healthSnapshot()).toMatchObject({
      healthy: false,
      workers: [
        {
          workerId: 1,
          status: "degraded",
          reasons: ["ipc-disconnected", "persistence-failed"],
        },
      ],
    });
  });

  it("healthy once all workers are ready", () => {
    const service = createService(2);
    startAllWorkers(service, 2);
    expect(service.healthSnapshot()).toMatchObject({
      healthy: true,
      registeredWorkers: 2,
      requiredHealthyWorkers: 1,
      freshHealthyWorkers: 2,
    });
  });

  it("stays healthy after a single worker crash", () => {
    const service = createService(4);
    startAllWorkers(service, 4);

    service.removeWorker(4); // 3 of 4 left, threshold is 2
    expect(service.isHealthy()).toBe(true);
  });

  it("goes unhealthy when too many workers crash", () => {
    const service = createService(4);
    startAllWorkers(service, 4);

    service.removeWorker(2);
    service.removeWorker(3);
    service.removeWorker(4); // 1 of 4 left, threshold is 2
    expect(service.isHealthy()).toBe(false);
  });

  it("single-worker setup goes unhealthy on crash", () => {
    const service = createService(1);
    startAllWorkers(service, 1);
    expect(service.isHealthy()).toBe(true);

    service.removeWorker(1);
    expect(service.isHealthy()).toBe(false);
  });

  it("odd worker count: threshold rounds up (3 workers)", () => {
    const service = createService(3);
    startAllWorkers(service, 3);

    // min = 3/2 = 1.5, so 2 ready is enough, 1 is not
    service.removeWorker(3);
    expect(service.isHealthy()).toBe(true);

    service.removeWorker(2);
    expect(service.isHealthy()).toBe(false);
  });
});
