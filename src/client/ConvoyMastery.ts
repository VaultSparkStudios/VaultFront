import type {
  AchievementProgress,
  SeasonMilestoneProgress,
  VaultFrontContractsSnapshot,
} from "./Api";

export const CONVOY_MASTERY_STORAGE_KEY = "vaultfront.convoyMasteryGoal.v1";

export type MasteryGoalKey =
  "vault_first" | "convoy_impact" | "pulse_chain" | "focus_stable" | "";

export interface DoctrineRematchIntent {
  id: string;
  name: string;
  role: string;
  brief: string;
  effectPolicy: "coaching-and-identity-only";
}

export interface ConvoyMasteryPrescription {
  text: string;
  goalKey: MasteryGoalKey;
  source: "recap" | "season" | "achievement" | "rating";
  evidence: string;
  selectedAt: number;
  /** Match in which the player selected the rematch doctrine. */
  sourceGameId?: string;
  /** First subsequent production match that bound the intent. */
  targetGameId?: string;
  doctrine?: DoctrineRematchIntent | null;
}

const METRIC_GOALS: Partial<
  Record<SeasonMilestoneProgress["milestone"]["metric"], MasteryGoalKey>
> = {
  convoy_deliveries: "convoy_impact",
  vault_captures: "vault_first",
  chain_combos: "pulse_chain",
};

export function selectConvoyMastery(input: {
  savedGoal?: { text: string; goalKey: MasteryGoalKey } | null;
  milestones?: SeasonMilestoneProgress[] | null;
  achievements?: AchievementProgress[] | null;
  contracts?: VaultFrontContractsSnapshot | false | null;
  now?: number;
}): ConvoyMasteryPrescription {
  const selectedAt = input.now ?? Date.now();
  if (input.savedGoal?.text) {
    return {
      ...input.savedGoal,
      source: "recap",
      evidence: "Selected from your weakest certified match dimension",
      selectedAt,
    };
  }

  const milestone = (input.milestones ?? [])
    .filter(
      (entry) =>
        !entry.claimed && METRIC_GOALS[entry.milestone.metric] !== undefined,
    )
    .sort((a, b) => b.pct - a.pct || a.target - b.target)[0];
  if (milestone) {
    const remaining = Math.max(0, milestone.target - milestone.progress);
    return {
      text: `Advance ${milestone.milestone.title}: ${remaining} ${milestone.milestone.metric.replace(/_/g, " ")} remaining.`,
      goalKey: METRIC_GOALS[milestone.milestone.metric] ?? "",
      source: "season",
      evidence: `${milestone.progress}/${milestone.target} · ${milestone.pct}% complete`,
      selectedAt,
    };
  }

  const achievement = (input.achievements ?? [])
    .filter((entry) => entry.unlockedAt === null)
    .sort((a, b) => b.progress - a.progress)[0];
  if (achievement) {
    return {
      text: `Close the ${achievement.id.replace(/_/g, " ")} achievement gap.`,
      goalKey: "",
      source: "achievement",
      evidence: achievement.progressLabel,
      selectedAt,
    };
  }

  return {
    text: "Complete one clean vault-to-convoy extraction this match.",
    goalKey: "convoy_impact",
    source: "rating",
    evidence: input.contracts
      ? `${input.contracts.eloLabel} ${input.contracts.eloRating} · ${input.contracts.matchesPlayed} matches`
      : "Baseline mastery prescription",
    selectedAt,
  };
}

export function readConvoyMastery(): ConvoyMasteryPrescription | null {
  try {
    const raw = localStorage.getItem(CONVOY_MASTERY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConvoyMasteryPrescription>;
    if (typeof parsed.text !== "string" || typeof parsed.goalKey !== "string") {
      return null;
    }
    if (
      parsed.doctrine !== undefined &&
      parsed.doctrine !== null &&
      (typeof parsed.doctrine !== "object" ||
        typeof parsed.doctrine.id !== "string" ||
        typeof parsed.doctrine.name !== "string" ||
        typeof parsed.doctrine.role !== "string" ||
        typeof parsed.doctrine.brief !== "string" ||
        parsed.doctrine.effectPolicy !== "coaching-and-identity-only")
    ) {
      return null;
    }
    if (
      (parsed.sourceGameId !== undefined &&
        typeof parsed.sourceGameId !== "string") ||
      (parsed.targetGameId !== undefined &&
        typeof parsed.targetGameId !== "string")
    ) {
      return null;
    }
    return parsed as ConvoyMasteryPrescription;
  } catch {
    return null;
  }
}

export function persistConvoyMastery(
  prescription: ConvoyMasteryPrescription,
): void {
  localStorage.setItem(
    CONVOY_MASTERY_STORAGE_KEY,
    JSON.stringify(prescription),
  );
  localStorage.setItem("vaultfront.nextMatchGoal", prescription.text);
  if (prescription.goalKey) {
    localStorage.setItem("vaultfront.nextMatchGoalKey", prescription.goalKey);
  } else {
    localStorage.removeItem("vaultfront.nextMatchGoalKey");
  }
}

/**
 * Binds a doctrine to exactly the first game generated after its source match.
 * The receipt carries coaching identity only; simulation balance never reads it.
 */
export function bindDoctrineToGame(
  prescription: ConvoyMasteryPrescription | null,
  gameId: string,
): DoctrineRematchIntent | null {
  const doctrine = prescription?.doctrine;
  if (
    !prescription ||
    !doctrine ||
    doctrine.effectPolicy !== "coaching-and-identity-only" ||
    !prescription.sourceGameId ||
    prescription.sourceGameId === gameId
  ) {
    return null;
  }
  if (prescription.targetGameId && prescription.targetGameId !== gameId) {
    return null;
  }
  if (!prescription.targetGameId) {
    persistConvoyMastery({ ...prescription, targetGameId: gameId });
  }
  return doctrine;
}

export function frameDoctrineCoaching(
  doctrine: DoctrineRematchIntent | null,
  hint: string,
): string {
  if (!doctrine) return hint;
  return `${doctrine.name} · ${doctrine.role}: ${doctrine.brief} ${hint}`;
}

export function clearConvoyMastery(): void {
  localStorage.removeItem(CONVOY_MASTERY_STORAGE_KEY);
  localStorage.removeItem("vaultfront.nextMatchGoal");
  localStorage.removeItem("vaultfront.nextMatchGoalKey");
}
