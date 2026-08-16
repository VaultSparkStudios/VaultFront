#!/usr/bin/env node
/**
 * generate-genius-list.mjs
 *
 * Public-safe, deterministic Unified Genius List generator for VaultFront.
 * It keeps /start and /go usable even when the richer Studio Ops ranking
 * service is unavailable in this public repo.
 *
 * Usage:
 *   node scripts/generate-genius-list.mjs
 *   node scripts/generate-genius-list.mjs --brief --top 8
 *   node scripts/generate-genius-list.mjs --json
 *   node scripts/generate-genius-list.mjs --write
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findLatestAuditSidecar } from "./lib/audit-sidecar.mjs";
import { renderGeniusBrief } from "./lib/genius-brief.mjs";
import { GENIUS_CACHE_SCHEMA_VERSION } from "./lib/genius-cache.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const BRIEF = args.includes("--brief");
const WRITE = args.includes("--write");
const topIdx = args.indexOf("--top");
const TOP = topIdx >= 0 ? Number.parseInt(args[topIdx + 1] ?? "8", 10) : 12;

function readText(rel) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}
function readJson(rel, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
  } catch {
    return fallback;
  }
}
function hasFile(rel) {
  return fs.existsSync(path.join(root, rel));
}
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}
function item({
  title,
  summary,
  axis,
  effort = "30m",
  tier = "⚡",
  score = 80,
  status = "unblocked",
  blockedReason = "",
  recommendedModel = "sonnet",
  command = "",
  ...metadata
}) {
  return {
    id: slugify(title),
    slug: slugify(title),
    title,
    summary,
    axis,
    effort,
    tier,
    score,
    finalScore: score,
    status,
    blocked: ["blocked", "human-blocked", "externally-blocked"].includes(
      status,
    ),
    blockedReason,
    recommendedModel,
    command,
    ...metadata,
  };
}

const status = readJson("context/PROJECT_STATUS.json", {});
const taskBoard = readText("context/TASK_BOARD.md");
const currentState = readText("context/CURRENT_STATE.md");
const latestAudit = readText("docs/AUDIT_2026-06-13_S69.md");
const startupBrief = readText("docs/STARTUP_BRIEF.md");

const candidates = [];
const latestAuditInfo = findLatestAuditSidecar(root);
const auditSource = latestAuditInfo
  ? `docs/AUDIT_${latestAuditInfo.date}.json`
  : null;
const auditCandidates = (latestAuditInfo?.audit?.items ?? []).map(
  (auditItem) => {
    const rawStatus = String(auditItem.status ?? "pending").toLowerCase();
    const mappedStatus =
      rawStatus === "shipped" || rawStatus === "done"
        ? "done"
        : rawStatus === "pending"
          ? "unblocked"
          : rawStatus === "blocked" || rawStatus === "human-blocked"
            ? "externally-blocked"
            : rawStatus;
    return item({
      title: auditItem.title ?? auditItem.slug ?? "Untitled audit item",
      summary: auditItem.why ?? auditItem.summary ?? "Audit-ranked work item.",
      axis: auditItem.axis ?? "audit",
      effort: auditItem.effortHours
        ? `${auditItem.effortHours}h`
        : "unspecified",
      tier: auditItem.tier ?? "⚡",
      score: Math.max(1, Math.round(Number(auditItem.priority ?? 0) * 2)),
      status: mappedStatus,
      blockedReason: auditItem.blockedReason ?? "",
      recommendedModel: auditItem.recommendedModel ?? "sonnet",
      command: auditItem.command ?? "",
      auditSource,
      auditSlug: auditItem.slug,
      recipe: auditItem.recipe ?? "",
      executionLog: auditItem.executionLog ?? [],
    });
  },
);

function completionNote(title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = taskBoard.match(
    new RegExp(`^[-*]\\s+\\[done\\][^\\n]*${escaped}[^\\n]*DONE[^\\n]*`, "im"),
  );
  return match?.[0]?.replace(/^[-*]\s+\[done\]\s*/i, "") ?? "";
}

if (
  !hasFile("scripts/cache-genius-list.mjs") ||
  !hasFile("scripts/generate-genius-list.mjs")
) {
  candidates.push(
    item({
      title: "Restore /go genius-list cache helpers",
      summary:
        "Restore the missing generator/cache scripts so /start can embed a ranked hit list and /go can run without empty-cache fallback.",
      axis: "process / automation",
      effort: "45m",
      tier: "🔥",
      score: 96,
      recommendedModel: "sonnet",
      command: "node scripts/cache-genius-list.mjs --write",
    }),
  );
}

if (!hasFile("context/.session-lock")) {
  candidates.push(
    item({
      title: "Recreate active session lock before sprint work",
      summary:
        "Write the Codex session lock and render a fresh startup brief so /go satisfies the canonical preflight.",
      axis: "process / continuity",
      effort: "10m",
      tier: "🔥",
      score: 94,
      command:
        "node scripts/ops.mjs write-session-lock --agent codex --note go-protocol-repair",
    }),
  );
}

const hasAlphaGate =
  /alphaGate/.test(currentState) || /alphaGate/.test(latestAudit);
