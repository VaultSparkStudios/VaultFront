#!/usr/bin/env node
/**
 * Proves that every shipped client TypeScript module is reachable from the
 * production Vite entry graph. A new unreachable file fails CI instead of
 * becoming an indefinitely maintained phantom feature.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = path.join(ROOT, "src");
const CLIENT_ROOT = path.join(SOURCE_ROOT, "client");
const ENTRYPOINTS = [path.join(CLIENT_ROOT, "Main.ts")];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function moduleSpecifiers(source) {
  const patterns = [
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:import|export)\s+(?:type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
  ];
  const found = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

function resolveModule(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  // Vite resource queries change bundling semantics, not the source-graph edge.
  // Resolve `?worker&url`, `?raw`, and similar suffixes against the underlying
  // module so compiled workers cannot become reachability false negatives.
  const sourceSpecifier = specifier.replace(/[?#].*$/, "");
  const base = path.resolve(path.dirname(importer), sourceSpecifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) =>
      path.join(base, "index" + extension),
    ),
  ];
  return (
    candidates.find(
      (candidate) =>
        fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
    ) ?? null
  );
}

export function inspectClientReachability({
  entrypoints = ENTRYPOINTS,
  clientRoot = CLIENT_ROOT,
} = {}) {
  const visited = new Set();
  const missingImports = [];
  const queue = [...entrypoints];

  while (queue.length > 0) {
    const file = path.resolve(queue.shift());
    if (visited.has(file)) continue;
    if (!fs.existsSync(file)) {
      missingImports.push({ importer: null, specifier: file });
      continue;
    }
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveModule(file, specifier);
      if (!resolved) {
        if (/\.(?:css|scss|json|svg|png|webp|wasm)(?:\?.*)?$/.test(specifier))
          continue;
        missingImports.push({
          importer: path.relative(ROOT, file).replaceAll("\\", "/"),
          specifier,
        });
        continue;
      }
      queue.push(resolved);
    }
  }

  const clientModules = walk(clientRoot)
    .filter((file) => /\.(?:ts|tsx)$/.test(file) && !file.endsWith(".d.ts"))
    .map((file) => path.resolve(file));
  const unreachable = clientModules
    .filter((file) => !visited.has(file))
    .map((file) => path.relative(ROOT, file).replaceAll("\\", "/"))
    .sort();

  return {
    ok: unreachable.length === 0 && missingImports.length === 0,
    entrypoints: entrypoints.map((file) =>
      path.relative(ROOT, file).replaceAll("\\", "/"),
    ),
    reachableModules: clientModules.filter((file) => visited.has(file)).length,
    clientModules: clientModules.length,
    unreachable,
    missingImports,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = inspectClientReachability();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
