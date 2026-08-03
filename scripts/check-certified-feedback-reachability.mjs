#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const certifiedFeedbackReachabilityContract = Object.freeze([
  {
    path: "src/server/MatchFeedbackRouter.ts",
    includes: [
      '"/api/vaultfront/match-rating"',
      '"match-feedback-write"',
      "hasVerifiedCertificate",
    ],
  },
  {
    path: "config/mutation-route-policies.json",
    includes: ['"/api/vaultfront/match-rating"', '"result-certificate"'],
  },
  {
    path: "src/client/Api.ts",
    includes: ["postMatchRating", "MatchRatingSubmission", "duplicate"],
  },
  {
    path: "src/client/CertifiedMatchFeedback.ts",
    includes: ["certified-match-feedback", "postMatchRating", "retentionDays"],
  },
  {
    path: "src/client/graphics/layers/WinModal.ts",
    includes: [
      'import("../../CertifiedMatchFeedback")',
      "<certified-match-feedback",
    ],
  },
  {
    path: "tests/client/CertifiedMatchFeedback.test.ts",
    includes: [
      "already rated",
      "different match session",
      "temporarily unavailable",
    ],
  },
]);

export function checkCertifiedFeedbackReachability(root = defaultRoot) {
  const errors = [];
  const hash = createHash("sha256");
  for (const entry of certifiedFeedbackReachabilityContract) {
    const target = path.resolve(root, entry.path);
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) {
      errors.push(`${entry.path}: unsafe path`);
      continue;
    }
    let body;
    try {
      body = fs.readFileSync(target, "utf8");
    } catch {
      errors.push(`${entry.path}: missing source`);
      continue;
    }
    hash.update(entry.path);
    hash.update("\0");
    hash.update(body);
    hash.update("\0");
    for (const token of entry.includes) {
      if (!body.includes(token))
        errors.push(`${entry.path}: missing token ${JSON.stringify(token)}`);
    }
  }
  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    capability: "certified-match-feedback",
    layers: certifiedFeedbackReachabilityContract.map((entry) => entry.path),
    sourceDigest: errors.some((error) => error.endsWith("missing source"))
      ? null
      : `sha256:${hash.digest("hex")}`,
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
  const result = checkCertifiedFeedbackReachability(root);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
