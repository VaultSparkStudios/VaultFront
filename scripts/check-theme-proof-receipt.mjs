#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeFileEvidence,
  computeThemeProofSourceEvidence,
  digestFileEvidence,
  expectedThemeProofArtifacts,
  THEME_PROOF_CLAIM_BOUNDARY,
  THEME_PROOF_PROJECTS,
  THEME_PROOF_SURFACES,
  THEME_PROOF_THEMES,
} from "./lib/theme-proof.mjs";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function compareEvidence(root, entries, label, errors) {
  for (const entry of entries ?? []) {
    if (
      !entry?.path ||
      path.isAbsolute(entry.path) ||
      entry.path.includes("..")
    ) {
      errors.push(`${label}: unsafe evidence path`);
      continue;
    }
    const target = path.join(root, entry.path);
    if (!fs.existsSync(target)) {
      errors.push(`${label}: missing ${entry.path}`);
      continue;
    }
    const current = computeFileEvidence(root, [entry.path])[0];
    if (current.digest !== entry.digest || current.bytes !== entry.bytes) {
      errors.push(`${label}: digest mismatch for ${entry.path}`);
    }
  }
}

export function checkThemeProofReceipt(root = defaultRoot, now = Date.now()) {
  const source = "docs/THEME_LOCAL_PROOF.json";
  const latest = "docs/visual-qa/LATEST.json";
  const errors = [];
  let receipt;
  let receiptBytes;
  try {
    receiptBytes = fs.readFileSync(path.join(root, source));
    receipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch (error) {
    return {
      ok: false,
      source,
      errors: [`unreadable receipt: ${String(error)}`],
    };
  }
  try {
    const latestBytes = fs.readFileSync(path.join(root, latest));
    if (!receiptBytes.equals(latestBytes))
      errors.push("LATEST receipt is not canonical");
  } catch (error) {
    errors.push(`unreadable LATEST receipt: ${String(error)}`);
  }
  if (receipt.schemaVersion !== 2) errors.push("unsupported schemaVersion");
  if (receipt.scope !== "local-only")
    errors.push("scope must remain local-only");
  if (receipt.claimBoundary !== THEME_PROOF_CLAIM_BOUNDARY)
    errors.push(
      "claim boundary must deny live staging and founder-approval claims",
    );
  const generatedAt = Date.parse(receipt.generatedAt);
  const ageDays = (now - generatedAt) / 86_400_000;
  if (!Number.isFinite(generatedAt)) errors.push("invalid generatedAt");
  else if (ageDays < -5 / 1440) errors.push("generatedAt is in the future");
  else if (ageDays > 30)
    errors.push(`receipt is stale (${ageDays.toFixed(1)} days)`);

  const currentSource = computeThemeProofSourceEvidence(root);
  if (receipt.source?.digest !== currentSource.digest)
    errors.push("theme/UI source digest is stale");
  if (
    digestFileEvidence(receipt.source?.files ?? []) !== receipt.source?.digest
  )
    errors.push("recorded source manifest digest is invalid");
  compareEvidence(root, receipt.source?.files, "source", errors);
  compareEvidence(root, receipt.evidence?.summaries, "summary", errors);
  compareEvidence(root, receipt.evidence?.artifacts, "artifact", errors);

  const expectedArtifacts = new Set(
    expectedThemeProofArtifacts("docs/visual-qa/artifacts").map(
      (item) => item.path,
    ),
  );
  const seenArtifacts = new Set(
    (receipt.evidence?.artifacts ?? []).map((item) => item.path),
  );
  for (const artifact of expectedArtifacts) {
    if (!seenArtifacts.has(artifact))
      errors.push(`missing artifact ${artifact}`);
  }
  if (seenArtifacts.size !== expectedArtifacts.size)
    errors.push("artifact matrix contains duplicate or unexpected entries");

  const seenProjects = new Set();
  for (const run of receipt.matrix ?? []) {
    seenProjects.add(run.project);
    if (run.localOnly !== true)
      errors.push(`${run.project}: localOnly must be true`);
    if (run.source?.digest !== receipt.source?.digest)
      errors.push(`${run.project}: captured source digest is stale`);
    const seenThemes = new Set();
    for (const result of run.results ?? []) {
      seenThemes.add(result.theme);
      for (const surface of THEME_PROOF_SURFACES) {
        if (!result.surfaces?.includes(surface))
          errors.push(
            `${run.project}/${result.theme}: missing ${surface} surface`,
          );
      }
      for (const [label, ratio] of Object.entries(result.ratios ?? {})) {
        if (!Number.isFinite(ratio) || ratio < 4.5)
          errors.push(
            `${run.project}/${result.theme}: ${label} contrast below 4.5`,
          );
      }
    }
    for (const theme of THEME_PROOF_THEMES) {
      if (!seenThemes.has(theme))
        errors.push(`${run.project}: missing ${theme}`);
    }
  }
  for (const project of THEME_PROOF_PROJECTS) {
    const summaryPath = `docs/visual-qa/summaries/theme-proof-${project}.json`;
    try {
      const summary = JSON.parse(
        fs.readFileSync(path.join(root, summaryPath), "utf8"),
      );
      const matrixRun = (receipt.matrix ?? []).find(
        (run) => run.project === project,
      );
      if (JSON.stringify(summary) !== JSON.stringify(matrixRun))
        errors.push(
          `${project}: matrix diverges from canonical browser summary`,
        );
    } catch (error) {
      errors.push(
        `${project}: unreadable canonical browser summary: ${String(error)}`,
      );
    }
  }
  for (const project of THEME_PROOF_PROJECTS) {
    if (!seenProjects.has(project)) errors.push(`missing project ${project}`);
  }
  return {
    ok: errors.length === 0,
    source,
    latest,
    scope: receipt.scope,
    matrixCells: (receipt.matrix ?? []).reduce(
      (sum, run) => sum + (run.results?.length ?? 0),
      0,
    ),
    artifactCount: seenArtifacts.size,
    sourceDigest: receipt.source?.digest ?? null,
    ageDays: Number.isFinite(ageDays) ? Number(ageDays.toFixed(3)) : null,
    errors,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const rootIndex = process.argv.indexOf("--root");
  const root =
    rootIndex >= 0 && process.argv[rootIndex + 1]
      ? path.resolve(process.argv[rootIndex + 1])
      : defaultRoot;
  const result = checkThemeProofReceipt(root);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
