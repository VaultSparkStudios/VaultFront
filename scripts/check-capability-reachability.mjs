#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function sha256Files(root, files) {
  const hash = createHash("sha256");
  for (const relativePath of [...files].sort()) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, relativePath)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function checkCapabilityReachability(root = defaultRoot) {
  const manifestPath = path.join(
    root,
    "public",
    "capability-reachability.json",
  );
  const agentsPath = path.join(root, "public", "agents.json");
  const errors = [];
  let manifest;
  let agents;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      errors: [`manifest unreadable: ${String(error)}`],
      capabilities: [],
    };
  }
  try {
    agents = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
  } catch (error) {
    errors.push(`agents.json unreadable: ${String(error)}`);
  }
  if (manifest.schemaVersion !== "1.0")
    errors.push("unsupported schemaVersion");
  if (manifest.releasePosture !== "implemented-local-unlaunched")
    errors.push("releasePosture must remain implemented-local-unlaunched");
  if (agents?.availability?.publicRuntime !== "unavailable")
    errors.push("agents.json must not claim a public runtime");
  if (agents?.endpoints?.capabilityManifest !== "/capability-reachability.json")
    errors.push("agents.json must link the capability manifest");

  const ids = new Set();
  const sourceFiles = new Set([
    "public/capability-reachability.json",
    "public/agents.json",
  ]);
  const capabilities = [];
  for (const capability of manifest.capabilities ?? []) {
    const capabilityErrors = [];
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(capability.id ?? ""))
      capabilityErrors.push("invalid id");
    if (ids.has(capability.id)) capabilityErrors.push("duplicate id");
    ids.add(capability.id);
    if (!Array.isArray(capability.evidence) || capability.evidence.length === 0)
      capabilityErrors.push("missing evidence");
    for (const evidence of capability.evidence ?? []) {
      const relativePath = String(evidence.path ?? "").replace(/\\/g, "/");
      const absolutePath = path.resolve(root, relativePath);
      const insideRoot = absolutePath.startsWith(
        `${path.resolve(root)}${path.sep}`,
      );
      if (!insideRoot || relativePath.startsWith("../")) {
        capabilityErrors.push(`unsafe evidence path: ${relativePath}`);
        continue;
      }
      sourceFiles.add(relativePath);
      let body;
      try {
        body = fs.readFileSync(absolutePath, "utf8");
      } catch {
        capabilityErrors.push(`missing evidence file: ${relativePath}`);
        continue;
      }
      for (const token of evidence.includes ?? []) {
        if (
          typeof token !== "string" ||
          token.length === 0 ||
          token.length > 256
        )
          capabilityErrors.push(`${relativePath}: invalid evidence token`);
        else if (!body.includes(token))
          capabilityErrors.push(
            `${relativePath}: missing token ${JSON.stringify(token)}`,
          );
      }
    }
    errors.push(
      ...capabilityErrors.map((error) => `${capability.id}: ${error}`),
    );
    capabilities.push({
      id: capability.id,
      audience: capability.audience,
      status:
        capabilityErrors.length === 0 ? "reachable-in-source" : "unreachable",
      errors: capabilityErrors,
    });
  }
  if (capabilities.length < 6)
    errors.push("capability graph is unexpectedly thin");
  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    releasePosture: manifest.releasePosture,
    publicRuntime: agents?.availability?.publicRuntime ?? "unknown",
    manifest: "public/capability-reachability.json",
    sourceDigest: errors.some((error) =>
      error.includes("missing evidence file"),
    )
      ? null
      : sha256Files(root, sourceFiles),
    capabilities,
    errors,
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const rootIndex = process.argv.indexOf("--root");
  const root =
    rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : defaultRoot;
  const result = checkCapabilityReachability(root);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
