import { describe, expect, test } from "vitest";
import { inspectVaultFrontBalanceAuthority } from "../../scripts/check-vaultfront-balance-authority.mjs";

describe("VaultFront gameplay balance authority", () => {
  test("binds every gameplay domain and the public release fingerprint", () => {
    const result = inspectVaultFrontBalanceAuthority(process.cwd());

    expect(result).toMatchObject({
      ok: true,
      authority: "vaultfront-gameplay-balance-v1",
      authorityFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      errors: [],
    });
    expect(result.gameplaySections).toEqual(
      expect.arrayContaining([
        "vault",
        "defense",
        "comeback",
        "economicWarfare",
        "mapEvents",
        "ai",
        "rewardDynamics",
        "mutators",
      ]),
    );
  });
});
