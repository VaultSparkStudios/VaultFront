import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(
  resolve(process.cwd(), "src/server/Worker.ts"),
  "utf8",
);
const coachSource = readFileSync(
  resolve(process.cwd(), "src/server/CoachDebriefRouter.ts"),
  "utf8",
);

const contracts = [
  {
    route: "/api/vaultfront/match-prophecy",
    order: [
      "cachedProphecy",
      "reserveRemoteAiCall",
      "anthropic.messages.create",
    ],
  },
  {
    route: "/api/vaultfront/match-oracle",
    order: [
      "requireVaultFrontActor",
      "parseMatchOracleRequest",
      "oracleEvidenceCache.get",
      "reserveRemoteAiCall",
      "anthropic.messages.create",
    ],
  },
  {
    route: "/api/vaultfront/dynasty-story",
    order: [
      "requireVaultFrontActor",
      "safeParse(req.body)",
      "loadCertifiedAiContext",
      "reserveRemoteAiCall",
      "anthropic.messages.create",
    ],
  },
  {
    route: "/api/vaultfront/prematch-brief",
    order: [
      "requireVaultFrontActor",
      "aiCacheGet",
      "reserveRemoteAiCall",
      "anthropic.messages.create",
    ],
  },
  {
    route: "/api/vaultfront/match-recap/:gameId",
    order: [
      "requireVaultFrontActor",
      "loadCertifiedAiContext",
      "matchRecapCache.get",
      "reserveRemoteAiCall",
      "anthropic.messages.create",
    ],
  },
  {
    route: "/api/vaultfront/coach-debrief",
    source: coachSource,
    order: [
      "safeParse(req.body)",
      "options.authenticate",
      "options.loadContext",
      "cache.get",
      "reserveRemoteAiCall",
      "anthropic.messages.create",
    ],
  },
] as const;

describe("remote AI reservation ordering contract", () => {
  it.each(contracts)(
    "reserves only after validation/auth/cache for $route",
    ({ route, order, ...contract }) => {
      const source = "source" in contract ? contract.source : workerSource;
      const start = source.indexOf(`"${route}"`);
      expect(start, `${route} must exist`).toBeGreaterThan(-1);
      const segment = source.slice(start, start + 9_000);
      let prior = -1;
      for (const marker of order) {
        const position = segment.indexOf(marker);
        expect(position, `${route}: missing ${marker}`).toBeGreaterThan(prior);
        prior = position;
      }
    },
  );

  it("routes every Worker provider edge through the request-bound executor", () => {
    const source = `${workerSource}\n${coachSource}`;
    const providerCalls = source.match(/anthropic\.messages\.create/g) ?? [];
    const boundedCalls =
      source.match(
        /executeRequestBoundAi\([\s\S]*?anthropic\.messages\.create/g,
      ) ?? [];
    expect(providerCalls.length).toBeGreaterThan(0);
    expect(boundedCalls).toHaveLength(providerCalls.length);
  });
});