if (hasAlphaGate) {
  candidates.push(
    item({
      title: "Alpha Gate Passport verification smoke",
      summary:
        "Run focused pulse/readiness/sidebar checks to prove the shipped Alpha Gate Passport contract still works after protocol repair.",
      axis: "feedback_loop / automation",
      effort: "20m",
      tier: "🔥",
      score: 90,
      command:
        "npx vitest run tests/server/VaultFrontPlaytestPulse.test.ts tests/server/VaultFrontReadiness.test.ts tests/client/graphics/layers/GameRightSidebarVaultFeed.test.ts",
    }),
  );
}

if (/operatorNext|KPI Alpha Gate|alpha gate/i.test(taskBoard + currentState)) {
  candidates.push(
    item({
      title: "Document next alpha-gate operator action",
      summary:
        "Keep public-safe task/status records pointed at the operatorNext-guided rivalry/rematch gate without claiming real tester evidence.",
      axis: "process / truth",
      effort: "20m",
      tier: "⚡",
      score: 84,
      command: "node scripts/validate-task-ids.mjs",
    }),
  );
}

if (
  (status.revenueSignalStatus ?? "").includes("unverified") ||
  /Revenue sig\.\s+not found/i.test(startupBrief)
) {
  candidates.push(
    item({
      title: "Keep revenue warning honest",
      summary:
        "Verify the startup/readiness surfaces still warn until a real checkout or supporter signal is observed.",
      axis: "capital_efficiency / truth",
      effort: "20m",
      tier: "⚡",
      score: 82,
      command: "npm test -- --runInBand",
    }),
  );
}

candidates.push(
  item({
    title: "Production build regression gate",
    summary:
      "Run the production build after protocol changes so generated startup/go helpers do not hide a deploy regression.",
    axis: "dev_health / automation",
    effort: "20m",
    tier: "⚡",
    score: 78,
    command: "npm run build-prod",
  }),
);

candidates.push(
  item({
    title: "Manual rivalry/rematch alpha playtest",
    summary:
      "Run a real internal rivalry/rematch playtest and require all five Alpha Gate Passport checks to turn green from evidence.",
    axis: "feedback_loop / launch",
    effort: "1h",
    tier: "🔥",
    score: 76,
    status: "human-blocked",
    blockedReason:
      "Requires real tester/manual playtest evidence; instrumentation cannot replace the evidence.",
    recommendedModel: "sonnet",
  }),
);

candidates.push(
  item({
    title: "Observe live checkout/supporter event",
    summary:
      "Only clear the revenue warning after a real checkout or supporter telemetry event exists.",
    axis: "capital_efficiency / revenue",
    effort: "manual",
    tier: "⚠",
    score: 70,
    status: "human-blocked",
    blockedReason: "Requires real revenue/supporter event evidence.",
    recommendedModel: "sonnet",
  }),
);

const seen = new Set();
const rankedCandidates =
  auditCandidates.length > 0 ? auditCandidates : candidates;
const items = rankedCandidates
  .filter((candidate) => {
    if (seen.has(candidate.slug)) return false;
    seen.add(candidate.slug);
    return true;
  })
  .map((candidate) => {
    if (candidate.auditSource) return candidate;
    const done = completionNote(candidate.title);
    return done
      ? { ...candidate, status: "done", blocked: false, doneNote: done }
      : candidate;
  })
  .sort((a, b) => b.score - a.score)
  .map((candidate, index) => ({ rank: index + 1, ...candidate }));

const generatedAt = new Date().toISOString();
const payload = {
  schemaVersion: GENIUS_CACHE_SCHEMA_VERSION,
  project: status.slug ?? "vaultfront",
  generatedAt,
  ignisSource: auditSource ? "latest-audit-sidecar" : "fallback",
  auditSource,
  source: "scripts/generate-genius-list.mjs",
  items,
};

function renderMarkdown(list) {
  const lines = [
    "<!-- generated-by: scripts/generate-genius-list.mjs -->",
    `<!-- generated-at: ${generatedAt} -->`,
    "",
    "# Unified Genius List",
    "",
    `Project: ${payload.project}`,
    `IGNIS source: ${payload.ignisSource}`,
    "",
  ];
  for (const entry of list) {
    lines.push(`## ${entry.rank}. ${entry.title}`);
    lines.push("");
    lines.push(
      `**Tier:** ${entry.tier} · **Axis:** ${entry.axis} · **Effort:** ${entry.effort} · **Score:** ${entry.score}`,
    );
    lines.push("");
    lines.push(entry.summary);
    lines.push("");
    lines.push(
      `Status: ${entry.status}${entry.doneNote ? ` — ${entry.doneNote}` : ""}${entry.blockedReason ? ` — ${entry.blockedReason}` : ""}`,
    );
    lines.push(`Recommended model: ${entry.recommendedModel}`);
    if (entry.command) {
      lines.push("");
      lines.push("```bash");
      lines.push(entry.command);
      lines.push("```");
    }
    lines.push("");
  }
  return lines.join("\n");
}

if (WRITE) {
  fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".cache", "genius-list.json"),
    JSON.stringify(payload, null, 2) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "docs", "GENIUS_LIST.md"),
    renderMarkdown(items),
    "utf8",
  );
}

if (JSON_OUT) {
  console.log(JSON.stringify(payload, null, 2));
} else if (BRIEF) {
  console.log(renderGeniusBrief(items, { top: TOP, auditSource }));
} else {
  console.log(renderMarkdown(items));
}
