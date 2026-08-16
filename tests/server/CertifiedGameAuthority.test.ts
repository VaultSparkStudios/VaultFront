import { describe, expect, it, vi } from "vitest";
import type {
  GameRecord,
  MatchResultCertificate,
} from "../../src/core/Schemas";

vi.mock("../../src/server/MatchResultCertificate", () => ({
  verifyMatchResultCertificate: () => true,
}));

import {
  authorizeCertifiedFortuneAward,
  certificateBindsPersistentIds,
  certifiedWinnerPersistentIds,
  certifyArchivedGame,
} from "../../src/server/CertifiedGameAuthority";

function record(gameID = "game-1") {
  const certificate = {
    gameID,
    certificateId: "cert-1",
    result: {
      winner: ["player", "client-a"],
      allPlayersStats: {
        "client-a": {},
        "client-b": {},
      },
    },
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
  it("authorizes only a certified winning participant for Fortune", () => {
    expect(
      authorizeCertifiedFortuneAward("game-1", "player-a", record()),
    ).toEqual({ ok: true, certificateId: "cert-1" });
    expect(
      authorizeCertifiedFortuneAward("game-1", "player-b", record()),
    ).toEqual({ ok: false, reason: "not-winner" });
    expect(
      authorizeCertifiedFortuneAward("game-1", "outsider", record()),
    ).toEqual({ ok: false, reason: "nonparticipant" });
    expect(
      authorizeCertifiedFortuneAward("invented", "player-a", record()),
    ).toEqual({ ok: false, reason: "uncertified-game" });
  });

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

  it("rejects an archived roster changed after certificate issuance", () => {
    const tampered = record();
    tampered.info.players[1].clientID = "client-c";

    expect(certifyArchivedGame("game-1", tampered)).toEqual({
      error: "Archived roster does not match result certificate.",
    });
  });

  it("rejects duplicate archived client and persistent identities", () => {
    const duplicateClient = record();
    duplicateClient.info.players[1].clientID = "client-a";
    expect(certifyArchivedGame("game-1", duplicateClient)).toEqual({
      error: "Archived roster does not match result certificate.",
    });

    const duplicatePersistent = record();
    duplicatePersistent.info.players[1].persistentID = "player-a";
    expect(certifyArchivedGame("game-1", duplicatePersistent)).toEqual({
      error: "Archived roster has duplicate persistent identities.",
    });
  });

  it("fails closed when any team winner lacks a persistent mapping", () => {
    const partialTeam = record();
    partialTeam.telemetry!.resultCertificate!.result.winner = [
      "team",
      "allies",
      "client-a",
      "client-b",
    ];
    partialTeam.info.players[1].persistentID = null;

    const result = certifyArchivedGame("game-1", partialTeam);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(certifiedWinnerPersistentIds(result)).toEqual([]);
  });

  it("fails closed when a winner repeats a client identity", () => {
    const duplicateWinner = record();
    duplicateWinner.telemetry!.resultCertificate!.result.winner = [
      "team",
      "allies",
      "client-a",
      "client-a",
    ];

    const result = certifyArchivedGame("game-1", duplicateWinner);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(certifiedWinnerPersistentIds(result)).toEqual([]);
  });
});
