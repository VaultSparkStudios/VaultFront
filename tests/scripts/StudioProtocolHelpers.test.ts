import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "../../scripts/lib/safe-spawn.mjs";
import {
  checkTileBudgets,
  enforceTileBudgets,
  validateStartupBrief,
} from "../../scripts/validate-brief-format.mjs";
import { PROCESS_INTEGRATION_TIMEOUT_MS } from "../helpers/processBudget";

const root = path.resolve(__dirname, "../..");
const tempDirs: string[] = [];

function tempSecretsDir() {
  const dir = path.join(
    os.tmpdir(),
    `vaultfront-secrets-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function runCheckSecrets(
  args: string[],
  secretsDir: string,
  studioOpsSecretsDir = path.join(secretsDir, "__missing_studio_ops__"),
) {
  return spawnSync(process.execPath, ["scripts/check-secrets.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      VAULTSPARK_SECRETS_DIR_OVERRIDE: secretsDir,
      STUDIO_OPS_SECRETS_DIR: studioOpsSecretsDir,
    },
  });
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Studio protocol helper regressions", () => {
  it("fails stale startup briefs even when required boxes are present", () => {
    const body = [
      "<!-- brief-coherent: false -->",
      "╔══ SCORE ═══════════════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ SIGNALS ═════════════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ WHERE WE LEFT OFF ═══════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ GENIUS HIT LIST ═════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
    ].join("\n");

    const result = validateStartupBrief(body);

    expect(result.ok).toBe(false);
    expect(result.staleBrief).toContain("brief-coherent: false");
  });

  it("rejects arithmetic contradictions and zero-evidence SIL forecasts", () => {
    const body = [
      "<!-- brief-coherent: true -->",
      "╔══ SCORE ═══════════════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ SIGNALS ═════════════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ WHERE WE LEFT OFF ═══════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ CONTEXT METER ═══════════════════════════════════════════════╗",
      "║  80% used                                                    ║",
      "║  8,331 / 1,000,000 tok                                       ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ SIL FORECAST (next session) ═════════════════════════════════╗",
      "║  Projected: 0/1000                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ GENIUS HIT LIST ═════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
    ].join("\n");

    const result = validateStartupBrief(body);

    expect(result.ok).toBe(false);
    expect(result.semanticContradictions).toHaveLength(2);
    expect(result.semanticContradictions[0]).toContain("token arithmetic");
    expect(result.semanticContradictions[1]).toContain("parsed SIL evidence");
  });

  it("attributes oversized brief tiles and trims them explicitly", () => {
    const hugeTile = [
      "╔══ GENIUS HIT LIST ═════════════════════════════════════════════╗",
      ...Array.from(
        { length: 140 },
        (_, idx) =>
          `║  #${idx.toString().padStart(3, "0")} ${"x".repeat(80)}  ║`,
      ),
      "╚═══════════════════════════════════════════════════════════════╝",
    ].join("\n");

    const before = checkTileBudgets(hugeTile);
    const { body, trimmed } = enforceTileBudgets(hugeTile);
    const after = checkTileBudgets(body);

    expect(before.overBudget[0].title).toBe("GENIUS HIT LIST");
    expect(trimmed[0].title).toBe("GENIUS HIT LIST");
    expect(body).toContain("trimmed (tile budget");
    expect(after.overBudget).toHaveLength(0);
  });

  it(
    "resolves capability readiness from the secrets gateway override",
    () => {
      const secretsDir = tempSecretsDir();
      writeFileSync(
        path.join(secretsDir, "CAPABILITY_MAP.json"),
        JSON.stringify(
          {
            capabilities: {
              "demo.ready": { env: ["DEMO_SECRET"] },
              "demo.missing": { env: ["MISSING_SECRET"] },
            },
          },
          null,
          2,
        ),
      );
      writeFileSync(
        path.join(secretsDir, "demo.env"),
        "DEMO_SECRET=ready-value-123\n",
      );

      const ready = runCheckSecrets(
        ["--for", "demo.ready", "--json"],
        secretsDir,
      );
      const missing = runCheckSecrets(
        ["--for", "demo.missing", "--json"],
        secretsDir,
      );

      expect(ready.status).toBe(0);
      expect(JSON.parse(ready.stdout)[0]).toMatchObject({
        capability: "demo.ready",
        ok: true,
        found: ["DEMO_SECRET"],
      });
      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stdout)[0]).toMatchObject({
        capability: "demo.missing",
        ok: false,
        missing: ["MISSING_SECRET"],
      });
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );

  it(
    "layers the sibling capability authority under deterministic local overrides",
    () => {
      const localDir = tempSecretsDir();
      const studioOpsDir = tempSecretsDir();
      writeFileSync(
        path.join(studioOpsDir, "CAPABILITY_MAP.json"),
        JSON.stringify({
          capabilities: {
            "base.only": { env: ["BASE_ONLY_SECRET"] },
            "shared.capability": { env: ["BASE_SHARED_SECRET"] },
          },
        }),
      );
      writeFileSync(
        path.join(localDir, "CAPABILITY_MAP.json"),
        JSON.stringify({
          capabilities: {
            "local.only": { env: ["LOCAL_ONLY_SECRET"] },
            "shared.capability": { env: ["LOCAL_SHARED_SECRET"] },
          },
        }),
      );
      writeFileSync(
        path.join(studioOpsDir, "studio.env"),
        "BASE_ONLY_SECRET=base-ready-123\nBASE_SHARED_SECRET=base-shared-123\n",
      );
      writeFileSync(
        path.join(localDir, "local.env"),
        "LOCAL_ONLY_SECRET=local-ready-123\nLOCAL_SHARED_SECRET=local-shared-123\n",
      );

      const siblingOnly = runCheckSecrets(
        ["--for", "base.only", "--json"],
        localDir,
        studioOpsDir,
      );
      const overridden = runCheckSecrets(
        ["--for", "shared.capability", "--json"],
        localDir,
        studioOpsDir,
      );
      const listed = runCheckSecrets(["--json"], localDir, studioOpsDir);

      expect(siblingOnly.status).toBe(0);
      expect(JSON.parse(siblingOnly.stdout)[0]).toMatchObject({
        capability: "base.only",
        required: ["BASE_ONLY_SECRET"],
        found: ["BASE_ONLY_SECRET"],
      });
      expect(overridden.status).toBe(0);
      expect(JSON.parse(overridden.stdout)[0]).toMatchObject({
        capability: "shared.capability",
        required: ["LOCAL_SHARED_SECRET"],
        found: ["LOCAL_SHARED_SECRET"],
      });
      expect(
        JSON.parse(listed.stdout).map(
          (row: { capability: string }) => row.capability,
        ),
      ).toEqual(["base.only", "local.only", "shared.capability"]);
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );

  it.each([
    ["studio-ops", true],
    ["project-local", false],
  ])(
    "fails loudly when the %s capability authority is corrupt",
    (layer, corruptBase) => {
      const localDir = tempSecretsDir();
      const studioOpsDir = tempSecretsDir();
      writeFileSync(
        path.join(studioOpsDir, "CAPABILITY_MAP.json"),
        corruptBase ? "{not-json" : JSON.stringify({ capabilities: {} }),
      );
      writeFileSync(
        path.join(localDir, "CAPABILITY_MAP.json"),
        corruptBase ? JSON.stringify({ capabilities: {} }) : "{not-json",
      );

      const result = runCheckSecrets(["--json"], localDir, studioOpsDir);

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        `${layer} CAPABILITY_MAP.json is present but UNPARSEABLE`,
      );
      expect(result.stderr).not.toContain("0/0 capabilities ready");
    },
    15_000,
  );
});

