import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function walk(root, relative = "") {
  return fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      return entry.isDirectory() ? walk(root, next) : [next];
    })
    .sort();
}

function hash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function buildArtifactManifest(root, revision) {
  const files = walk(root).map((file) => {
    const bytes = fs.readFileSync(path.join(root, file));
    return {
      path: file.replaceAll("\\", "/"),
      bytes: bytes.length,
      digest: hash(bytes),
    };
  });
  const payload = { schemaVersion: 1, revision, files };
  return { ...payload, digest: hash(JSON.stringify(payload)) };
}

export function verifyArtifactManifest(root, manifest) {
  const actual = buildArtifactManifest(root, manifest.revision);
  const errors = [];
  if (actual.digest !== manifest.digest)
    errors.push("artifact-manifest-digest-mismatch");
  const expectedFiles = JSON.stringify(manifest.files);
  if (JSON.stringify(actual.files) !== expectedFiles)
    errors.push("artifact-file-set-or-digest-mismatch");
  return { ok: errors.length === 0, errors, actual };
}
