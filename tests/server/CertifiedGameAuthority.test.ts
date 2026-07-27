import { describe, expect, it, vi } from "vitest";
import type {
  GameRecord,
  MatchResultCertificate,
} from "../../src/core/Schemas";

vi.mock("../../src/server/MatchResultCertificate", () => ({
  verifyMatchResultCertificate: () => true,
}));

import {
  certificateBindsPersistentIds,
  certifiedWinnerPersistentIds,
  certifyArchivedGame,
} from "../../src/server/CertifiedGameAuthority";

function record(gameID = "game-1") {
  const certificate = {
    gameID,
    certificateId: "cert-1",
    result: { winner: ["player", "client-a"] },
  } as unknown as MatchResultCertificate;
  return {
    info: {
      players: [
        { clientID: "client-a", persistentID: "player-a" },
        { clientID: "client-b", persistentID: "player-b" },
      ],
    },
    telemetry: { resultCertificate: certificate },
  } as unknown as GameRecord;
}

describe("CertifiedGameAuthority", () => {
  it("binds the verified winner and both persistent participants", () => {
    const result = certifyArchivedGame("game-1", record());
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(certifiedWinnerPersistentIds(result)).toEqual(["player-a"]);
    expect(
      certificateBindsPersistentIds(result, ["player-a", "player-b"]),
    ).toBe(true);
  });

  it("rejects a certificate replayed under another game id", () => {
    expect(certifyArchivedGame("game-2", record())).toEqual({
      error: "Verified result certificate required.",
    });
  });
});
