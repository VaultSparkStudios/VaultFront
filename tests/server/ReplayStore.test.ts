import { afterEach, beforeEach, describe, expect, it } from "vitest";
import balanceEnvelope from "../../public/balance-envelope.json";
import {
  getReplayIntegrityPosture,
  InMemoryReplayBackend,
  PostgresReplayBackend,
  ReplayStore,
  verifyReplayBalanceCompatibility,
  verifyReplaySignature,
} from "../../src/server/ReplayStore";
import {
  buildVaultFrontBalanceIdentity,
  vaultFrontBalanceIdentity,
} from "../../src/server/VaultFrontBalanceIdentity";

const originalEnv = {
  replaySecret: process.env.REPLAY_SECRET,
  gameEnv: process.env.GAME_ENV,
  nodeEnv: process.env.NODE_ENV,
};

function restore(
  name: "REPLAY_SECRET" | "GAME_ENV" | "NODE_ENV",
  value: string | undefined,
) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("ReplayStore verified consumption", () => {
  beforeEach(() => {
    process.env.REPLAY_SECRET = "focused-test-replay-key";
    process.env.GAME_ENV = "dev";
  });

  afterEach(() => {
    restore("REPLAY_SECRET", originalEnv.replaySecret);
    restore("GAME_ENV", originalEnv.gameEnv);
    restore("NODE_ENV", originalEnv.nodeEnv);
  });

  it("returns signed manifests and rejects a tampered payload at every load", async () => {
    const backend = new InMemoryReplayBackend();
    const store = new ReplayStore(backend);
    store.startRecording("game0001", "World", 42, { gameMode: "ffa" });
    store.recordTurn("game0001", {
      turnNumber: 1,
      intents: [{ type: "spawn" }],
    });
    await store.finishRecording("game0001");

    expect(await store.getReplay("game0001")).not.toBeNull();
    const raw = await backend.load("game0001");
    expect(raw).not.toBeNull();
    raw!.turns![0].intents.push({ type: "forged-achievement" });
    await backend.save("game0001", raw!);

    expect(await store.getReplay("game0001")).toBeNull();
    expect(await store.listReplays()).toEqual([]);
  });

  it("rejects a replay from a different balance authority despite a valid HMAC", async () => {
    const backend = new InMemoryReplayBackend();
    const previousIdentity = buildVaultFrontBalanceIdentity({
      authority: "vaultfront-gameplay-balance-v0",
      gameplay: { simulation: { turnIntervalMs: 100 } },
    });
    const previousRuntime = new ReplayStore(backend, previousIdentity);
    previousRuntime.startRecording("game-balance-v0", "World", 11, {
      gameMode: "Free For All",
    });
    await previousRuntime.finishRecording("game-balance-v0");

    const signed = await backend.load("game-balance-v0");
    expect(signed && verifyReplaySignature(signed)).toBe(true);
    expect(signed && verifyReplayBalanceCompatibility(signed)).toMatchObject({
      compatible: false,
      status: "incompatible",
      recorded: previousIdentity,
      expected: vaultFrontBalanceIdentity,
    });
    expect(
      await new ReplayStore(backend).getReplay("game-balance-v0"),
    ).toBeNull();
  });

  it("distinguishes legacy manifests and matches the public authority fingerprint", async () => {
    const legacy = {
      gameId: "legacy-game",
      mapName: "World",
      seed: 1,
      configSnapshot: {},
      startedAt: 1,
      durationTurns: 0,
      intents: [],
    } as any;
    expect(verifyReplayBalanceCompatibility(legacy)).toMatchObject({
      compatible: false,
      status: "legacy",
      recorded: null,
    });
    expect(vaultFrontBalanceIdentity.authorityFingerprint).toBe(
      balanceEnvelope.authorityFingerprint,
    );
  });

  it("fails closed outside development and test when the key is absent", async () => {
    delete process.env.REPLAY_SECRET;
    process.env.GAME_ENV = "prod";
    process.env.NODE_ENV = "production";
    const store = new ReplayStore(new InMemoryReplayBackend());
    store.startRecording("game0002", "World", 7, {});

    expect(getReplayIntegrityPosture()).toMatchObject({
      status: "missing",
      canSignAndVerify: false,
    });
    await expect(store.finishRecording("game0002")).rejects.toThrow(
      "REPLAY_SECRET is required",
    );
  });

  it("round-trips binary intents through the shared PostgreSQL representation", async () => {
    let persisted: Record<string, unknown> | null = null;
    const database = {
      query: async (sql: string, parameters: unknown[]) => {
        if (sql.includes("INSERT INTO replay_manifests")) {
          persisted = JSON.parse(String(parameters[2]));
          return { rows: [] };
        }
        if (sql.includes("SELECT manifest")) {
          return { rows: persisted ? [{ manifest: persisted }] : [] };
        }
        if (sql.includes("DELETE FROM replay_manifests")) return { rows: [] };
        return {
          rows: [{ game_id: "shared-game", started_at_ms: "1000" }],
        };
      },
    };
    const writer = new ReplayStore(new PostgresReplayBackend(database as any));
    writer.startRecording("shared-game", "World", 12, {});
    writer.recordIntent("shared-game", 1, 3, Uint8Array.from([1, 2, 255]));
    await writer.finishRecording("shared-game");

    const reader = new ReplayStore(new PostgresReplayBackend(database as any));
    const replay = await reader.getReplay("shared-game");
    expect(Array.from(replay?.intents[0].serialized ?? [])).toEqual([
      1, 2, 255,
    ]);
    expect(await reader.listReplays()).toEqual([
      { gameId: "shared-game", startedAt: 1000 },
    ]);
  });
});
