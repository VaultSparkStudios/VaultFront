import type { MapEventType } from "../game/GameUpdates";
import {
  balanceGold,
  DEFAULT_VAULT_GAMEPLAY_BALANCE as gameplay,
} from "./VaultFrontBalance";

/**
 * Simulation-ready projection of the JSON authority. Gold values cross the
 * number→bigint boundary once here; all other values retain their exact source
 * representation. Consumers never need to reinterpret serialized tuning.
 */
export const VAULTFRONT_RUNTIME_BALANCE = Object.freeze({
  gameplay,
  statusProjectionCadenceTicks:
    gameplay.simulation.statusProjectionCadenceTicks,
  ghostRouteCooldownTicks: gameplay.simulation.ghostRouteCooldownTicks,
  chainGuardianThreshold: gameplay.simulation.chainGuardianThreshold,
  commandRateWindowTicks: gameplay.simulation.commandRateWindowTicks,
  commandRateMaxPerWindow: gameplay.simulation.commandRateMaxPerWindow,
  lastStandSiteThreshold: gameplay.lastStand.siteThreshold,
  lastStandBonusDurationTicks: gameplay.lastStand.bonusDurationTicks,
  lastStandOpponentGoldMultiplier: gameplay.lastStand.opponentGoldMultiplier,
  heistGoldCap: balanceGold(gameplay.heist.goldCap),
  heistActivationCost: balanceGold(gameplay.heist.activationCost),
  heistCooldownTicks: gameplay.heist.cooldownTicks,
  bountyThreshold: gameplay.bounty.threshold,
  bountyReward: balanceGold(gameplay.bounty.reward),
  bountyCharges: gameplay.bounty.charges,
  bountyDurationTicks: gameplay.bounty.durationTicks,
  warchestHuntDurationTicks: gameplay.warchest.huntDurationTicks,
  warchestHuntMultiplier: BigInt(gameplay.warchest.multiplier),
  mapEventMinIntervalTicks: gameplay.mapEvents.minIntervalTicks,
  mapEventMaxIntervalTicks: gameplay.mapEvents.maxIntervalTicks,
  mapEventPool: gameplay.mapEvents.pool as readonly MapEventType[],
  intelCost: balanceGold(gameplay.intelligence.cost),
  deepIntelCost: balanceGold(gameplay.intelligence.deepCost),
  intelDurationTicks: gameplay.intelligence.durationTicks,
  sabotageCost: balanceGold(gameplay.economicWarfare.sabotageCost),
  sabotageChargesPerUse: gameplay.economicWarfare.sabotageChargesPerUse,
  sabotageTollFraction: gameplay.economicWarfare.sabotageTollFraction,
  bribeCost: balanceGold(gameplay.economicWarfare.bribeCost),
  bribeDelayTicks: gameplay.economicWarfare.bribeDelayTicks,
  tradeDealShareFraction: gameplay.economicWarfare.tradeDealShareFraction,
  vaultCaptureTicks: gameplay.vault.captureTicks,
  vaultCooldownTicks: gameplay.vault.cooldownTicks,
  vaultPassiveIncomeIntervalTicks: gameplay.vault.passiveIncomeIntervalTicks,
  vaultPassiveGoldPerMinute: balanceGold(gameplay.vault.passiveGoldPerMinute),
  beaconChargeCap: gameplay.defense.beaconChargeCap,
  beaconTriggerCost: gameplay.defense.beaconTriggerCost,
  beaconPulseDurationTicks: gameplay.defense.beaconPulseDurationTicks,
  beaconPulseCooldownTicks: gameplay.defense.beaconPulseCooldownTicks,
  jamBreakerGoldCost: balanceGold(gameplay.defense.jamBreakerGoldCost),
  jamBreakerCooldownTicks: gameplay.defense.jamBreakerCooldownTicks,
  jamBreakerMaskClampTicks: gameplay.defense.jamBreakerMaskClampTicks,
  surgeBehindThresholdRatio: gameplay.comeback.surgeBehindThresholdRatio,
  surgeActivationHoldTicks: gameplay.comeback.surgeActivationHoldTicks,
  surgeDurationTicks: gameplay.comeback.surgeDurationTicks,
  surgeCaptureGoldBonus: balanceGold(gameplay.comeback.surgeCaptureGoldBonus),
  surgeInterceptGoldMultiplier: gameplay.comeback.surgeInterceptGoldMultiplier,
  cleanExecutionChainWindowTicks:
    gameplay.comeback.cleanExecutionChainWindowTicks,
  cleanExecutionStreakConvoyMultiplier:
    gameplay.comeback.cleanExecutionStreakConvoyMultiplier,
  squadObjectiveWindowTicks: gameplay.comeback.squadObjectiveWindowTicks,
  squadObjectiveRadius: gameplay.comeback.squadObjectiveRadius,
  squadObjectiveGoldBonus: balanceGold(
    gameplay.comeback.squadObjectiveGoldBonus,
  ),
  squadObjectiveTroopsBonus: gameplay.comeback.squadObjectiveTroopsBonus,
});

