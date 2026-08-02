import { describe, expect, test, vi } from "vitest";
import { registerSeasonCommunityRoutes } from "../../src/server/SeasonCommunityRouter";

function response() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function harness(authenticated = true) {
  const routes = new Map<string, any>();
  const app = {
    get: (path: string, ...handlers: any[]) =>
      routes.set(`GET ${path}`, handlers.at(-1)),
    post: (path: string, ...handlers: any[]) =>
      routes.set(`POST ${path}`, handlers.at(-1)),
  };
  const recordVote = vi.fn(async (candidateKey: string, actorId: string) => ({
    accepted: true,
    reason: "accepted" as const,
    candidateKey,
    effectiveWeek: 202631,
    durability: "postgres" as const,
    receiptDigest: `sha256:${"a".repeat(64)}`,
  }));
  registerSeasonCommunityRoutes(app, {
    authenticate: async (_req, res) => {
      if (authenticated) return { persistentId: "actor-bound" };
      res.status(401).json({ error: "Authenticated play token required" });
      return null;
    },
    getStatus: vi.fn(() => ({ currentMutator: { key: "blitz" } }) as any),
    recordVote,
  });
  return { routes, recordVote };
}

describe("SeasonCommunityRouter", () => {
  test("binds the ballot to the authenticated actor", async () => {
    const { routes, recordVote } = harness();
    const res = response();
    await routes.get("POST /api/mutator-vote")(
      { body: { candidateKey: "blitz" } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(recordVote).toHaveBeenCalledWith("blitz", "actor-bound");
    expect(res.body).toMatchObject({ accepted: true, durability: "postgres" });
  });

  test("rejects caller-authored identity and unauthenticated ballots", async () => {
    const accepted = harness();
    const forged = response();
    await accepted.routes.get("POST /api/mutator-vote")(
      { body: { candidateKey: "blitz", voterId: "forged" } },
      forged,
    );
    expect(forged.statusCode).toBe(400);
    expect(accepted.recordVote).not.toHaveBeenCalled();

    const anonymous = harness(false);
    const denied = response();
    await anonymous.routes.get("POST /api/mutator-vote")(
      { body: { candidateKey: "blitz" } },
      denied,
    );
    expect(denied.statusCode).toBe(401);
    expect(anonymous.recordVote).not.toHaveBeenCalled();
  });
});
