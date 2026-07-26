import { createHash } from "crypto";
import { verifyReplaySignature, type ReplayManifest } from "./ReplayStore";

export const REPLAY_SHARE_CONTRACT_VERSION = "vaultfront-replay-share-v1";
export type ReplayShareKind = "highlight" | "clip";

export interface ReplayShareProjection {
  contractVersion: typeof REPLAY_SHARE_CONTRACT_VERSION;
  gameId: string;
  shareId: string;
  kind: ReplayShareKind;
  startTurn: number;
  endTurn: number;
  replayDurationTurns: number;
  replayEvidenceDigest: string;
  shareUrl: string;
}

export interface ReplayShareVerification {
  valid: boolean;
  reason: "verified" | "projection-mismatch" | "invalid-replay";
}

export class ReplayShareContractError extends Error {
  constructor(
    readonly code:
      "unverified-replay" | "invalid-range" | "range-outside-replay",
    message: string,
  ) {
    super(message);
    this.name = "ReplayShareContractError";
  }
}

function replayDuration(manifest: ReplayManifest): number {
  return Math.max(
    0,
    manifest.durationTurns,
    ...(manifest.turns ?? []).map((turn) => turn.turnNumber),
  );
}

export function createReplayShareProjection(
  manifest: ReplayManifest,
  window: {
    kind: ReplayShareKind;
    startTurn: number;
    endTurn: number;
  },
  playBase = process.env.PLAY_BASE_URL ??
    "https://play-vaultfront.vaultsparkstudios.com",
): ReplayShareProjection {
  if (!verifyReplaySignature(manifest) || !manifest.signature) {
    throw new ReplayShareContractError(
      "unverified-replay",
      "Replay sharing requires verified signed evidence",
    );
  }
  if (
    !Number.isSafeInteger(window.startTurn) ||
    !Number.isSafeInteger(window.endTurn) ||
    window.startTurn < 0 ||
    window.endTurn < window.startTurn ||
    (window.kind === "clip" && window.endTurn === window.startTurn)
  ) {
    throw new ReplayShareContractError(
      "invalid-range",
      "Replay share range is invalid",
    );
  }

  const duration = replayDuration(manifest);
  if (window.startTurn > duration || window.endTurn > duration) {
    throw new ReplayShareContractError(
      "range-outside-replay",
      `Replay share range exceeds signed duration ${duration}`,
    );
  }

  const replayEvidenceDigest = createHash("sha256")
    .update(manifest.signature)
    .digest("hex");
  const shareId = createHash("sha256")
    .update(
      [
        REPLAY_SHARE_CONTRACT_VERSION,
        replayEvidenceDigest,
        manifest.gameId,
        window.kind,
        window.startTurn,
        window.endTurn,
      ].join("\u0000"),
    )
    .digest("base64url")
    .slice(0, 20);
  const query = new URLSearchParams({
    [window.kind]: shareId,
    start: String(window.startTurn),
    end: String(window.endTurn),
  });

  return {
    contractVersion: REPLAY_SHARE_CONTRACT_VERSION,
    gameId: manifest.gameId,
    shareId,
    kind: window.kind,
    startTurn: window.startTurn,
    endTurn: window.endTurn,
    replayDurationTurns: duration,
    replayEvidenceDigest,
    shareUrl: `${playBase.trim().replace(/\/+$/, "")}/replay/${encodeURIComponent(
      manifest.gameId,
    )}?${query.toString()}`,
  };
}

export function verifyReplayShareProjection(
  manifest: ReplayManifest,
  projection: ReplayShareProjection,
  playBase = new URL(projection.shareUrl).origin,
): ReplayShareVerification {
  let expected: ReplayShareProjection;
  try {
    expected = createReplayShareProjection(
      manifest,
      {
        kind: projection.kind,
        startTurn: projection.startTurn,
        endTurn: projection.endTurn,
      },
      playBase,
    );
  } catch {
    return { valid: false, reason: "invalid-replay" };
  }
  const valid =
    expected.contractVersion === projection.contractVersion &&
    expected.gameId === projection.gameId &&
    expected.shareId === projection.shareId &&
    expected.replayDurationTurns === projection.replayDurationTurns &&
    expected.replayEvidenceDigest === projection.replayEvidenceDigest &&
    expected.shareUrl === projection.shareUrl;
  return {
    valid,
    reason: valid ? "verified" : "projection-mismatch",
  };
}
