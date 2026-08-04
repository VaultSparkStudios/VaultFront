import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractExpressRoutes } from "../../scripts/lib/route-inventory.mjs";
import { validateMutationRoutePolicies } from "../../scripts/lib/route-policy-coverage.mjs";

const serverDir = resolve(process.cwd(), "src/server");
const routeFiles = readdirSync(serverDir).filter(
  (name) => name === "Worker.ts" || name.endsWith("Router.ts"),
);
const routes = routeFiles.flatMap((name) =>
  extractExpressRoutes(readFileSync(resolve(serverDir, name), "utf8"), name),
);
const catalog = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "config/mutation-route-policies.json"),
    "utf8",
  ),
);

const protectedRoutes = [
  "/api/start_game/:id",
  "/api/vaultfront/match-rating",
  "/api/vaultfront/win-fortune",
  "/api/vaultfront/prediction-league/predict",
  "/api/vaultfront/clan-war/challenge",
  "/api/vaultfront/clan-war/accept",
  "/api/vaultfront/clan-war/decline",
  "/api/vaultfront/season-progress/claim",
  "/api/clans",
  "/api/clans/:clanId/join",
  "/api/clans/leave",
  "/api/tournaments",
  "/api/tournaments/:id/register",
  "/api/tournaments/:id/seed",
  "/api/tournaments/matches/:matchId/report",
] as const;

describe("server-authoritative mutation boundary", () => {
  it.each(protectedRoutes)("requires a verified actor for %s", (route) => {
    const policy = catalog.routes.find(
      (candidate: { method: string; path: string }) =>
        candidate.method === "POST" && candidate.path === route,
    );
    expect(policy, `${route} must have a policy`).toMatchObject({
      auth: "verified-actor",
    });
  });

  it("proves every declared binding against Worker and extracted routers", () => {
    expect(validateMutationRoutePolicies(routes, catalog)).toMatchObject({
      ok: true,
      errors: [],
    });
  });
});
