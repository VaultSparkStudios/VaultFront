// proof-source-manifest.mjs — deterministic byte identity for the source set
// that a Studio Ops full-suite receipt certifies.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SOURCE_EXT = /\.(?:mjs|cjs|js|ts|json|ya?ml)$/;

function normalize(rel) {
  return String(rel || "").replace(/\\/g, "/");
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, out);
    else if (SOURCE_EXT.test(entry.name)) out.push(absolute);
  }
  return out;
}

export function proofSourceInventory(root) {
  const candidates = [
    ...walk(path.join(root, "scripts")),
    ...walk(path.join(root, "ignis", "src")),
    ...walk(path.join(root, ".github", "workflows")),
    ...["package.json", "ignis/src/package.json"]
      .map((rel) => path.join(root, rel))
      .filter(fs.existsSync),
  ].map((absolute) => ({
    absolute,
    path: normalize(path.relative(root, absolute)),
  }));
  return [...new Map(candidates.map((row) => [row.path, row])).values()].sort(
    (a, b) => a.path.localeCompare(b.path),
  );
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function manifestRoot(files) {
  const canonical = files
    .map((row) => `${row.path}\\0${row.sha256}\\n`)
    .join("");
  return hashBytes(Buffer.from(canonical, "utf8"));
}

export function buildProofSourceManifest(root) {
  const files = proofSourceInventory(root).map(({ absolute, path: rel }) => ({
    path: rel,
    sha256: hashBytes(fs.readFileSync(absolute)),
  }));
  return {
    schemaVersion: 1,
    algorithm: "sha256",
    totalFiles: files.length,
    rootHash: manifestRoot(files),
    files,
  };
}

export function validateProofSourceManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1 || manifest?.algorithm !== "sha256")
    errors.push("unsupported proof-source manifest schema or algorithm");
  if (!Array.isArray(manifest?.files))
    errors.push("proof-source manifest files missing");
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const paths = new Set();
  for (const row of files) {
    if (!row?.path || paths.has(row.path))
      errors.push(
        `missing or duplicate proof-source path: ${row?.path || "(missing)"}`,
      );
    if (!/^[a-f0-9]{64}$/.test(row?.sha256 || ""))
      errors.push(`invalid proof-source sha256: ${row?.path || "(missing)"}`);
    paths.add(row?.path);
  }
  if (manifest?.totalFiles !== files.length)
    errors.push(
      `proof-source totalFiles ${manifest?.totalFiles} != ${files.length}`,
    );
  if (files.length && manifestRoot(files) !== manifest?.rootHash)
    errors.push("proof-source rootHash does not authenticate stored entries");
  return { ok: errors.length === 0, errors };
}

export function diffProofSourceManifests(expected, actual, { limit = 8 } = {}) {
  const before = new Map(
    (expected?.files || []).map((row) => [normalize(row.path), row.sha256]),
  );
  const after = new Map(
    (actual?.files || []).map((row) => [normalize(row.path), row.sha256]),
  );
  const added = [];
  const removed = [];
  const changed = [];
  for (const [file, digest] of after) {
    if (!before.has(file)) added.push(file);
    else if (before.get(file) !== digest) changed.push(file);
  }
  for (const file of before.keys()) if (!after.has(file)) removed.push(file);
  const bounded = (rows) => rows.sort().slice(0, limit);
  return {
    added: bounded(added),
    removed: bounded(removed),
    changed: bounded(changed),
    counts: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
    },
    truncated:
      added.length > limit || removed.length > limit || changed.length > limit,
  };
}

export function formatProofSourceDiff(diff) {
  const parts = [];
  for (const key of ["added", "removed", "changed"]) {
    const count = diff?.counts?.[key] || 0;
    if (count)
      parts.push(
        `${key} ${count}: ${(diff[key] || []).join(", ")}${diff.truncated ? " …" : ""}`,
      );
  }
  return (
    parts.join(" · ") || "manifest root differs without a file-level delta"
  );
}

export default {
  proofSourceInventory,
  buildProofSourceManifest,
  validateProofSourceManifest,
  diffProofSourceManifests,
  formatProofSourceDiff,
};
