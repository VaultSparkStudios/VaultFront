#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { spawnSync } from "./lib/safe-spawn.mjs";
import {
  computeFileEvidence,
  computeThemeProofSourceEvidence,
  expectedThemeProofArtifacts,
  sha256Bytes,
  THEME_PROOF_CLAIM_BOUNDARY,
  THEME_PROOF_PROJECTS,
  THEME_PROOF_THEMES,
} from "./lib/theme-proof.mjs";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0 ? String(result.stdout).trim() : "unknown";
}

export async function renderThemeProofReceipt(
  root = defaultRoot,
  {
    generatedAt = new Date().toISOString(),
    gitRevision = git(root, ["rev-parse", "HEAD"]),
    dirty = git(root, ["status", "--porcelain"]).length > 0,
  } = {},
) {
  const prettierOptions = {
    ...(await prettier.resolveConfig(path.join(root, "package.json"))),
    parser: "json",
  };
  const currentSource = computeThemeProofSourceEvidence(root);
  const summaryPaths = THEME_PROOF_PROJECTS.map(
    (project) => `output/playwright/theme-proof-${project}.json`,
  );
  const runs = summaryPaths.map((relativePath) =>
    JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")),
  );
  for (const run of runs) {
    if (
      run.localOnly !== true ||
      run.results?.length !== THEME_PROOF_THEMES.length ||
      run.source?.digest !== currentSource.digest
    ) {
      throw new Error(
        `incomplete or source-stale local theme proof for ${run.project}`,
      );
    }
  }
  const visualRoot = path.join(root, "docs", "visual-qa");
  const artifactRoot = path.join(visualRoot, "artifacts");
  const summaryRoot = path.join(visualRoot, "summaries");
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(summaryRoot, { recursive: true });
  const sourceArtifacts = expectedThemeProofArtifacts();
  const canonicalArtifacts = expectedThemeProofArtifacts(
    "docs/visual-qa/artifacts",
  );
  sourceArtifacts.forEach((artifact, index) => {
    fs.copyFileSync(
      path.join(root, artifact.path),
      path.join(root, canonicalArtifacts[index].path),
    );
  });
  const canonicalSummaryPaths = THEME_PROOF_PROJECTS.map(
    (project) => `docs/visual-qa/summaries/theme-proof-${project}.json`,
  );
  await Promise.all(
    summaryPaths.map(async (sourcePath, index) => {
      const canonicalPath = path.join(root, canonicalSummaryPaths[index]);
      const canonicalSummary = await prettier.format(
        fs.readFileSync(path.join(root, sourcePath), "utf8"),
        prettierOptions,
      );
      fs.writeFileSync(canonicalPath, canonicalSummary);
    }),
  );
  const artifacts = canonicalArtifacts.map((artifact) => ({
    ...artifact,
    ...computeFileEvidence(root, [artifact.path])[0],
  }));
  const summaries = computeFileEvidence(root, canonicalSummaryPaths);
  const receipt = {
    schemaVersion: 2,
    generatedAt,
    scope: "local-only",
    claimBoundary: THEME_PROOF_CLAIM_BOUNDARY,
    source: {
      gitRevision,
      dirty,
      ...currentSource,
    },
    evidence: { summaries, artifacts },
    matrix: runs,
  };
  const serialized = await prettier.format(
    JSON.stringify(receipt),
    prettierOptions,
  );
  fs.mkdirSync(visualRoot, { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "THEME_LOCAL_PROOF.json"),
    serialized,
  );
  fs.writeFileSync(
    path.join(root, "docs", "visual-qa", "LATEST.json"),
    serialized,
  );
  return {
    ok: true,
    output: "docs/THEME_LOCAL_PROOF.json",
    latest: "docs/visual-qa/LATEST.json",
    matrixCells: runs.reduce((sum, run) => sum + run.results.length, 0),
    artifacts: artifacts.length,
    sourceDigest: currentSource.digest,
    receiptDigest: sha256Bytes(serialized),
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  console.log(JSON.stringify(await renderThemeProofReceipt(), null, 2));
}
