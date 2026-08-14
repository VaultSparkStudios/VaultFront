#!/usr/bin/env node
// Cross-repo TASK_BOARD aggregator.
// Reads context/TASK_BOARD.md for every project in portfolio/PROJECT_REGISTRY.json,
// parses the Unified Genius List table (+ legacy Now/Next buckets as fallback),
// and returns per-project + aggregate counts so the startup/closeout briefs
// can surface a stackable picture of everything open across the studio.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseUnifiedItems } from "./task-board.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.resolve(__dirname, "..", "..");

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
function readJson(p, fb) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fb;
  }
}

function extractSection(content, heading) {
  const parts = content.split(/^## /m);
  const match = parts.find((p) => p.startsWith(heading));
  if (!match) return "";
  const nl = match.indexOf("\n");
  return nl === -1 ? "" : match.slice(nl + 1);
}

function tierFromCell(cell) {
  if (cell.includes("🔥")) return "critical";
  if (cell.includes("⚡")) return "high";
  if (cell.includes("💡")) return "medium";
  if (cell.includes("🔧")) return "low";
  return "medium";
}

export function parseTaskBoard(content) {
  return parseTaskBoardResult(content).items;
}

export function parseTaskBoardResult(content) {
  const source = String(content ?? "");
  const items = [];
  const unifiedSection = extractSection(content, "Unified Genius List");
  if (unifiedSection) {
    for (const item of parseUnifiedItems(source)) {
      const tier = tierFromCell(item.tier);
      const isDone = /done|shipped/i.test(item.status) || /✅/.test(item.tier);
      items.push({
        rank: item.rankNumber,
        tier,
        cat: (item.category || "").toLowerCase(),
        status: (item.status || "").toLowerCase(),
        effort: item.effort,
        title: item.title.slice(0, 120),
        source: "unified",
        done: isDone,
      });
    }
    const candidateRows = unifiedSection
      .split(/\r?\n/)
      .filter((line) => /^\s*(?:\|\s*[\d.]+\s*\||-\s*\[[^\]]+\])/.test(line));
    if (candidateRows.length > 0 && items.length === 0) {
      return {
        state: "parse-error",
        errors: [
          "Unified Genius List contains task-like rows but none match the canonical table or bullet schema.",
        ],
        items: [],
      };
    }
  }

  // Fallback: legacy Now/Next buckets for repos that have not adopted the unified table.
  if (items.length === 0) {
    const nowLines = extractSection(content, "Now")
      .split(/\r?\n/)
      .filter((l) => /^- \[ \]/.test(l));
    const nextLines = extractSection(content, "Next")
      .split(/\r?\n/)
      .filter((l) => /^- \[ \]/.test(l));
    nowLines.forEach((l, i) =>
      items.push({
        rank: i + 1,
        tier: "critical",
        cat: "legacy",
        status: "unblocked",
        effort: "",
        title: l
          .replace(/^- \[ \]\s*/, "")
          .replace(/\*\*/g, "")
          .slice(0, 120),
        source: "legacy-now",
        done: false,
      }),
    );
    nextLines.forEach((l, i) =>
      items.push({
        rank: 100 + i,
        tier: "high",
        cat: "legacy",
        status: "unblocked",
        effort: "",
        title: l
          .replace(/^- \[ \]\s*/, "")
          .replace(/\*\*/g, "")
          .slice(0, 120),
        source: "legacy-next",
        done: false,
      }),
    );
  }

  const hasSupportedSection =
    Boolean(unifiedSection) ||
    Boolean(extractSection(source, "Now")) ||
    Boolean(extractSection(source, "Next"));
  return {
    state: hasSupportedSection ? "ok" : "unsupported",
    errors: hasSupportedSection
      ? []
      : ["No Unified Genius List or legacy Now/Next task section was found."],
    items,
  };
}

function classifyStatus(s) {
  // Returns 'unblocked' | 'blocked' | 'done'
  if (!s) return "unblocked";
  if (/done/i.test(s)) return "done";
  if (
    /block|lock|human|external|hub|gated|deferred|waiting|staged|pending|approval/i.test(
      s,
    )
  )
    return "blocked";
  return "unblocked";
}