describe("public protocol compatibility", () => {
  it("parses compact public task bullets and human-blocked tasks", async () => {
    const { parseHumanItems, parseUnifiedItems } =
      await import("../../scripts/lib/task-board.mjs");
    const board = [
      "## Unified Genius List (Session 73)",
      "",
      "- [done] 🔥 feedback_loop / automation · 20m · Alpha evidence — verified",
      "- [human-blocked] ⚠ launch · manual · Real playtest — requires people",
    ].join("\n");

    expect(parseUnifiedItems(board)).toMatchObject([
      { status: "done", tier: "🔥", effort: "20m", title: "Alpha evidence" },
      {
        status: "human-blocked",
        tier: "⚠",
        effort: "manual",
        title: "Real playtest",
      },
    ]);
    expect(parseHumanItems(board)[0].title).toBe("Real playtest");
  });

  it("extracts the labeled intent used by current public handoffs", async () => {
    const { extractCurrentSessionIntent } =
      await import("../../scripts/lib/task-board.mjs");
    expect(
      extractCurrentSessionIntent(
        "# Handoff\n\n## Where We Left Off — today\n\n**Session Intent:** Ship the recovery arc.\n",
      ),
    ).toBe("Ship the recovery arc.");
  });

  it("uses one task parser for bullet, table, and explicit parse-error states", async () => {
    const { parseTaskBoardResult } =
      await import("../../scripts/lib/cross-repo-tasks.mjs");
    const bullet = parseTaskBoardResult(
      "## Unified Genius List\n\n- [pending] 🔥 reliability · 2h · Source coherence — verify\n",
    );
    const table = parseTaskBoardResult(
      "## Unified Genius List\n\n| 1 | ⚡ | release | pending | 1h | **Digest gate** — verify |\n",
    );
    const malformed = parseTaskBoardResult(
      "## Unified Genius List\n\n- [pending] not-canonical\n",
    );

    expect(bullet).toMatchObject({
      state: "ok",
      items: [{ title: "Source coherence" }],
    });
    expect(table).toMatchObject({
      state: "ok",
      items: [{ title: "Digest gate" }],
    });
    expect(malformed).toMatchObject({ state: "parse-error", items: [] });
  });

  it("invalidates a young brief when any canonical source hash moves", async () => {
    const fixture = tempSecretsDir();
    mkdirSync(path.join(fixture, "context"), { recursive: true });
    mkdirSync(path.join(fixture, "docs"), { recursive: true });
    const files: Record<string, string> = {
      "context/PROJECT_STATUS.json": JSON.stringify({ currentSession: 9 }),
      "context/TASK_BOARD.md": "## Unified Genius List (Session 9)\n",
      "context/LATEST_HANDOFF.md": "## Session 9\n",
      "context/SELF_IMPROVEMENT_LOOP.md": "## Session 9\n",
      "docs/GENIUS_LIST.md": "# Genius\n",
    };
    for (const [relative, body] of Object.entries(files)) {
      writeFileSync(path.join(fixture, relative), body);
    }
    const { buildBriefSourceManifest } =
      await import("../../scripts/lib/brief-freshness.mjs");
    const { checkBriefFreshness } =
      await import("../../scripts/check-brief-staleness.mjs");
    const marker = JSON.stringify(buildBriefSourceManifest(fixture));
    writeFileSync(
      path.join(fixture, "docs/STARTUP_BRIEF.md"),
      `<!-- brief-sources: ${marker} -->\n`,
    );
    expect(checkBriefFreshness({ root: fixture }).stale).toBe(false);
    writeFileSync(
      path.join(fixture, "context/LATEST_HANDOFF.md"),
      "## Session 10\n",
    );
    expect(checkBriefFreshness({ root: fixture })).toMatchObject({
      stale: true,
      reason: expect.stringMatching(/session drift|hash drift/),
    });
  });

  it("keeps the startup brief producer wired to the freshness manifest consumer", () => {
    const renderer = readFileSync(
      path.join(root, "scripts/render-startup-brief.mjs"),
      "utf8",
    );
    expect(renderer).toContain(
      'import { buildBriefSourceManifest } from "./lib/brief-freshness.mjs";',
    );
    expect(renderer).toContain(
      "const briefSourceManifest = buildBriefSourceManifest(root);",
    );
    expect(renderer).toContain(
      "<!-- brief-sources: ${JSON.stringify(briefSourceManifest)} -->",
    );
  });

  it("keeps ephemeral checkout mirrors outside direct verification discovery", () => {
    const viteConfig = readFileSync(path.join(root, "vite.config.ts"), "utf8");
    const prettierIgnore = readFileSync(
      path.join(root, ".prettierignore"),
      "utf8",
    );
    expect(viteConfig).toContain('"**/.cache/**"');
    expect(prettierIgnore.split(/\r?\n/u)).toContain(".cache/");
  });

  it("tracks every core renderer source, including missing-to-present transitions", async () => {
    const fixture = tempSecretsDir();
    mkdirSync(path.join(fixture, "context"), { recursive: true });
    mkdirSync(path.join(fixture, "docs"), { recursive: true });
    const baseline: Record<string, string> = {
      "context/PROJECT_STATUS.json": JSON.stringify({ currentSession: 12 }),
      "context/TASK_BOARD.md": "## Session 12\n",
      "context/LATEST_HANDOFF.md": "## Session 12\n",
      "context/SELF_IMPROVEMENT_LOOP.md": "## Session 12\n",
      "context/TRUTH_AUDIT.md": "# Truth\n",
      "context/CURRENT_STATE.md": "# Current\n",
      "docs/GENIUS_LIST.md": "# Genius\n",
      "docs/CREATIVE_DIRECTION_RECORD.md": "# Creative\n",
    };
    for (const [relative, body] of Object.entries(baseline)) {
      writeFileSync(path.join(fixture, relative), body);
    }
    const { buildBriefSourceManifest, evaluateBriefSourceFreshness } =
      await import("../../scripts/lib/brief-freshness.mjs");
    const pristine = buildBriefSourceManifest(fixture);

    for (const relative of [
      "context/TRUTH_AUDIT.md",
      "context/CURRENT_STATE.md",
      "docs/CREATIVE_DIRECTION_RECORD.md",
    ]) {
      writeFileSync(
        path.join(fixture, relative),
        `${baseline[relative]}changed\n`,
      );
      expect(
        evaluateBriefSourceFreshness(
          fixture,
          `<!-- brief-sources: ${JSON.stringify(pristine)} -->`,
        ),
      ).toMatchObject({ fresh: false, changed: [relative] });
      writeFileSync(path.join(fixture, relative), baseline[relative]);
    }

    writeFileSync(path.join(fixture, "docs/SESSION_PLAN.md"), "# New plan\n");
    expect(
      evaluateBriefSourceFreshness(
        fixture,
        `<!-- brief-sources: ${JSON.stringify(pristine)} -->`,
      ),
    ).toMatchObject({
      fresh: false,
      changed: ["docs/SESSION_PLAN.md"],
    });
  });

  it(
    "scans dynamic TypeScript child-process imports and the live deploy contract",
    async () => {
      const fixture = tempSecretsDir();
      const file = path.join(fixture, "dynamic.ts");
      const rawModule = ["node", "child_process"].join(":");
      writeFileSync(file, `const cp = await import("${rawModule}");\n`);
      const { scanDirectChildProcessImports } =
        await import("../../scripts/check-windows-hide.mjs");
      expect(scanDirectChildProcessImports(fixture)).toHaveLength(1);
      const contract = spawnSync(
        process.execPath,
        ["scripts/check-deploy-contract.mjs"],
        {
          cwd: root,
          encoding: "utf8",
        },
      );
      expect(contract.status).toBe(0);
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );

  it("classifies lint-staged residue without treating it as committed work", async () => {
    const { classifyRecovery } =
      await import("../../scripts/classify-recovery-provenance.mjs");
    const result = classifyRecovery({
      status: [
        { status: " M", path: "prompts/start.md" },
        { status: "??", path: "src/new.ts" },
      ],
      stashes: "stash@{0} On main: lint-staged automatic backup",
      markerFiles: [],
    });

    expect(result.ok).toBe(true);
    expect(result.lintStagedBackups).toHaveLength(1);
    expect(result.counts).toMatchObject({
      "propagated-protocol": 1,
      "current-work": 1,
    });
  });

  it("treats unresolved merge markers as corruption", async () => {
    const { classifyRecovery } =
      await import("../../scripts/classify-recovery-provenance.mjs");
    const result = classifyRecovery({
      status: [],
      markerFiles: ["prompts/start.md"],
    });
    expect(result).toMatchObject({
      ok: false,
      corrupt: true,
      unresolvedMergeMarkers: ["prompts/start.md"],
    });
  });
});

describe("startup observability contracts", () => {
  it("derives context usage from tokens and limit instead of pctUsed shape", async () => {
    const { deriveContextUsage } =
      await import("../../scripts/lib/context-verdicts.mjs");

    expect(
      deriveContextUsage({
        usedTokens: 8_331,
        limit: 1_000_000,
        pctUsed: 0.8,
      }),
    ).toMatchObject({
      fraction: 0.008331,
      percent: 0.8331,
      roundedPercent: 1,
      remainingTokens: 991_669,
    });
    expect(
      deriveContextUsage({ usedTokens: 1_500, limit: 1_000 }),
    ).toMatchObject({ fraction: 1, percent: 100, remainingTokens: 0 });
  });

  it("parses current and legacy SIL shapes by actual session recency", async () => {
    const { forecastNext, parseSilHistory } =
      await import("../../scripts/lib/sil-forecaster.mjs");
    const ledger = [
      "## Sprint: 2026-07-16 — Session 74 Saturated Arc (SIL: 968/1000)",
      "| Category | Score | Evidence |",
      "| Dev Health | 99 | green |",
      "| Creative Alignment | 98 | aligned |",
      "| Momentum | 100 | shipped |",
      "| Engagement | 86 | honest |",
      "| Process Quality | 99 | verified |",
      "| Cross-Repo Coherence | 97 | cargo |",
      "| Security Posture | 99 | guarded |",
      "| Ecosystem Integration | 91 | partial |",
      "| Capital Efficiency | 100 | bounded |",
      "| Automation Coverage | 99 | automated |",
      "| **Total** | **968/1000** | exact |",
      "",
      "## 2026-07-19 — Session 75 | Total: 979/1000 | Velocity: 11",
      "| SIL v3 category | Score | Evidence |",
      "| Dev Health | 100 | green |",
      "| Creative Alignment | 99 | aligned |",
      "| Momentum | 100 | shipped |",
      "| Engagement | 90 | honest |",
      "| Process Quality | 100 | verified |",
      "| Cross-Repo Coherence | 97 | cargo |",
      "| Security Posture | 100 | guarded |",
      "| Ecosystem Integration | 93 | partial |",
      "| Capital Efficiency | 100 | bounded |",
      "| Automation Coverage | 100 | automated |",
      "| **Total** | **979/1000** | exact |",
      "",
      "## 2026-06-01 — Session 10 | Total: 700/1000",
      "| 1 | Dev Health | 70 | legacy |",
    ].join("\n");

    const sessions = parseSilHistory(ledger);
    expect(
      sessions.slice(0, 2).map(({ session, total }) => ({ session, total })),
    ).toEqual([
      { session: 75, total: 979 },
      { session: 74, total: 968 },
    ]);
    expect(sessions[0].categories).toMatchObject({
      "Dev Health": 100,
      "Cross-Repo Coher": 97,
      "Automation Cover": 100,
    });
    expect(
      forecastNext(sessions, { velocity: 11 })?.totalPredicted,
    ).toBeGreaterThan(950);
    expect(
      forecastNext([{ session: 1, total: 100, categories: {} }]),
    ).toBeNull();
  });
});
