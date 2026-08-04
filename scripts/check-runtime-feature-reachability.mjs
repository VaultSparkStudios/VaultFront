#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const normalize = (value) => value.replaceAll("\\", "/");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(target)
      : /\.(?:ts|tsx)$/.test(entry.name)
        ? [target]
        : [];
  });
}

export function inspectRuntimeFeatureReachability({
  root = process.cwd(),
  catalog,
  readSource = (relative) => fs.readFileSync(path.join(root, relative), "utf8"),
} = {}) {
  const resolvedCatalog =
    catalog ??
    JSON.parse(
      fs.readFileSync(
        path.join(root, "config", "runtime-feature-reachability.json"),
        "utf8",
      ),
    );
  const errors = [];
  const ids = new Set();
  const routes = new Set();
  const evidenceFiles = new Set();

  for (const feature of resolvedCatalog.features ?? []) {
    if (ids.has(feature.id)) errors.push(`duplicate feature id: ${feature.id}`);
    if (routes.has(feature.route))
      errors.push(`duplicate route: ${feature.route}`);
    ids.add(feature.id);
    routes.add(feature.route);
    for (const [stage, reference] of [
      ["server", feature.server],
      ["transport", feature.transport],
      ...feature.consumers.map((consumer) => ["consumer", consumer]),
    ]) {
      evidenceFiles.add(reference.file);
      let source;
      try {
        source = readSource(reference.file);
      } catch {
        errors.push(`${feature.id}: missing ${stage} file ${reference.file}`);
        continue;
      }
      const occurrences = source.split(reference.marker).length - 1;
      if (occurrences !== 1) {
        errors.push(
          `${feature.id}: ${stage} marker must occur once in ${reference.file}; found ${occurrences}`,
        );
      }
    }
  }

  const allSources = sourceFiles(path.join(root, "src"));
  for (const retired of resolvedCatalog.retiredRoutes ?? []) {
    for (const file of allSources) {
      const relative = normalize(path.relative(root, file));
      if (readSource(relative).includes(retired)) {
        errors.push(`retired route ${retired} resurfaced in ${relative}`);
      }
    }
  }

  const digest = createHash("sha256");
  digest.update(JSON.stringify(resolvedCatalog));
  for (const file of [...evidenceFiles].sort()) {
    try {
      digest.update(`\n${file}\n${readSource(file)}`);
    } catch {
      // Missing files are already reported above.
    }
  }
  return {
    ok: errors.length === 0,
    featureCount: ids.size,
    retiredRouteCount: resolvedCatalog.retiredRoutes?.length ?? 0,
    evidenceFiles: [...evidenceFiles].sort(),
    evidenceDigest: `sha256:${digest.digest("hex")}`,
    errors,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = inspectRuntimeFeatureReachability();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
