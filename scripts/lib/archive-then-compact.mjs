import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function archiveBeforeMutate({
  sourcePath,
  content,
  archiveRoot = null,
  label = "archive",
  nowIso = null,
  suffix = ".full.md",
} = {}) {
  if (!sourcePath) throw new Error("archiveBeforeMutate requires sourcePath");
  const original = content ?? fs.readFileSync(sourcePath, "utf8");
  const iso = nowIso || new Date().toISOString();
  const stamp = iso.replace(/[:.]/g, "-");
  const dateDir = iso.slice(0, 10);
  const safeLabel =
    String(label || "archive")
      .replace(/[^a-z0-9_.-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "archive";
  const base =
    path.basename(sourcePath, path.extname(sourcePath)) || "artifact";
  const slug = path.basename(path.dirname(path.dirname(sourcePath))) || base;
  const root =
    archiveRoot || path.join(os.homedir(), ".claude", "memory-archive");
  const archiveDir = path.join(root, `${dateDir}-${safeLabel}`);
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(
    archiveDir,
    `${slug}-${base}.${stamp}${suffix}`,
  );
  fs.writeFileSync(archivePath, original, "utf8");
  return {
    archivePath,
    archiveRel: archivePath.replace(os.homedir(), "~"),
    bytes: Buffer.byteLength(original, "utf8"),
  };
}
