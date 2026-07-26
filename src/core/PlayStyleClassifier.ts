import type { AllPlayersStats } from "./Schemas";

export type PlayStyleLabel =
  "Iron Fist" | "Convoy Lord" | "Shadow Broker" | "Fortress" | "Balanced";

export interface PlayStyleBar {
  label: string;
  pct: number;
  color: string;
}

export interface PlayStyleResult {
  label: PlayStyleLabel;
  bars: PlayStyleBar[];
  dominant: number;
}

export interface ActivityCounts {
  vaultCaptures: number;
  conquests: number;
  convoysDelivered: number;
  passivePayouts: number;
  cleanExecutionStreaks: number;
  betrayals: number;
  jamBreakerUses: number;
  convoyEscortCommands: number;
  defenseFactoryTicks: number;
}

export function activityCountsFromPlayerStats(
  stats: AllPlayersStats[string] | undefined,
): ActivityCounts {
  const vault = stats?.vaultfront;
  const count = (value: bigint | undefined) => Number(value ?? 0n);
  return {
    vaultCaptures: count(vault?.vaultCaptures),
    conquests: (stats?.conquests ?? []).reduce(
      (total, value) => total + count(value),
      0,
    ),
    convoysDelivered: count(vault?.vaultConvoysDelivered),
    passivePayouts: count(vault?.vaultPassivePayouts),
    cleanExecutionStreaks: count(vault?.cleanExecutionStreaks),
    betrayals: count(stats?.betrayals),
    jamBreakerUses: count(vault?.jamBreakerUses),
    convoyEscortCommands: count(vault?.convoyEscortCommands),
    defenseFactoryTicks: count(vault?.defenseFactoryPulseUptimeTicks),
  };
}

export function classifyPlayStyle(counts: ActivityCounts): PlayStyleResult {
  const aggression = counts.vaultCaptures + counts.conquests;
  const economy = counts.convoysDelivered + counts.passivePayouts;
  const deception =
    counts.cleanExecutionStreaks + counts.betrayals + counts.jamBreakerUses;
  const resilience =
    Math.round(counts.defenseFactoryTicks / 600) + counts.convoyEscortCommands;
  const total = Math.max(1, aggression + economy + deception + resilience);
  const a = aggression / total;
  const e = economy / total;
  const d = deception / total;
  const r = resilience / total;
  const label: PlayStyleLabel =
    a >= 0.4
      ? "Iron Fist"
      : e >= 0.4
        ? "Convoy Lord"
        : d >= 0.35
          ? "Shadow Broker"
          : r >= 0.35
            ? "Fortress"
            : "Balanced";
  return {
    label,
    dominant: Math.round(Math.max(a, e, d, r) * 100),
    bars: [
      { label: "Aggression", pct: Math.round(a * 100), color: "bg-rose-500" },
      { label: "Economy", pct: Math.round(e * 100), color: "bg-emerald-500" },
      { label: "Deception", pct: Math.round(d * 100), color: "bg-purple-500" },
      { label: "Resilience", pct: Math.round(r * 100), color: "bg-sky-500" },
    ],
  };
}

export function emptyActivityCounts(): ActivityCounts {
  return {
    vaultCaptures: 0,
    conquests: 0,
    convoysDelivered: 0,
    passivePayouts: 0,
    cleanExecutionStreaks: 0,
    betrayals: 0,
    jamBreakerUses: 0,
    convoyEscortCommands: 0,
    defenseFactoryTicks: 0,
  };
}
