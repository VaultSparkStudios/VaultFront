#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VAULTFRONT_BALANCE_AUTHORITY as authority,
  DEFAULT_VAULT_GAMEPLAY_BALANCE as gameplayRules,
  planConvoyReward,
  DEFAULT_VAULT_PRESSURE_CONFIG as pressureRules,
  DEFAULT_VAULT_CONVOY_REWARD_TUNING as tuning,
  type ConvoyRewardInputs,
} from "../src/core/execution/VaultFrontBalance";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const counterexamples: Array<{ invariant: string; input: unknown }> = [];
const scenarios: Array<
  ConvoyRewardInputs & {
    goldReward: string;
    troopsReward: number;
    rewardMultiplier: number;
  }
> = [];
const envelope = authority.envelope;

const plan = (input: ConvoyRewardInputs) => planConvoyReward(input, tuning);
const fail = (invariant: string, input: unknown) =>
  counterexamples.push({ invariant, input });

if (!Number.isInteger(pressureRules.threshold) || pressureRules.threshold < 2) {
  fail("pressure-threshold", pressureRules);
}
if (
  !Number.isInteger(pressureRules.breachWindowDurationTicks) ||
  pressureRules.breachWindowDurationTicks <= 0
) {
  fail("pressure-window", pressureRules);
}

for (const ownerStrength of envelope.ownerStrength) {
  for (const averageStrength of envelope.averageStrength) {
    for (const strengthMultiplier of envelope.strengthMultiplier) {
      for (const phaseMultiplier of envelope.phaseMultiplier) {
        for (const rewardScale of envelope.rewardScale) {
          for (const routeRisk of envelope.routeRisk) {
            let previous: ReturnType<typeof plan> | null = null;
            for (const distance of envelope.distance) {
              const input = {
                ownerStrength,
                averageStrength,
                distance,
                routeRisk,
                strengthMultiplier,
                phaseMultiplier,
                rewardScale,
              };
              const result = plan(input);
              scenarios.push({
                ...input,
                goldReward: result.goldReward.toString(),
                troopsReward: result.troopsReward,
                rewardMultiplier: result.rewardMultiplier,
              });
              if (
                result.rewardMultiplier < tuning.rewardMultiplierMin ||
                result.rewardMultiplier > tuning.rewardMultiplierMax
              )
                fail("multiplier-clamp", input);
              if (
                result.goldReward < 0n ||
                result.troopsReward < tuning.minTroopsReward
              )
                fail("non-negative-floor", input);
              if (
                previous &&
                (result.goldReward < previous.goldReward ||
                  result.troopsReward < previous.troopsReward)
              )
                fail("distance-monotonicity", input);
              previous = result;
            }
          }
          for (const distance of envelope.distance) {
            let previous: ReturnType<typeof plan> | null = null;
            for (const routeRisk of envelope.routeRisk) {
              const input = {
                ownerStrength,
                averageStrength,
                distance,
                routeRisk,
                strengthMultiplier,
                phaseMultiplier,
                rewardScale,
              };
              const result = plan(input);
              if (
                previous &&
                (result.goldReward < previous.goldReward ||
                  result.troopsReward < previous.troopsReward)
              )
                fail("risk-monotonicity", input);
              previous = result;
            }
          }
        }
      }
    }
  }
}

for (const ownerStrength of envelope.ownerStrength) {
  for (const averageStrength of envelope.averageStrength) {
    for (const distance of envelope.distance) {
      for (const routeRisk of envelope.routeRisk) {
        const common = {
          ownerStrength,
          averageStrength,
          distance,
          routeRisk,
          strengthMultiplier: 1,
          phaseMultiplier: 1,
        };
        const reduced = plan({ ...common, rewardScale: 0.72 });
        const base = plan({ ...common, rewardScale: 1 });
        const combo = plan({ ...common, rewardScale: 1.2 });
        if (
          reduced.goldReward > base.goldReward ||
          reduced.troopsReward > base.troopsReward
        )
          fail("reduced-scale-order", common);
        if (
          combo.goldReward < base.goldReward ||
          combo.troopsReward < base.troopsReward
        )
          fail("combo-scale-order", common);
      }
    }
  }
}

const scenarioDigest = `sha256:${createHash("sha256").update(JSON.stringify(scenarios)).digest("hex")}`;
const tuningDigest = `sha256:${createHash("sha256").update(JSON.stringify(authority)).digest("hex")}`;
const payload = {
  schemaVersion: "1.0",
  authority: authority.authority,
  status: counterexamples.length === 0 ? "verified" : "failed",
  tuningDigest,
  authorityFingerprint: tuningDigest,
  scenarioDigest,
  scenarioCount: scenarios.length,
  invariants: [
    "multiplier-clamp",
    "non-negative-floor",
    "distance-monotonicity",
    "risk-monotonicity",
    "reduced-scale-order",
    "combo-scale-order",
    "pressure-threshold",
    "pressure-window",
    "gameplay-schema",
    "single-authority-fingerprint",
  ],
  counterexamples,
  pressureRules,
  gameplayRules,
  bounds: {
    goldReward: {
      min: scenarios.reduce(
        (value, item) =>
          BigInt(item.goldReward) < BigInt(value) ? item.goldReward : value,
        scenarios[0].goldReward,
      ),
      max: scenarios.reduce(
        (value, item) =>
          BigInt(item.goldReward) > BigInt(value) ? item.goldReward : value,
        scenarios[0].goldReward,
      ),
    },
    troopsReward: {
      min: Math.min(...scenarios.map((item) => item.troopsReward)),
      max: Math.max(...scenarios.map((item) => item.troopsReward)),
    },
    rewardMultiplier: {
      min: Math.min(...scenarios.map((item) => item.rewardMultiplier)),
      max: Math.max(...scenarios.map((item) => item.rewardMultiplier)),
    },
  },
};
const output = path.join(root, "public", "balance-envelope.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(
  `balance envelope: ${payload.status} · scenarios=${payload.scenarioCount} · counterexamples=${counterexamples.length} · ${scenarioDigest}`,
);
if (counterexamples.length > 0) process.exitCode = 1;
