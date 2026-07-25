import balanceAuthority from "../../../config/vaultfront-balance.v1.json";
import type { VaultConvoyRewardTuning } from "../configuration/Config";

export const VAULTFRONT_BALANCE_AUTHORITY = balanceAuthority;
export const DEFAULT_VAULT_CONVOY_REWARD_TUNING = Object.freeze(
  balanceAuthority.tuning,
) satisfies Readonly<VaultConvoyRewardTuning>;
export const DEFAULT_VAULT_PRESSURE_CONFIG = Object.freeze(
  balanceAuthority.pressure,
);

export type VaultFrontGameplayBalance = typeof balanceAuthority.gameplay;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function validateVaultFrontBalanceAuthority(
  authority: unknown,
): string[] {
  const errors: string[] = [];
  if (!authority || typeof authority !== "object") {
    return ["authority must be an object"];
  }
  const candidate = authority as typeof balanceAuthority;
  if (candidate.schemaVersion !== "1.0") {
    errors.push("schemaVersion must be 1.0");
  }
  const visit = (value: unknown, path: string) => {
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`${path} must be a finite non-negative number`);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) errors.push(`${path} must not be empty`);
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, entry]) =>
        visit(entry, `${path}.${key}`),
      );
    }
  };
  visit(candidate.tuning, "tuning");
  visit(candidate.pressure, "pressure");
  visit(candidate.gameplay, "gameplay");
  const gameplay = candidate.gameplay;
  if (
    gameplay?.mapEvents?.minIntervalTicks >
    gameplay?.mapEvents?.maxIntervalTicks
  ) {
    errors.push("gameplay.mapEvents interval bounds are inverted");
  }
  if (
    gameplay?.defense?.beaconTriggerCost > gameplay?.defense?.beaconChargeCap
  ) {
    errors.push("gameplay.defense trigger exceeds charge cap");
  }
  if (
    gameplay?.rewardDynamics?.minimumStrengthMultiplier >
    gameplay?.rewardDynamics?.maximumStrengthMultiplier
  ) {
    errors.push("gameplay.rewardDynamics strength bounds are inverted");
  }
  return errors;
}

const balanceErrors = validateVaultFrontBalanceAuthority(balanceAuthority);
if (balanceErrors.length > 0) {
  throw new Error(
    `Invalid VaultFront balance authority: ${balanceErrors.join("; ")}`,
  );
}

export const DEFAULT_VAULT_GAMEPLAY_BALANCE = deepFreeze(
  balanceAuthority.gameplay,
) as Readonly<VaultFrontGameplayBalance>;

export function balanceGold(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid balance gold value: ${value}`);
  }
  return BigInt(value);
}
export interface ConvoyRewardInputs {
  ownerStrength: number;
  averageStrength: number;
  distance: number;
  routeRisk: number;
  strengthMultiplier: number;
  phaseMultiplier: number;
  rewardScale: number;
}

export interface ConvoyRewardPlan {
  goldReward: bigint;
  troopsReward: number;
  rewardMultiplier: number;
  rewardScale: number;
  strengthMultiplier: number;
  phaseMultiplier: number;
  riskMultiplier: number;
  baselineGold: number;
  distanceGold: number;
  rewardMath: string;
}

export function planConvoyReward(
  input: ConvoyRewardInputs,
  tuning: Readonly<VaultConvoyRewardTuning> = DEFAULT_VAULT_CONVOY_REWARD_TUNING,
): ConvoyRewardPlan {
  const distance = Math.max(0, input.distance);
  const routeRisk = Math.max(0, Math.min(1, input.routeRisk));
  const riskMultiplier =
    tuning.riskMultiplierBase + routeRisk * tuning.riskMultiplierScale;
  const rewardMultiplier = Math.max(
    tuning.rewardMultiplierMin,
    Math.min(
      tuning.rewardMultiplierMax,
      input.strengthMultiplier *
        input.phaseMultiplier *
        riskMultiplier *
        input.rewardScale,
    ),
  );
  const ownerStrength = Math.max(0, input.ownerStrength);
  const averageStrength = Math.max(0, input.averageStrength);
  const baselineGold = Math.max(
    tuning.minGoldReward,
    Math.floor(
      (ownerStrength * tuning.baselineGoldOwnerStrengthScale +
        averageStrength * tuning.baselineGoldAvgStrengthScale) *
        (tuning.baselineGoldRiskBase +
          routeRisk * tuning.baselineGoldRiskScale),
    ),
  );
  const distanceGold = Math.max(
    tuning.distanceGoldMin,
    Math.floor(
      (ownerStrength * tuning.distanceGoldOwnerStrengthScale +
        tuning.distanceGoldFlat) *
        (tuning.distanceGoldRiskBase +
          routeRisk * tuning.distanceGoldRiskScale),
    ),
  );
  const goldReward = BigInt(
    Math.floor((baselineGold + distance * distanceGold) * rewardMultiplier),
  );
  const troopsReward = Math.max(
    tuning.minTroopsReward,
    Math.floor(
      (Math.sqrt(Math.max(1, baselineGold)) * tuning.troopsSqrtGoldScale +
        distance *
          (tuning.troopsDistanceBase +
            routeRisk * tuning.troopsDistanceRiskScale)) *
        rewardMultiplier,
    ),
  );
  return {
    goldReward,
    troopsReward,
    rewardMultiplier,
    rewardScale: input.rewardScale,
    strengthMultiplier: input.strengthMultiplier,
    phaseMultiplier: input.phaseMultiplier,
    riskMultiplier,
    baselineGold,
    distanceGold,
    rewardMath:
      `Gold=(${baselineGold}+${distance}*${distanceGold})x${rewardMultiplier.toFixed(2)} | ` +
      `Troops=max(${tuning.minTroopsReward},f(distance,risk)x${rewardMultiplier.toFixed(2)})`,
  };
}
