import fs from "node:fs";
import path from "node:path";

const FULL_SHA = /^[0-9a-f]{40}$/u;
const DIGEST_IMAGE = /@sha256:[0-9a-f]{64}(?:\s|$)/u;
const MANIFEST_DIGEST = /^sha256:[0-9a-f]{64}$/u;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}

export function checkReleaseInputTrust(root, { release = false } = {}) {
  const errors = [];
  const warnings = [];
  for (const file of walk(path.join(root, ".github", "workflows")).filter(
    (item) => /\.ya?ml$/u.test(item),
  )) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\buses:\s*([^\s#]+)(?:\s*#.*)?$/gmu)) {
      if (match[1].startsWith("./")) continue;
      const ref = match[1].split("@")[1] ?? "";
      if (!FULL_SHA.test(ref))
        errors.push(`${path.relative(root, file)}: mutable action ${match[1]}`);
    }
    if (/ssh-keyscan/u.test(text))
      errors.push(
        `${path.relative(root, file)}: runtime ssh-keyscan is forbidden`,
      );
  }

  const evidencePath = path.join(root, "config", "release-trust-evidence.json");
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const requireVerifiedImageEvidence = (source, reference) => {
    const digest = reference.match(/@(sha256:[0-9a-f]{64})$/u)?.[1];
    const record = evidence.containerImages?.find(
      (item) => item.source === source && item.reference === reference,
    );
    if (
      !digest ||
      !record ||
      record.status !== "verified" ||
      record.manifestDigest !== digest ||
      !MANIFEST_DIGEST.test(record.manifestDigest ?? "") ||
      !/^docker\.io\/library\/[a-z0-9._-]+$/u.test(record.registry ?? "") ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/u.test(
        record.sourceRepository ?? "",
      ) ||
      !FULL_SHA.test(record.sourceRevision ?? "") ||
      !Number.isFinite(Date.parse(record.observedAt ?? "")) ||
      !record.verification?.trim()
    ) {
      errors.push(
        `${source}: pinned image ${reference} lacks matching verified registry provenance`,
      );
    }
  };
  const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
  const dockerImages = [...dockerfile.matchAll(/^FROM\s+([^\s]+).*$/gmu)]
    .map((match) => match[1])
    .filter((reference) => reference !== "base");
  const unpinned = dockerImages.filter(
    (reference) => !DIGEST_IMAGE.test(reference),
  );
  for (const reference of [...new Set(unpinned)]) {
    const record = evidence.containerImages?.find(
      (item) => item.source === "Dockerfile" && item.reference === reference,
    );
    if (!record || record.status !== "unresolved-external" || !record.reason)
      errors.push(
        `Dockerfile: unpinned image ${reference} lacks explicit unresolved evidence`,
      );
    else
      warnings.push(`release blocked on image digest evidence: ${reference}`);
  }
  for (const reference of [...new Set(dockerImages)].filter((item) =>
    DIGEST_IMAGE.test(item),
  )) {
    requireVerifiedImageEvidence("Dockerfile", reference);
  }
  const migrationWorkflowPath = path.join(
    root,
    ".github",
    "workflows",
    "db-migrate.yml",
  );
  const migrationWorkflow = fs.readFileSync(migrationWorkflowPath, "utf8");
  for (const match of migrationWorkflow.matchAll(
    /^\s*image:\s*([^\s#]+).*$/gmu,
  )) {
    const reference = match[1];
    if (reference.includes("@sha256:")) {
      requireVerifiedImageEvidence(
        ".github/workflows/db-migrate.yml",
        reference,
      );
      continue;
    }
    const record = evidence.containerImages?.find(
      (item) =>
        item.source === ".github/workflows/db-migrate.yml" &&
        item.reference === reference,
    );
    if (!record || record.status !== "unresolved-external" || !record.reason)
      errors.push(
        `db-migrate.yml: unpinned service image ${reference} lacks explicit unresolved evidence`,
      );
    else
      warnings.push(
        `release blocked on service image digest evidence: ${reference}`,
      );
  }
  if (release && warnings.length) errors.push(...warnings);
  return {
    ok: errors.length === 0,
    releaseReady: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
  };
}
