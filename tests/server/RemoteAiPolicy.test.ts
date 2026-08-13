import { beforeEach, describe, expect, test } from "vitest";
import {
  canAttemptRemoteAi,
  configureRemoteAiDatabase,
  executeReservedRemoteAiCall,
  remoteAiPosture,
  remoteAiUsageByFeature,
  reserveRemoteAiCall,
  resetRemoteAiPolicyForTests,
} from "../../src/server/RemoteAiPolicy";

const readyEnv = {
  ANTHROPIC_API_KEY: "test-key",
  VAULTFRONT_REMOTE_AI_ENABLED: "true",
  VAULTFRONT_REMOTE_AI_MAX_CALLS_PER_HOUR: "2",
} as NodeJS.ProcessEnv;

describe("RemoteAiPolicy", () => {
  beforeEach(() => {
    configureRemoteAiDatabase(null);
    resetRemoteAiPolicyForTests(1_000);
  });

  test("defaults to a cost-neutral disabled posture even with a key", () => {
    const posture = remoteAiPosture(
      { ANTHROPIC_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      1_000,
    );

    expect(posture.costProfile).toBe("cost-neutral");
    expect(posture.reason).toBe("disabled");
    expect(canAttemptRemoteAi({ ANTHROPIC_API_KEY: "test-key" })).toBe(false);
  });

  test("requires a positive hard cap", () => {
    const posture = remoteAiPosture(
      {
        ANTHROPIC_API_KEY: "test-key",
        VAULTFRONT_REMOTE_AI_ENABLED: "true",
      } as NodeJS.ProcessEnv,
      1_000,
    );

    expect(posture.reason).toBe("zero-cap");
    expect(posture.costProfile).toBe("cost-neutral");
  });

  test("atomically exhausts the cap and attributes usage", async () => {
    expect((await reserveRemoteAiCall("coach", readyEnv, 1_000)).allowed).toBe(
      true,
    );
    expect(
      (await reserveRemoteAiCall("narrator", readyEnv, 1_001)).allowed,
    ).toBe(true);
    const denied = await reserveRemoteAiCall("coach", readyEnv, 1_002);

    expect(denied.allowed).toBe(false);
    expect(denied.posture.reason).toBe("cap-exhausted");
    expect(denied.posture.enforcementScope).toBe("process-local-development");
    expect(denied.posture.windowStartedAt).toBe(1_000);
    expect(denied.posture.callsByFeature).toEqual({ coach: 1, narrator: 1 });
    expect(denied.posture.providerBoundReservations).toBe(2);
    expect(denied.posture.deniedReservations).toBe(1);
    expect(remoteAiUsageByFeature()).toEqual({ coach: 1, narrator: 1 });
  });

  test("starts a fresh window after one hour", async () => {
    expect((await reserveRemoteAiCall("other", readyEnv, 1_000)).allowed).toBe(
      true,
    );
    expect(
      (await reserveRemoteAiCall("other", readyEnv, 1_000 + 60 * 60 * 1000))
        .allowed,
    ).toBe(true);
    expect(remoteAiUsageByFeature()).toEqual({ other: 1 });
  });

  test("enforces one atomic cap across concurrent shared-database reservations", async () => {
    let calls = 0;
    configureRemoteAiDatabase({
      query: async (_sql: string, parameters: unknown[]) => {
        const cap = Number(parameters[2]);
        if (calls >= cap) return { rows: [] } as any;
        calls += 1;
        return { rows: [{ calls, by_feature: { coach: calls } }] } as any;
      },
    } as any);
    const sharedEnv = { ...readyEnv, DATABASE_URL: "postgres://shared" };
    const reservations = await Promise.all([
      reserveRemoteAiCall("coach", sharedEnv, 1_000),
      reserveRemoteAiCall("coach", sharedEnv, 1_000),
      reserveRemoteAiCall("coach", sharedEnv, 1_000),
    ]);
    expect(reservations.filter(({ allowed }) => allowed)).toHaveLength(2);
    expect(reservations.filter(({ allowed }) => !allowed)).toHaveLength(1);
    expect(reservations.at(-1)?.posture.enforcementScope).toBe(
      "shared-postgres-hourly",
    );
  });

  test("records completed, failed, timed-out, and cancelled executions", async () => {
    await expect(
      executeReservedRemoteAiCall(async () => "ok", 100),
    ).resolves.toBe("ok");
    await expect(
      executeReservedRemoteAiCall(async () => {
        throw new Error("provider-failed");
      }, 100),
    ).rejects.toThrow("provider-failed");
    await expect(
      executeReservedRemoteAiCall(() => new Promise<never>(() => undefined), 1),
    ).rejects.toThrow("ai-deadline-exceeded");

    const controller = new AbortController();
    controller.abort(new Error("client-disconnected"));
    await expect(
      executeReservedRemoteAiCall(
        async (signal) => {
          const error = new Error(String(signal.reason));
          error.name = "AbortError";
          throw error;
        },
        100,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(remoteAiPosture(readyEnv, 1_001)).toMatchObject({
      completedCalls: 1,
      failedCalls: 1,
      timedOutCalls: 1,
      cancelledCalls: 1,
    });
  });
});
