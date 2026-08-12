import type { VaultFrontPlaytestPulseSummary } from "./Api";

export interface PlaytestPulseDisplay {
  score: string | number;
  tutorialCompletion: string;
  matchFeedback: string | number;
  retentionAction: string;
  tournamentActions: string | number;
}

export function presentPlaytestPulse(
  pulse: VaultFrontPlaytestPulseSummary | null,
): PlaytestPulseDisplay {
  if (!pulse) {
    return {
      score: "—",
      tutorialCompletion: "—",
      matchFeedback: "—",
      retentionAction: "—",
      tournamentActions: "—",
    };
  }
  if (pulse.privacy?.suppressed) {
    return {
      score: "withheld",
      tutorialCompletion: "withheld",
      matchFeedback: "withheld",
      retentionAction: "withheld",
      tournamentActions: "withheld",
    };
  }
  return {
    score: pulse.score,
    tutorialCompletion:
      pulse.totals.tutorialShown > 0
        ? `${Math.round((pulse.totals.tutorialCompleted / pulse.totals.tutorialShown) * 100)}%`
        : "0%",
    matchFeedback: pulse.totals.matchFeedback,
    retentionAction:
      pulse.totals.retentionChallengeShown > 0
        ? `${Math.round(pulse.rates.retentionAction * 100)}%`
        : "—",
    tournamentActions: pulse.totals.tournamentActions,
  };
}
