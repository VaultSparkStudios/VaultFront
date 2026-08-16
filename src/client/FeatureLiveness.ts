export type FeatureAudience = "player" | "operator";

export interface FeatureLivenessNode {
  id: string;
  label: string;
  audience: FeatureAudience;
  route: string;
  apis: readonly string[];
  customElement: string;
  mountSelector: string;
  journey: string;
}

export const featureLivenessGraph: readonly FeatureLivenessNode[] = [
  {
    id: "achievements",
    label: "Achievements",
    audience: "player",
    route: "page-command-center",
    apis: ["GET /api/vaultfront/achievements/:persistentId"],
    customElement: "achievements-panel",
    mountSelector: "#page-command-center achievements-panel",
    journey: "Sign in → Command Center → Achievements → progress detail",
  },
  {
    id: "season-pass",
    label: "Season pass",
    audience: "player",
    route: "page-command-center",
    apis: [
      "GET /api/vaultfront/season-progress/:persistentId",
      "POST /api/vaultfront/season-progress/claim",
    ],
    customElement: "season-pass-track",
    mountSelector: "#page-command-center season-pass-track",
    journey: "Sign in → Command Center → Season track → claim milestone",
  },
  {
    id: "fortune",
    label: "Fortune collection",
    audience: "player",
    route: "page-command-center",
    apis: [
      "GET /api/vaultfront/fortune-collection/:persistentId",
      "POST /api/vaultfront/fortune-collection/equip",
    ],
    customElement: "fortune-collection-panel",
    mountSelector: "#page-command-center fortune-collection-panel",
    journey:
      "Certified win → Command Center → Fortune collection → equip title",
  },
  {
    id: "clans",
    label: "Clans",
    audience: "player",
    route: "page-command-center",
    apis: ["GET /api/clans/player/:persistentId", "GET /api/clans/leaderboard"],
    customElement: "clan-modal",
    mountSelector: "#page-command-center clan-modal",
    journey: "Sign in → Command Center → Open clans → create/join/leave",
  },
  {
    id: "tournaments",
    label: "Tournaments",
    audience: "player",
    route: "page-command-center",
    apis: ["GET /api/tournaments", "GET /api/tournaments/:id/bracket"],
    customElement: "tournament-modal",
    mountSelector: "#page-command-center tournament-modal",
    journey: "Sign in → Command Center → Open tournaments → bracket",
  },
  {
    id: "achievement-toast",
    label: "Achievement feedback",
    audience: "player",
    route: "global",
    apis: ["CustomEvent vaultfront-achievement-unlocked"],
    customElement: "achievement-toast",
    mountSelector: "body > achievement-toast",
    journey: "Achievement refresh → unlock event → queued accessible toast",
  },
  {
    id: "experiments",
    label: "Experiment evidence",
    audience: "operator",
    route: "page-command-center",
    apis: ["GET /api/admin/ab/results"],
    customElement: "ab-dashboard",
    mountSelector: "#page-command-center ab-dashboard",
    journey: "Authorized operator token → Command Center → evidence dashboard",
  },
] as const;

export const shippedFeatureLivenessIds = Object.freeze([
  "achievements",
  "season-pass",
  "fortune",
  "clans",
  "tournaments",
  "achievement-toast",
  "experiments",
]);

export function validateFeatureLivenessGraph(
  graph: readonly FeatureLivenessNode[] = featureLivenessGraph,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const node of graph) {
    if (ids.has(node.id)) errors.push(`duplicate feature id: ${node.id}`);
    ids.add(node.id);
    if (!node.route.trim()) errors.push(`${node.id}: missing route`);
    if (node.apis.length === 0) errors.push(`${node.id}: missing API/event`);
    if (!node.customElement.includes("-"))
      errors.push(`${node.id}: invalid custom element`);
    if (!node.mountSelector.includes(node.customElement))
      errors.push(`${node.id}: mount selector does not name custom element`);
    if (!node.journey.includes("→")) errors.push(`${node.id}: missing journey`);
  }
  for (const id of shippedFeatureLivenessIds) {
    if (!ids.has(id)) errors.push(`shipped feature missing from graph: ${id}`);
  }
  return errors;
}