export function loadProjectTaskBoard(project) {
  if (!project?.localPath) return null;
  const tbPath = path.join(project.localPath, "context", "TASK_BOARD.md");
  if (!fs.existsSync(tbPath))
    return { slug: project.slug, name: project.name, present: false };
  const content = readText(tbPath);
  const items = parseTaskBoard(content).filter((i) => !i.done);
  let unblocked = 0,
    blocked = 0,
    critical = 0,
    high = 0;
  for (const it of items) {
    const bucket = classifyStatus(it.status);
    if (bucket === "blocked") blocked++;
    else if (bucket === "unblocked") unblocked++;
    it.bucket = bucket;
    if (it.tier === "critical") critical++;
    else if (it.tier === "high") high++;
  }
  return {
    slug: project.slug,
    name: project.name,
    localPath: project.localPath,
    vaultStatus: project.vaultStatus || "forge",
    audience: project.audience,
    present: true,
    remaining: items.length,
    unblocked,
    blocked,
    critical,
    high,
    items,
  };
}

export function loadPortfolioTaskBoards(options = {}) {
  const studioRoot = options.studioRoot || STUDIO_ROOT;
  const registry = readJson(
    path.join(studioRoot, "portfolio", "PROJECT_REGISTRY.json"),
    { projects: [] },
  );
  const currentRepoPath = options.currentRepoPath || studioRoot;
  const currentRepoAbs = path.resolve(currentRepoPath);

  const byProject = [];
  let totalRemaining = 0,
    totalUnblocked = 0,
    totalBlocked = 0,
    totalCritical = 0,
    totalHigh = 0;
  let projectsWithWork = 0,
    projectsScanned = 0,
    projectsMissing = 0;

  for (const project of registry.projects ?? []) {
    if (!project.localPath) continue;
    const loaded = loadProjectTaskBoard(project);
    if (!loaded) continue;
    loaded.isCurrent = path.resolve(project.localPath) === currentRepoAbs;
    projectsScanned++;
    if (!loaded.present) {
      projectsMissing++;
      byProject.push(loaded);
      continue;
    }
    if (loaded.remaining > 0) projectsWithWork++;
    totalRemaining += loaded.remaining;
    totalUnblocked += loaded.unblocked;
    totalBlocked += loaded.blocked;
    totalCritical += loaded.critical;
    totalHigh += loaded.high;
    byProject.push(loaded);
  }

  // Sort: current repo first, then by unblocked desc, then by remaining desc.
  byProject.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if ((b.unblocked ?? 0) !== (a.unblocked ?? 0))
      return (b.unblocked ?? 0) - (a.unblocked ?? 0);
    return (b.remaining ?? 0) - (a.remaining ?? 0);
  });

  return {
    generatedAt: new Date().toISOString(),
    projectsScanned,
    projectsMissing,
    projectsWithWork,
    totals: {
      remaining: totalRemaining,
      unblocked: totalUnblocked,
      blocked: totalBlocked,
      critical: totalCritical,
      high: totalHigh,
    },
    byProject,
  };
}

// CLI entrypoint — print summary if run directly.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cross-repo-tasks.mjs")
) {
  const asJson = process.argv.includes("--json");
  const result = loadPortfolioTaskBoards();
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  console.log(
    `Portfolio task-board scan — ${result.projectsScanned} repos (${result.projectsMissing} missing TASK_BOARD, ${result.projectsWithWork} with open work)`,
  );
  console.log(
    `Totals: ${result.totals.remaining} remaining · ${result.totals.unblocked} unblocked · ${result.totals.blocked} blocked · 🔥 ${result.totals.critical} · ⚡ ${result.totals.high}`,
  );
  console.log("");
  const rows = result.byProject.filter((p) => p.present && p.remaining > 0);
  const w = Math.max(...rows.map((p) => (p.name || p.slug || "").length), 10);
  console.log(`${"Project".padEnd(w)}  rem  unb  blk  🔥  ⚡`);
  for (const p of rows) {
    const prefix = p.isCurrent ? "→ " : "  ";
    console.log(
      `${prefix}${(p.name || p.slug).padEnd(w - 2)}  ${String(p.remaining).padStart(3)}  ${String(p.unblocked).padStart(3)}  ${String(p.blocked).padStart(3)}  ${String(p.critical).padStart(2)}  ${String(p.high).padStart(2)}`,
    );
  }
}