export function projectVaultFrontMutatorBalance(mutator: string) {
  const accelerated = mutator === "accelerated_cooldowns";
  const doublePassive =
    mutator === "double_passive" || mutator === "rally_point";
  return Object.freeze({
    executionChainWindowTicks:
      mutator === "execution_rush"
        ? VAULTFRONT_RUNTIME_BALANCE.cleanExecutionChainWindowTicks *
          gameplay.rewardDynamics.executionRushWindowMultiplier
        : VAULTFRONT_RUNTIME_BALANCE.cleanExecutionChainWindowTicks,
    vaultCaptureTicks:
      mutator === "blitz"
        ? Math.max(
            gameplay.mutators.blitzCaptureFloorTicks,
            Math.floor(
              VAULTFRONT_RUNTIME_BALANCE.vaultCaptureTicks *
                gameplay.mutators.blitzCaptureMultiplier,
            ),
          )
        : VAULTFRONT_RUNTIME_BALANCE.vaultCaptureTicks,
    vaultCooldownTicks: accelerated
      ? Math.max(
          gameplay.mutators.acceleratedVaultCooldownFloorTicks,
          Math.floor(
            VAULTFRONT_RUNTIME_BALANCE.vaultCooldownTicks *
              gameplay.mutators.acceleratedCooldownMultiplier,
          ),
        )
      : VAULTFRONT_RUNTIME_BALANCE.vaultCooldownTicks,
    vaultPassiveIncomeIntervalTicks: doublePassive
      ? Math.max(
          gameplay.mutators.passiveIntervalFloorTicks,
          Math.floor(
            VAULTFRONT_RUNTIME_BALANCE.vaultPassiveIncomeIntervalTicks *
              gameplay.mutators.passiveIntervalMultiplier,
          ),
        )
      : VAULTFRONT_RUNTIME_BALANCE.vaultPassiveIncomeIntervalTicks,
    vaultPassiveGoldPerMinute: doublePassive
      ? VAULTFRONT_RUNTIME_BALANCE.vaultPassiveGoldPerMinute *
        BigInt(gameplay.mutators.passiveGoldMultiplier)
      : VAULTFRONT_RUNTIME_BALANCE.vaultPassiveGoldPerMinute,
    beaconPulseCooldownTicks: accelerated
      ? Math.max(
          gameplay.mutators.acceleratedPulseCooldownFloorTicks,
          Math.floor(
            VAULTFRONT_RUNTIME_BALANCE.beaconPulseCooldownTicks *
              gameplay.mutators.acceleratedCooldownMultiplier,
          ),
        )
      : VAULTFRONT_RUNTIME_BALANCE.beaconPulseCooldownTicks,
    jamBreakerCooldownTicks: accelerated
      ? Math.max(
          gameplay.mutators.acceleratedJamCooldownFloorTicks,
          Math.floor(
            VAULTFRONT_RUNTIME_BALANCE.jamBreakerCooldownTicks *
              gameplay.mutators.acceleratedCooldownMultiplier,
          ),
        )
      : VAULTFRONT_RUNTIME_BALANCE.jamBreakerCooldownTicks,
    escortDurationTicks: accelerated
      ? gameplay.mutators.acceleratedEscortDurationTicks
      : gameplay.mutators.standardEscortDurationTicks,
  });
}
