import { describe, expect, it } from "vitest";
import { resolveWorkerInitTimeoutMs } from "../../src/core/worker/WorkerClient";

describe("resolveWorkerInitTimeoutMs (e2e/live-match.spec.ts follow-up)", () => {
  it("defaults to the production 20-second timeout when unset", () => {
    expect(resolveWorkerInitTimeoutMs(undefined)).toBe(20_000);
  });

  it("defaults to the production timeout for an empty string", () => {
    expect(resolveWorkerInitTimeoutMs("")).toBe(20_000);
  });

  it("defaults to the production timeout for a non-numeric override", () => {
    expect(resolveWorkerInitTimeoutMs("not-a-number")).toBe(20_000);
  });

  it("defaults to the production timeout for a zero or negative override", () => {
    expect(resolveWorkerInitTimeoutMs("0")).toBe(20_000);
    expect(resolveWorkerInitTimeoutMs("-5000")).toBe(20_000);
  });

  it("uses the override when it is a positive number", () => {
    expect(resolveWorkerInitTimeoutMs("60000")).toBe(60_000);
  });
});
