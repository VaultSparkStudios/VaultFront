import { describe, expect, test } from "vitest";
import type { ClientSendWinnerMessage } from "../../src/core/Schemas";
import {
  buildMatchResultCertificate,
  MatchResultQuorum,
} from "../../src/server/MatchResultCertificate";
import { authorizeArchivedRematchSource } from "../../src/server/RematchAuthorization";

function fixture() {
  const result = {
    type: "winner",
    winner: ["player", "client-a"],
    allPlayersStats: {
      "client-a": { vaultfront: { vaultCaptures: 1n } },
      "client-b": { vaultfront: { vaultCaptures: 0n } },
    },
  } as ClientSendWinnerMessage;
  const quorum = new MatchResultQuorum();
  const activeIPs = new Set(["a", "b", "c"]);
  quorum.attest({
    ip: "a",
    result,
    expectedClientIDs: ["client-a", "client-b"],
    activeIPs,
  });
  const accepted = quorum.attest({
    ip: "b",
    result,
    expectedClientIDs: ["client-a", "client-b"],
    activeIPs,
  });
  if (accepted.status !== "accepted") throw new Error("fixture not accepted");
  const config = { gameMap: "plains", gameType: "private" } as any;
  const certificate = buildMatchResultCertificate({
    gameID: "game-1",
    config,
    turns: [],
    accepted,
  });
  return {
    info: {
      config,
      players: [
        { clientID: "client-a", persistentID: "player-a" },
        { clientID: "client-b", persistentID: "player-b" },
      ],
    },
    telemetry: { resultCertificate: certificate },
  };
}

describe("archived rematch authorization", () => {
  test("binds the actor through a valid result certificate", () => {
    expect(
      authorizeArchivedRematchSource(fixture(), "game-1", "player-a"),
    ).toMatchObject({
      evidence: "archived-participant",
      mapName: "plains",
    });
  });

  test("rejects nonparticipants and certificate tampering", () => {
    expect(
      authorizeArchivedRematchSource(fixture(), "game-1", "outsider"),
    ).toBeNull();
    const tampered = structuredClone(fixture());
    tampered.telemetry.resultCertificate.result.winner = ["player", "client-b"];
    expect(
      authorizeArchivedRematchSource(tampered, "game-1", "player-a"),
    ).toBeNull();
  });
});
