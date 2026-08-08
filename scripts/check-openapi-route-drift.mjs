#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractExpressRoutes } from "./lib/route-inventory.mjs";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// S99 audit #181 closed the OpenAPI documentation gap for exactly these six
// public-facing route families (clans, tournaments, rematch, replay,
// prediction-league, season). This drift check is scoped to that boundary
// on purpose -- most of the other ~50 live routes remain intentionally
// undocumented pending a future pass, and asserting full API coverage here
// would be a dishonestly broader claim than what this item actually shipped.
export const DOCUMENTED_FAMILY_PREFIXES = [
  "/api/clans",
  "/api/tournaments",
  "/api/rematch",
  "/api/replay",
  "/api/vaultfront/prediction-league",
  "/api/season/current",
  "/api/mutator-vote",
  "/api/vaultfront/season-progress",
];

function toOpenApiPath(expressPath) {
  return expressPath.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
}

function inScope(routePath) {
  return DOCUMENTED_FAMILY_PREFIXES.some(
    (prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`),
  );
}

export function checkOpenApiRouteDrift(root = defaultRoot) {
  const serverDir = path.join(root, "src", "server");
  const routeFiles = fs
    .readdirSync(serverDir)
    .filter((name) => name === "Worker.ts" || name.endsWith("Router.ts"))
    .map((name) => path.join(serverDir, name));
  const liveRoutes = routeFiles.flatMap((file) =>
    extractExpressRoutes(fs.readFileSync(file, "utf8"), file).map((route) => ({
      ...route,
      sourceFile: path.relative(root, file).replaceAll("\\", "/"),
    })),
  );
  const scoped = liveRoutes.filter((route) => inScope(route.path));

  const spec = fs.readFileSync(
    path.join(root, "docs", "api", "openapi.yaml"),
    "utf8",
  );
  const documentedPaths = new Set(
    [...spec.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((match) => match[1]),
  );

  const errors = [];
  for (const route of scoped) {
    const openApiPath = toOpenApiPath(route.path);
    if (!documentedPaths.has(openApiPath)) {
      errors.push(
        `undocumented: ${route.method} ${route.path} (${route.sourceFile}:${route.line}) -- expected openapi.yaml key ${openApiPath}`,
      );
    }
  }
  return {
    ok: errors.length === 0,
    checkedRoutes: scoped.length,
    documentedPaths: documentedPaths.size,
    errors,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkOpenApiRouteDrift();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
