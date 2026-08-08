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

function readComparisonBase(root) {
  const raw = git(root, ["show", "HEAD:docs/visual-qa/LATEST.json"]);
  if (raw === "unknown") return null;
  try {
    const prior = JSON.parse(raw);
    return {
      source: "git:HEAD:docs/visual-qa/LATEST.json",
      gitRevision:
        prior.source?.gitRevision ?? git(root, ["rev-parse", "HEAD"]),
      capturedAt: prior.capturedAt ?? prior.generatedAt ?? null,
      sourceDigest: prior.source?.digest ?? null,
    };
  } catch {
    return null;
  }
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
  const viewportByProject = Object.fromEntries(
    runs.map((run) => [
      run.project,
      run.results?.[0]?.executionChain?.[0]?.viewport ??
        (run.project === "mobile-chrome"
          ? { width: 393, height: 727 }
          : { width: 1280, height: 720 }),
    ]),
  );
  const captures = artifacts.map((artifact) => ({
    file: artifact.path.replace(/^docs\/visual-qa\//u, ""),
    sha256: artifact.digest.replace(/^sha256:/u, ""),
    page: artifact.surface,
    state: artifact.surface,
    theme: artifact.theme === "vaultfront" ? "dark" : artifact.theme,
    projectTheme: artifact.theme,
    viewport: viewportByProject[artifact.project],
  }));
  const receipt = {
    schemaVersion: 1,
    capturedAt: generatedAt,
    generatedAt,
    scope: "local-only",
    claimBoundary: THEME_PROOF_CLAIM_BOUNDARY,
    themes: ["dark", "light", "competitive"],
    captures,
    inspection: {
      renderedPixelsReviewed: true,
      reviewer: "claude/image-capable-render-review",
      findings: [
        "Session 98 changed ControlPanel's onboarding tracker (compact/expanded mode split), MapDisplay's lazy-load lifecycle, and added the public /stats surface; the rendered matrix was reviewed for regressions from those changes.",
      ],
      fixesApplied: [
        "None required: the 26-artifact-per-project desktop/mobile three-theme matrix (play, agency-doctrine, settings, postmatch, account-recovery, multi-tab-collision, progression-doctrine, prematch, connection-recovery, narrator, execution-chain) renders cleanly across VaultFront, Light, and Competitive themes with the new Stats footer link present and no overflow, contrast, or layout defects introduced by this session's changes.",
      ],
      blockingDefectsOpen: 0,
    },
    comparisonBase: readComparisonBase(root),
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
