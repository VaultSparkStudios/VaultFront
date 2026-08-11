import type { VaultFrontActivityUpdate } from "../../../core/game/GameUpdates";

export type SidebarFeedAudience = "self" | "ally" | "global";

export interface SidebarFeedEntry {
  key: string;
  tick: number;
  tile?: number;
  label: string;
  activity: VaultFrontActivityUpdate["activity"];
  audience: SidebarFeedAudience;
  priority: number;
  count?: number;
}

export interface SidebarRelationFacts {
  myPlayerId?: number;
  isAlly(playerId: number): boolean;
}

export interface ObjectiveRailItem {
  key: string;
  tile: number;
  text: string;
  tag?: string;
  details?: string;
  actionLabel?: "Capture" | "Defend" | "Intercept";
  actionTile?: number;
  projectionPriority: number;
  etaTicks?: number;
}

export const SIDEBAR_FEED_TTL_TICKS = 260;
export const SIDEBAR_PASSIVE_MERGE_WINDOW_TICKS = 240;
export const SIDEBAR_FEED_MAX_ITEMS = 4;
export const SIDEBAR_OBJECTIVE_RAIL_MAX_ITEMS = 3;

const SUPPORTED_FEED_ACTIVITIES = new Set<VaultFrontActivityUpdate["activity"]>(
  [
    "vault_passive_income",
    "convoy_delivered",
    "convoy_intercepted",
    "vault_captured",
    "jam_breaker",
    "beacon_pulse",
  ],
);

export function resolveSidebarFeedAudience(
  entry: VaultFrontActivityUpdate,
  relation: SidebarRelationFacts,
): SidebarFeedAudience {
  if (
    relation.myPlayerId !== undefined &&
    (entry.sourcePlayerID === relation.myPlayerId ||
      entry.targetPlayerID === relation.myPlayerId)
  ) {
    return "self";
  }
  for (const id of [entry.sourcePlayerID, entry.targetPlayerID]) {
    if (id !== null && relation.isAlly(id)) return "ally";
  }
  return "global";
}

export function sidebarFeedPriority(
  audience: SidebarFeedAudience,
  activity: VaultFrontActivityUpdate["activity"],
): number {
  if (audience === "self") return 4;
  if (audience === "ally") return 3;
  return activity === "vault_passive_income" ? 1 : 2;
}

export function pruneSidebarFeed(
  feed: readonly SidebarFeedEntry[],
  now: number,
): SidebarFeedEntry[] {
  return feed.filter((entry) => now - entry.tick <= SIDEBAR_FEED_TTL_TICKS);
}

function mergePassiveLabel(existing: string, next: string, count: number) {
  const gold = /\+([\d,]+)g/.exec(next)?.[1];
  return gold ? `Passive income +${gold}g x${count}` : existing;
}

export function projectSidebarActivityFeed(input: {
  current: readonly SidebarFeedEntry[];
  updates: readonly VaultFrontActivityUpdate[];
  now: number;
  relation: SidebarRelationFacts;
}): SidebarFeedEntry[] {
  const feed = pruneSidebarFeed(input.current, input.now).map((entry) => ({
    ...entry,
  }));
  input.updates.forEach((update, updateIndex) => {
    if (!SUPPORTED_FEED_ACTIVITIES.has(update.activity)) return;
    const audience = resolveSidebarFeedAudience(update, input.relation);
    const priority = sidebarFeedPriority(audience, update.activity);
    const last = feed[feed.length - 1];
    if (
      last?.activity === "vault_passive_income" &&
      update.activity === "vault_passive_income" &&
      last.priority === priority &&
      last.audience === audience &&
      input.now - last.tick <= SIDEBAR_PASSIVE_MERGE_WINDOW_TICKS
    ) {
      const count = (last.count ?? 1) + 1;
      last.tick = input.now;
      last.count = count;
      last.label = mergePassiveLabel(last.label, update.label, count);
      last.tile = update.tile;
      return;
    }
    feed.push({
      key: `${update.activity}-${input.now}-${feed.length}-${updateIndex}`,
      tick: input.now,
      tile: update.tile,
      label: update.label,
      activity: update.activity,
      audience,
      priority,
    });
  });
  return feed
    .sort((a, b) => b.priority - a.priority || b.tick - a.tick)
    .slice(0, SIDEBAR_FEED_MAX_ITEMS)
    .sort((a, b) => a.tick - b.tick);
}

export function sidebarTimelineCategory(
  activity: VaultFrontActivityUpdate["activity"],
): "captures" | "convoys" | "pulses" | "surge" {
  if (activity === "vault_captured" || activity === "vault_passive_income")
    return "captures";
  if (activity === "comeback_surge") return "surge";
  if (activity === "beacon_pulse" || activity === "jam_breaker")
    return "pulses";
  return "convoys";
}

export function sidebarFeedActivityLabel(
  activity: VaultFrontActivityUpdate["activity"],
): string {
  if (activity === "convoy_delivered") return "Delivery";
  if (activity === "convoy_intercepted") return "Intercept";
  if (activity === "vault_captured") return "Vault";
  if (activity === "jam_breaker") return "Jam";
  if (activity === "beacon_pulse") return "Pulse";
  return "Income";
}

export function projectObjectiveRail(
  candidates: readonly ObjectiveRailItem[],
): ObjectiveRailItem[] {
  return candidates
    .map((candidate, sourceIndex) => ({ candidate, sourceIndex }))
    .sort(
      (a, b) =>
        b.candidate.projectionPriority - a.candidate.projectionPriority ||
        (a.candidate.etaTicks ?? Number.MAX_SAFE_INTEGER) -
          (b.candidate.etaTicks ?? Number.MAX_SAFE_INTEGER) ||
        a.sourceIndex - b.sourceIndex,
    )
    .slice(0, SIDEBAR_OBJECTIVE_RAIL_MAX_ITEMS)
    .map(({ candidate }) => candidate);
}
