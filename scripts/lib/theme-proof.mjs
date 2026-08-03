import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const THEME_PROOF_PROJECTS = Object.freeze([
  "chromium",
  "mobile-chrome",
]);
export const THEME_PROOF_THEMES = Object.freeze([
  "vaultfront",
  "light",
  "competitive",
]);
export const THEME_PROOF_SURFACES = Object.freeze([
  "play",
  "settings",
  "postmatch",
]);
export const THEME_PROOF_CLAIM_BOUNDARY =
  "This is local browser evidence, not live staging parity or founder approval.";

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function walkFiles(root, relativeDirectory) {
  const absolute = path.join(root, relativeDirectory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    return entry.isDirectory()
      ? walkFiles(root, relativePath)
      : [normalize(relativePath)];
  });
}

export function collectThemeProofSourceFiles(root) {
  const fixed = [
    "e2e/theme-visual-proof.spec.ts",
    "src/client/BrandTheme.ts",
    "src/client/Api.ts",
    "src/client/CertifiedMatchFeedback.ts",
    "src/client/PostMatchContinuation.ts",
    "src/client/PostMatchContinuationCard.ts",
    "src/client/PostMatchContinuationPolicy.ts",
    "src/client/SeasonPassTrack.ts",
    "src/client/UserSettingModal.ts",
    "src/client/graphics/layers/WinModal.ts",
    "src/client/styles.css",
  ];
  return [
    ...fixed,
    ...walkFiles(root, "src/client/components"),
    ...walkFiles(root, "src/client/styles"),
  ]
    .filter((relativePath, index, all) => all.indexOf(relativePath) === index)
    .filter((relativePath) => fs.existsSync(path.join(root, relativePath)))
    .sort();
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function computeFileEvidence(root, relativePaths) {
  return relativePaths.map((relativePath) => {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    return {
      path: normalize(relativePath),
      bytes: bytes.byteLength,
      digest: sha256Bytes(bytes),
    };
  });
}

export function digestFileEvidence(entries) {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(String(entry.bytes));
    hash.update("\0");
    hash.update(entry.digest);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function computeThemeProofSourceEvidence(root) {
  const files = computeFileEvidence(root, collectThemeProofSourceFiles(root));
  return { digest: digestFileEvidence(files), files };
}

export function expectedThemeProofArtifacts(
  baseDirectory = "output/playwright",
) {
  return THEME_PROOF_PROJECTS.flatMap((project) =>
    THEME_PROOF_THEMES.flatMap((theme) =>
      THEME_PROOF_SURFACES.map((surface) => ({
        project,
        theme,
        surface,
        path: `${baseDirectory}/${project}-${theme}-${surface}.png`,
      })),
    ),
  );
}
