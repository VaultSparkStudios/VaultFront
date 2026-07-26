/**
 * Shared certified/live play-style kernel plus client activity adaptation.
 * Keeping classification in core prevents recap and server career projections
 * from silently assigning different labels to the same evidence.
 */
export {
  activityCountsFromPlayerStats,
  classifyPlayStyle,
  emptyActivityCounts,
  type ActivityCounts,
  type PlayStyleBar,
  type PlayStyleLabel,
  type PlayStyleResult,
} from "../../core/PlayStyleClassifier";
import {
  emptyActivityCounts,
  type ActivityCounts,
} from "../../core/PlayStyleClassifier";

/** Build an ActivityCounts snapshot from live VaultFrontActivity events. */
export function countsFromActivities(
  activities: Array<{ activity: string }>,
  existing: ActivityCounts = emptyActivityCounts(),
): ActivityCounts {
  const counts = { ...existing };
  for (const { activity } of activities) {
    switch (activity) {
      case "vault_captured":
        counts.vaultCaptures++;
        break;
      case "convoy_delivered":
        counts.convoysDelivered++;
        break;
      case "passive_payout":
        counts.passivePayouts++;
        break;
      case "clean_execution_streak":
        counts.cleanExecutionStreaks++;
        break;
      case "jam_breaker":
        counts.jamBreakerUses++;
        break;
      case "convoy_escorted":
        counts.convoyEscortCommands++;
        break;
    }
  }
  return counts;
}
