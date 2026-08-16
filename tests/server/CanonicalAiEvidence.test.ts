import { describe, expect, it, vi } from "vitest";
import type { ClientSendWinnerMessage } from "../../src/core/Schemas";
import {
  AiDeadlineError,
  BoundedTtlCache,
  buildCanonicalAiEvidence,
  buildCanonicalAiResponseReceipt,
  CanonicalAiEvidenceError,
  parseCoachProviderOutput,
  parseOracleProviderOutput,
  parseRecapProviderOutput,
  verifyCanonicalAiResponseReceipt,
  withAiDeadline,
} from "../../src/server/CanonicalAiEvidence";
import {
  buildMatchResultCertificate,
  canonicalEvidenceDigest,
  MatchResultQuorum,
} from "../../src/server/MatchResultCertificate";

function certificate() {
  const roster = ["client01", "client02"];
  const result: ClientSendWinnerMessage = {
    type: "winner",
    winner: ["player", "client01"],
    allPlayersStats: {
      client01: { vaultfront: { vaultCaptures: 2n } },
      client02: { vaultfront: { vaultCaptures: 1n } },
    },
  };
  const quorum = new MatchResultQuorum();
  const activeIPs = new Set(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
  quorum.attest({
    ip: "10.0.0.1",
    result,
    expectedClientIDs: roster,
    activeIPs,
  });
  const accepted = quorum.attest({
    ip: "10.0.0.2",
    result,
    expectedClientIDs: roster,
    activeIPs,
  });
  if (accepted.status !== "accepted") throw new Error("fixture not accepted");
  return buildMatchResultCertificate({
    gameID: "game1234",
    config: { gameMap: "plains", gameType: "private" } as any,
    turns: [
      { turnNumber: 0, intents: [], hash: 11 },
      { turnNumber: 1, intents: [], hash: 22 },
    ] as any,
    accepted,
  });
}

describe("canonical AI evidence", () => {
  it("uses one requester-neutral recap identity after authorization", () => {
    const certified = certificate();
    const canonicalInputs = { result: certified.result };
    const explicit = buildCanonicalAiEvidence({
      feature: "recap",
      certificate: certified,
      canonicalInputs,
      requester: null,
    });
    const omitted = buildCanonicalAiEvidence({
      feature: "recap",
      certificate: certified,
      canonicalInputs,
    });
    expect(explicit.requester).toBeNull();
    expect(explicit.cacheKey).toBe(omitted.cacheKey);
  });

  it("refuses tampered certificates before producing evidence", () => {
    const tampered = structuredClone(certificate());
    tampered.result.allPlayersStats.client01 = {
      vaultfront: { vaultCaptures: 999n },
    };

    expect(() =>
      buildCanonicalAiEvidence({
        feature: "recap",
        certificate: tampered,
        canonicalInputs: { locale: "en-US" },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CanonicalAiEvidenceError>>({
        code: "invalid-result-certificate",
      }),
    );
  });

  it("binds cache keys to every canonical input, feature, and requester", () => {
    const certified = certificate();
    const base = buildCanonicalAiEvidence({
      feature: "coach",
      certificate: certified,
      requester: "player:alpha",
      canonicalInputs: {
        players: [
          { id: "client01", elo: 1200 },
          { id: "client02", elo: 1300 },
        ],
      },
    });
    const changedElo = buildCanonicalAiEvidence({
      feature: "coach",
      certificate: certified,
      requester: "player:alpha",
      canonicalInputs: {
        players: [
          { id: "client01", elo: 1201 },
          { id: "client02", elo: 1300 },
        ],
      },
    });
    const changedRequester = buildCanonicalAiEvidence({
      feature: "coach",
      certificate: certified,
      requester: "player:beta",
      canonicalInputs: {
        players: [
          { id: "client01", elo: 1200 },
          { id: "client02", elo: 1300 },
        ],
      },
    });
    const changedFeature = buildCanonicalAiEvidence({
      feature: "oracle",
      certificate: certified,
      requester: "player:alpha",
      canonicalInputs: {
        players: [
          { id: "client01", elo: 1200 },
          { id: "client02", elo: 1300 },
        ],
      },
    });

    expect(
      new Set([
        base.cacheKey,
        changedElo.cacheKey,
        changedRequester.cacheKey,
        changedFeature.cacheKey,
      ]).size,
    ).toBe(4);
    expect(base.canonicalInputsDigest).toBe(
      canonicalEvidenceDigest({
        players: [
          { id: "client01", elo: 1200 },
          { id: "client02", elo: 1300 },
        ],
      }),
    );
    expect(Object.isFrozen(base)).toBe(true);
  });

  it("requires requester identity for player-specific coaching", () => {
    expect(() =>
      buildCanonicalAiEvidence({
        feature: "coach",
        certificate: certificate(),
        canonicalInputs: {},
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CanonicalAiEvidenceError>>({
        code: "coach-requester-required",
      }),
    );
  });

  it("emits a tamper-evident receipt over validated provider output", () => {
    const evidence = buildCanonicalAiEvidence({
      feature: "coach",
      certificate: certificate(),
      requester: "player:alpha",
      canonicalInputs: { strategy: "escort" },
    });
    const output = [
      { tick: 10, decision: "Held", optimal: "Escort", why: "Tempo" },
      { tick: 20, decision: "Waited", optimal: "Surge", why: "Window" },
    ];
    const receipt = buildCanonicalAiResponseReceipt({
      evidence,
      output,
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      generatedAt: "2026-07-18T12:00:00.000Z",
    });
    expect(verifyCanonicalAiResponseReceipt(receipt, evidence, output)).toBe(
      true,
    );
    expect(
      verifyCanonicalAiResponseReceipt(receipt, evidence, [
        ...output.slice(0, 1),
        { ...output[1], why: "Injected" },
      ]),
    ).toBe(false);
    expect(receipt.receiptDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("bounded AI cache", () => {
  it("expires entries, enforces LRU capacity, and freezes cached output", () => {
    let now = 1_000;
    const cache = new BoundedTtlCache<{ value: number }>({
      maxEntries: 2,
      ttlMs: 100,
      now: () => now,
    });
    cache.set("a", { value: 1 });
    cache.set("b", { value: 2 });
    expect(Object.isFrozen(cache.get("a"))).toBe(true); // a becomes newest
    cache.set("c", { value: 3 });
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).toEqual({ value: 1 });
    now = 1_100;
    expect(cache.get("a")).toBeNull();
    expect(cache.size).toBe(0);
  });
});

describe("strict provider output validation", () => {
  it("accepts exact oracle output and rejects roster drift or extra fields", () => {
    const valid = JSON.stringify({
      predictions: [
        {
          playerId: "client01",
          deltaIfWin: 16,
          deltaIfLoss: -16,
          threat: "client02",
        },
        {
          playerId: "client02",
          deltaIfWin: 16,
          deltaIfLoss: -16,
          threat: "client01",
        },
      ],
    });
    expect(
      parseOracleProviderOutput(valid, ["client01", "client02"]).predictions,
    ).toHaveLength(2);
    expect(() =>
      parseOracleProviderOutput(valid, ["client01", "client03"]),
    ).toThrowError(
      expect.objectContaining<Partial<CanonicalAiEvidenceError>>({
        code: "provider-output-oracle-roster-mismatch",
      }),
    );
    expect(() =>
      parseOracleProviderOutput(
        JSON.stringify({
          predictions: [
            {
              playerId: "client01",
              deltaIfWin: 16,
              deltaIfLoss: -16,
              injected: true,
            },
            { playerId: "client02", deltaIfWin: 16, deltaIfLoss: -16 },
          ],
        }),
      ),
    ).toThrow();
  });

  it("rejects active-markup recaps, markdown JSON, and impossible coach ticks", () => {
    expect(() =>
      parseRecapProviderOutput(
        "A hard-fought battle ended decisively. <script>alert(1)</script> The victor prevailed.",
      ),
    ).toThrow();
    expect(() => parseCoachProviderOutput("```json\n[]\n```", 20)).toThrowError(
      expect.objectContaining<Partial<CanonicalAiEvidenceError>>({
        code: "provider-output-markdown-wrapper",
      }),
    );
    expect(() =>
      parseCoachProviderOutput(
        JSON.stringify([
          {
            tick: 12,
            decision: "Held the lane",
            optimal: "Escort",
            why: "Preserves tempo",
          },
          {
            tick: 99,
            decision: "Late surge",
            optimal: "Surge earlier",
            why: "Uses the opening",
          },
        ]),
        20,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<CanonicalAiEvidenceError>>({
        code: "provider-output-coach-tick-mismatch",
      }),
    );
  });
});

describe("AI deadline", () => {
  it("aborts and rejects providers that exceed the hard deadline", async () => {
    vi.useFakeTimers();
    const operation = vi.fn(
      (signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const pending = expect(
      withAiDeadline(operation, 100),
    ).rejects.toBeInstanceOf(AiDeadlineError);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    vi.useRealTimers();
  });
});
