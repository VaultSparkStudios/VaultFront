import { describe, expect, it } from "vitest";
import { classifyEmailRouting } from "../../scripts/configure-email-routing.mjs";

const destination = {
  email: "founder@vaultsparkstudios.com",
  verified: true,
};

describe("VaultFront email-routing configurator", () => {
  it("recognizes an exact healthy route", () => {
    const result = classifyEmailRouting({
      destination,
      settings: { enabled: true, status: "ready" },
      mx: [{ content: "route1.mx.cloudflare.net", priority: 5 }],
      rules: [
        {
          id: "contact-rule",
          enabled: true,
          matchers: [
            { type: "literal", field: "to", value: "contact@vaultfront.io" },
          ],
          actions: [
            { type: "forward", value: ["founder@vaultsparkstudios.com"] },
          ],
        },
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(result.routingReady).toBe(true);
    expect(result.correctRuleId).toBe("contact-rule");
  });

  it("fails closed on foreign MX and a conflicting exact rule", () => {
    const result = classifyEmailRouting({
      destination,
      settings: { enabled: false, status: "disabled" },
      mx: [{ content: "mx.example.net", priority: 10 }],
      rules: [
        {
          id: "wrong-rule",
          enabled: true,
          matchers: [
            { type: "literal", field: "to", value: "contact@vaultfront.io" },
          ],
          actions: [{ type: "forward", value: ["other@example.com"] }],
        },
      ],
    });

    expect(result.blockers).toHaveLength(2);
    expect(result.conflictingRuleIds).toEqual(["wrong-rule"]);
    expect(result.foreignMx).toHaveLength(1);
  });

  it("requires the founder destination to be registered and verified", () => {
    const result = classifyEmailRouting({
      destination: null,
      settings: { enabled: false, status: "disabled" },
      mx: [],
      rules: [],
    });

    expect(result.destinationReady).toBe(false);
    expect(result.blockers).toEqual([
      "destination is not registered: founder@vaultsparkstudios.com",
    ]);
  });
});
