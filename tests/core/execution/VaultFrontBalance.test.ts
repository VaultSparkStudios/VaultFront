import fs from "node:fs";
import { describe, expect, test } from "vitest";
import authority from "../../../config/vaultfront-balance.v1.json";
import {
  DEFAULT_VAULT_CONVOY_REWARD_TUNING,
  DEFAULT_VAULT_GAMEPLAY_BALANCE,
  DEFAULT_VAULT_PRESSURE_CONFIG,
  planConvoyReward,
  validateVaultFrontBalanceAuthority,
} from "../../../src/core/execution/VaultFrontBalance";
import {
  projectVaultFrontMutatorBalance,
  VAULTFRONT_RUNTIME_BALANCE,
} from "../../../src/core/execution/VaultFrontRuntimeBalance";

describe("VaultFront balance authority", () => {
  test("uses the versioned JSON authority without duplicated defaults", () => {
    expect(DEFAULT_VAULT_CONVOY_REWARD_TUNING).toEqual(authority.tuning);
    expect(Object.isFrozen(DEFAULT_VAULT_CONVOY_REWARD_TUNING)).toBe(true);
    expect(DEFAULT_VAULT_PRESSURE_CONFIG).toEqual(authority.pressure);
    expect(Object.isFrozen(DEFAULT_VAULT_PRESSURE_CONFIG)).toBe(true);
    expect(DEFAULT_VAULT_GAMEPLAY_BALANCE).toEqual(authority.gameplay);
    expect(Object.isFrozen(DEFAULT_VAULT_GAMEPLAY_BALANCE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_VAULT_GAMEPLAY_BALANCE.defense)).toBe(true);
  });

  test("rejects contradictory gameplay authority before simulation starts", () => {
    const invalid = structuredClone(authority);
    invalid.gameplay.defense.beaconTriggerCost =
      invalid.gameplay.defense.beaconChargeCap + 1;
    invalid.gameplay.mapEvents.minIntervalTicks =
      invalid.gameplay.mapEvents.maxIntervalTicks + 1;

    expect(validateVaultFrontBalanceAuthority(invalid)).toEqual(
      expect.arrayContaining([
        "gameplay.mapEvents interval bounds are inverted",
        "gameplay.defense trigger exceeds charge cap",
      ]),
    );
  });
  test("preserves every existing mutator boundary in the runtime projection", () => {
    expect(VAULTFRONT_RUNTIME_BALANCE).toMatchObject({
      vaultCaptureTicks: 90,
      vaultCooldownTicks: 650,
      vaultPassiveGoldPerMinute: 75_000n,
      jamBreakerGoldCost: 115_000n,
      jamBreakerCooldownTicks: 900,
    });
    expect(projectVaultFrontMutatorBalance("none")).toMatchObject({
      vaultCaptureTicks: 90,
      vaultCooldownTicks: 650,
      vaultPassiveIncomeIntervalTicks: 600,
      vaultPassiveGoldPerMinute: 75_000n,
      beaconPulseCooldownTicks: 320,
      jamBreakerCooldownTicks: 900,
      escortDurationTicks: 600,
      executionChainWindowTicks: 1_500,
    });
    expect(
      projectVaultFrontMutatorBalance("accelerated_cooldowns"),
    ).toMatchObject({
      vaultCooldownTicks: 487,
      beaconPulseCooldownTicks: 240,
      jamBreakerCooldownTicks: 675,
      escortDurationTicks: 460,
    });
    expect(projectVaultFrontMutatorBalance("blitz").vaultCaptureTicks).toBe(54);
    expect(projectVaultFrontMutatorBalance("rally_point")).toMatchObject({
      vaultPassiveIncomeIntervalTicks: 300,
      vaultPassiveGoldPerMinute: 150_000n,
    });
    expect(
      projectVaultFrontMutatorBalance("execution_rush")
        .executionChainWindowTicks,
    ).toBe(3_000);
  });
  test("pins a reproducible boundary scenario and multiplier clamp", () => {
    const result = planConvoyReward({
      ownerStrength: 1,
      averageStrength: 1,
      distance: 70,
      routeRisk: 0.8,
      strengthMultiplier: 1,
      phaseMultiplier: 1,
      rewardScale: 1,
    });
    expect(result).toMatchObject({
      goldReward: 182_272n,
      troopsReward: 1_763,
      rewardMultiplier: 1.28,
      baselineGold: 120_000,
      distanceGold: 320,
    });
    expect(
      planConvoyReward({
        ownerStrength: 2.2,
        averageStrength: 1.8,
        distance: 140,
        routeRisk: 1,
        strengthMultiplier: 1.22,
        phaseMultiplier: 1.08,
        rewardScale: 1.5,
      }).rewardMultiplier,
    ).toBe(authority.tuning.rewardMultiplierMax);
  });

  test("publishes a counterexample-free deterministic envelope", () => {
    const envelope = JSON.parse(
      fs.readFileSync("public/balance-envelope.json", "utf8"),
    );
    expect(envelope).toMatchObject({
      status: "verified",
      scenarioCount: 28_125,
      counterexamples: [],
      pressureRules: authority.pressure,
      gameplayRules: authority.gameplay,
      authorityFingerprint: envelope.tuningDigest,
    });
    expect(envelope.scenarioDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(envelope.tuningDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
