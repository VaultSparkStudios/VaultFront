import { describe, expect, it } from "vitest";
import {
  evaluateRouteAuthorization,
  routePolicyManifest,
  validateRoutePolicyManifest,
} from "../../src/server/RoutePolicyManifest";

describe("typed route policy manifest", () => {
  it("is unique and secure-by-construction", () => {
    expect(validateRoutePolicyManifest()).toEqual([]);
    expect(routePolicyManifest.length).toBeGreaterThanOrEqual(8);
  });

  it("never treats a non-empty header as game creation authority", () => {
    expect(
      evaluateRouteAuthorization("create-game", { hasIdentity: true }),
    ).toMatchObject({
      allowed: false,
      status: 401,
    });
    expect(
      evaluateRouteAuthorization("create-game", { hasAdminToken: true }),
    ).toMatchObject({ allowed: true });
  });

  it("binds every experiment mutation to an exact verified-actor route", () => {
    for (const experiment of ["dock", "recap", "runtime"] as const) {
      const policy = routePolicyManifest.find(
        (entry) => entry.id === `experiment-${experiment}-event`,
      );
      expect(policy).toMatchObject({
        method: "POST",
        path: `/api/vaultfront/ab/${experiment}/event`,
        auth: "verified-actor",
        mutation: true,
        evidence: "assignment-ledger",
      });
      expect(
        evaluateRouteAuthorization(`experiment-${experiment}-event`, {}),
      ).toMatchObject({ allowed: false, status: 401 });
      expect(
        evaluateRouteAuthorization(`experiment-${experiment}-event`, {
          hasVerifiedActor: true,
        }),
      ).toMatchObject({ allowed: true });
    }
  });

  it("treats Mastery Doctrine selection as a verified actor mutation", () => {
    expect(
      routePolicyManifest.find(
        (route) => route.id === "mastery-doctrine-select",
      ),
    ).toMatchObject({
      method: "POST",
      path: "/api/vaultfront/mastery-doctrine",
      auth: "verified-actor",
      mutation: true,
    });
    expect(
      evaluateRouteAuthorization("mastery-doctrine-select", {}),
    ).toMatchObject({
      allowed: false,
      status: 401,
    });
  });
});
