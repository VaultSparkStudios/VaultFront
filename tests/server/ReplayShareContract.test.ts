import { describe, expect, test } from "vitest";
import { ReplayHighlightStore } from "../../src/server/ReplayHighlightStore";
import {
  createReplayShareProjection,
  ReplayShareContractError,
  verifyReplayShareProjection,
} from "../../src/server/ReplayShareContract";
import {
  InMemoryReplayBackend,
  ReplayStore,
  type ReplayManifest,
} from "../../src/server/ReplayStore";

async function signedReplay(gameId = "share-game-1"): Promise<ReplayManifest> {
  const store = new ReplayStore(new InMemoryReplayBackend());
  store.startRecording(gameId, "World", 42, {});
  store.recordTurn(gameId, { turnNumber: 10, intents: [] });
  store.recordTurn(gameId, {
    turnNumber: 80,
    intents: [{ type: "vault_capture" }],
  });
  await store.finishRecording(gameId);
  const manifest = await store.getReplay(gameId);
  if (!manifest) throw new Error("fixture replay did not verify");
  return manifest;
}

describe("ReplayShareContract", () => {
  test("produces a stable content address across fresh projections", async () => {
    const manifest = await signedReplay();
    const first = createReplayShareProjection(
      manifest,
      { kind: "clip", startTurn: 10, endTurn: 80 },
      "https://play.example/",
    );
    const second = createReplayShareProjection(
      structuredClone(manifest),
      { kind: "clip", startTurn: 10, endTurn: 80 },
      "https://play.example",
    );

    expect(second).toEqual(first);
    expect(first.shareUrl).toContain(`clip=${first.shareId}`);
    expect(first.replayEvidenceDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("binds identity to kind and exact signed range", async () => {
    const manifest = await signedReplay();
    const clip = createReplayShareProjection(manifest, {
      kind: "clip",
      startTurn: 10,
      endTurn: 80,
    });
    const highlight = createReplayShareProjection(manifest, {
      kind: "highlight",
      startTurn: 10,
      endTurn: 80,
    });
    expect(highlight.shareId).not.toBe(clip.shareId);
  });

  test("rejects unsigned evidence and ranges beyond the replay", async () => {
    const manifest = await signedReplay();
    expect(() =>
      createReplayShareProjection(
        { ...manifest, signature: undefined },
        { kind: "clip", startTurn: 1, endTurn: 10 },
      ),
    ).toThrowError(ReplayShareContractError);
    expect(() =>
      createReplayShareProjection(manifest, {
        kind: "clip",
        startTurn: 10,
        endTurn: 81,
      }),
    ).toThrowError(/exceeds signed duration 80/);
  });

  test("keeps automatic highlight links stable across store restarts", async () => {
    const manifest = await signedReplay();
    const first = new ReplayHighlightStore().getOrCreate(
      manifest.gameId,
      manifest,
    );
    const second = new ReplayHighlightStore().getOrCreate(
      manifest.gameId,
      structuredClone(manifest),
    );
    expect(second).toEqual(first);
  });

  test("independently rejects a tampered share projection", async () => {
    const manifest = await signedReplay();
    const projection = createReplayShareProjection(
      manifest,
      { kind: "clip", startTurn: 10, endTurn: 80 },
      "https://play.example",
    );
    expect(verifyReplayShareProjection(manifest, projection)).toEqual({
      valid: true,
      reason: "verified",
    });
    expect(
      verifyReplayShareProjection(manifest, {
        ...projection,
        shareId: `${projection.shareId}x`,
      }),
    ).toEqual({ valid: false, reason: "projection-mismatch" });
  });

  test("never serves a cached highlight for altered evidence", async () => {
    const manifest = await signedReplay();
    const store = new ReplayHighlightStore();
    store.getOrCreate(manifest.gameId, manifest);
    const alteredSignature = `${
      manifest.signature?.startsWith("0") ? "1" : "0"
    }${manifest.signature?.slice(1)}`;
    expect(() =>
      store.getOrCreate(manifest.gameId, {
        ...manifest,
        signature: alteredSignature,
      }),
    ).toThrow(/verified signed evidence/);
  });
});
