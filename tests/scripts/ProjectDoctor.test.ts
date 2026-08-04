import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildProjectTruthFingerprint,
  evaluateProjectTruth,
} from "../../scripts/lib/project-truth.mjs";
import { spawnSync } from "../../scripts/lib/safe-spawn.mjs";
import { PROCESS_INTEGRATION_TIMEOUT_MS } from "../helpers/processBudget";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("truthful project doctor", () => {
  it("flags a public audience with exempt-internal fixture data", () => {
    const result = evaluateProjectTruth({
      status: {
        audience: "public-unlaunched",
        freeTierCostStatus: "exempt-internal",
      },
      canonAdoption: "| CANON-011 | Sitemap | exempt (internal) | |",
    });

    expect(result.ok).toBe(false);
    expect(result.contradictions).toHaveLength(2);
    expect(result.contradictions[0].id).toBe(
      "public-audience-internal-exemption",
    );
  });

  it(
    "propagates a forced probe failure through JSON and the process exit",
    () => {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/project-doctor.mjs",
          "--json",
          "--truth-only",
          "--force-failure",
        ],
        { cwd: root, encoding: "utf8" },
      );
      const payload = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(payload).toMatchObject({
        source: "scripts/project-doctor.mjs",
        blockingFailing: expect.any(Number),
        observedAt: expect.any(String),
        checks: expect.any(Array),
        warnings: expect.any(Array),
      });
      expect(payload.blockingFailing).toBeGreaterThanOrEqual(1);
      expect(payload.checks).toContainEqual(
        expect.objectContaining({
          id: "forced-failure",
          status: "fail",
          exitCode: 17,
        }),
      );
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );

  it(
    "runs the truth probe against an isolated fixture root",
    () => {
      const fixture = fs.mkdtempSync(
        path.join(os.tmpdir(), "vaultfront-truth-"),
      );
      fs.mkdirSync(path.join(fixture, "context"), { recursive: true });
      fs.writeFileSync(
        path.join(fixture, "context", "PROJECT_STATUS.json"),
        JSON.stringify({ audience: "internal" }),
      );
      fs.writeFileSync(
        path.join(fixture, "context", "CANON_ADOPTION.md"),
        "Audience: internal\n",
      );
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, "scripts", "check-project-truth.mjs"),
          "--root",
          fixture,
          "--json",
        ],
        { cwd: root, encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        audience: "internal",
        contradictions: [],
      });
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );
});

describe("project manifest coherence", () => {
  it("fails closed when generated identity and public posture drift", () => {
    const result = evaluateProjectTruth({
      status: {
        type: "game",
        lifecycle: "alpha",
        audience: "public-unlaunched",
        freeTierCostStatus: "cost-neutral",
      },
      studioManifest: {
        identity: {
          type: "app",
          lifecycle: "concept",
          audience: "internal",
        },
        listingMetadata: { categories: ["game", "internal"] },
        publicMetadata: {
          privateByDefault: true,
          publicReady: false,
          publicRepoSanitized: false,
          brandingRequired: false,
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.contradictions.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "project-manifest-identity-mismatch",
        "public-manifest-private-posture",
        "public-manifest-branding-disabled",
        "public-manifest-sanitization-stale",
        "public-manifest-internal-category",
      ]),
    );
  });

  it("fingerprints cross-surface release truth deterministically and tamper-sensitively", () => {
    const input = {
      status: {
        type: "game",
        lifecycle: "alpha",
        audience: "public-unlaunched",
        stage: "FORGE",
      },
      studioManifest: {
        identity: {
          type: "game",
          lifecycle: "alpha",
          audience: "public-unlaunched",
        },
        publicMetadata: {
          privateByDefault: false,
          publicReady: false,
          publicRepoSanitized: true,
          brandingRequired: true,
        },
      },
      footerManifest: {
        schemaVersion: 2,
        pages: [{ route: "/" }],
        headerLinks: [{ href: "/" }],
        footerLinks: [{ href: "/" }],
      },
      sourceDigests: {
        deployment: `sha256:${"a".repeat(64)}`,
        footer: `sha256:${"b".repeat(64)}`,
        identity: `sha256:${"c".repeat(64)}`,
      },
    };

    const original = buildProjectTruthFingerprint(input);
    const reordered = buildProjectTruthFingerprint({
      ...input,
      sourceDigests: {
        identity: input.sourceDigests.identity,
        footer: input.sourceDigests.footer,
        deployment: input.sourceDigests.deployment,
      },
    });
    const tampered = buildProjectTruthFingerprint({
      ...input,
      status: { ...input.status, lifecycle: "production" },
    });

    expect(original.evaluation.ok).toBe(true);
    expect(original.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reordered.fingerprint).toBe(original.fingerprint);
    expect(tampered.fingerprint).not.toBe(original.fingerprint);

    const incomplete = buildProjectTruthFingerprint({
      ...input,
      sourceDigests: { ...input.sourceDigests, deployment: null },
    });
    expect(incomplete.evaluation.ok).toBe(false);
    expect(incomplete.evaluation.contradictionIds).toContain(
      "project-truth-source-missing:deployment",
    );
  });

  it("accepts the checked-in public-unlaunched manifest snapshot", async () => {
    const { readProjectTruthInputs } =
      await import("../../scripts/lib/project-truth.mjs");
    const result = evaluateProjectTruth(readProjectTruthInputs(root));

    expect(result).toMatchObject({
      ok: true,
      audience: "public-unlaunched",
      manifestAudience: "public-unlaunched",
      contradictions: [],
    });
  });
});
