import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkThemeProofReceipt } from "../../scripts/check-theme-proof-receipt.mjs";
import {
  computeThemeProofSourceEvidence,
  THEME_PROOF_PROJECTS,
  THEME_PROOF_SURFACES,
  THEME_PROOF_THEMES,
} from "../../scripts/lib/theme-proof.mjs";
import { renderThemeProofReceipt } from "../../scripts/render-theme-proof-receipt.mjs";
import { PROCESS_INTEGRATION_TIMEOUT_MS } from "../helpers/processBudget";

const fixtures: string[] = [];
afterEach(() => {
  while (fixtures.length)
    fs.rmSync(fixtures.pop()!, { recursive: true, force: true });
});

async function fixture(now: number) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "vaultfront-theme-proof-"),
  );
  fixtures.push(root);
  for (const relativePath of [
    "e2e/theme-visual-proof.spec.ts",
    "src/client/BrandTheme.ts",
    "src/client/UserSettingModal.ts",
    "src/client/styles.css",
    "src/client/components/PlayPage.ts",
    "src/client/styles/core/variables.css",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, relativePath), `fixture:${relativePath}`);
  }
  fs.mkdirSync(path.join(root, "output", "playwright"), { recursive: true });
  const source = computeThemeProofSourceEvidence(root);
  for (const project of THEME_PROOF_PROJECTS) {
    const results = THEME_PROOF_THEMES.map((theme) => ({
      theme,
      surfaces: [...THEME_PROOF_SURFACES],
      ratios: { text: 7, muted: 4.5 },
    }));
    fs.writeFileSync(
      path.join(root, "output", "playwright", `theme-proof-${project}.json`),
      JSON.stringify({ project, localOnly: true, source, results }),
    );
    for (const theme of THEME_PROOF_THEMES) {
      for (const surface of THEME_PROOF_SURFACES) {
        fs.writeFileSync(
          path.join(
            root,
            "output",
            "playwright",
            `${project}-${theme}-${surface}.png`,
          ),
          `${project}:${theme}:${surface}`,
        );
      }
    }
  }
  await renderThemeProofReceipt(root, {
    generatedAt: new Date(now).toISOString(),
    gitRevision: "fixture-revision",
    dirty: false,
  });
  return root;
}

describe("local theme proof receipt", () => {
  it(
    "accepts a complete source- and artifact-bound matrix",
    async () => {
      const now = Date.UTC(2026, 6, 21);
      expect(checkThemeProofReceipt(await fixture(now), now)).toMatchObject({
        ok: true,
        scope: "local-only",
        matrixCells: 6,
        artifactCount: 36,
        errors: [],
      });
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );

  it(
    "fails artifact tampering and touched-source invalidation",
    async () => {
      const now = Date.UTC(2026, 6, 21);
      const artifactRoot = await fixture(now);
      fs.appendFileSync(
        path.join(
          artifactRoot,
          "docs/visual-qa/artifacts/chromium-light-play.png",
        ),
        "tamper",
      );
      expect(
        checkThemeProofReceipt(artifactRoot, now).errors.join(" "),
      ).toMatch(/artifact: digest mismatch/);

      const sourceRoot = await fixture(now);
      fs.appendFileSync(
        path.join(sourceRoot, "src/client/styles.css"),
        "tamper",
      );
      expect(checkThemeProofReceipt(sourceRoot, now).errors.join(" ")).toMatch(
        /source digest is stale/,
      );
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );

  it(
    "remains independently verifiable after ephemeral browser output is removed",
    async () => {
      const now = Date.UTC(2026, 6, 21);
      const root = await fixture(now);
      fs.rmSync(path.join(root, "output"), { recursive: true, force: true });
      expect(checkThemeProofReceipt(root, now)).toMatchObject({
        ok: true,
        artifactCount: 36,
        errors: [],
      });
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );

  it(
    "fails stale, live-claiming, low-contrast, and noncanonical receipts",
    async () => {
      const now = Date.UTC(2026, 6, 21);
      const root = await fixture(now);
      const receiptPath = path.join(root, "docs/THEME_LOCAL_PROOF.json");
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      receipt.generatedAt = new Date(now - 31 * 86_400_000).toISOString();
      receipt.scope = "staging";
      receipt.matrix[0].results[0].ratios.text = 4.49;
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      const report = checkThemeProofReceipt(root, now);
      expect(report.ok).toBe(false);
      expect(report.errors.join(" ")).toMatch(
        /LATEST receipt is not canonical/,
      );
      expect(report.errors.join(" ")).toMatch(/local-only/);
      expect(report.errors.join(" ")).toMatch(/stale/);
      expect(report.errors.join(" ")).toMatch(/contrast/);
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );
});
