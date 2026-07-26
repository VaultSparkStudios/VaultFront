#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  findLatestAuditSidecar,
  readAuditSidecar,
} from "./lib/audit-sidecar.mjs";

function effort(hours) {
  if (hours == null) return "";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours}h`;
}

function status(value) {
  return (
    { shipped: "✓", deferred: "↷", blocked: "⛔", pending: "·" }[value] ?? "·"
  );
}

export function renderAudit(audit, date) {
  const lines = [
    `<!-- generated-by: render-audit-md.mjs — DERIVED FROM AUDIT_${date}.json; do not hand-edit -->`,
    "",
    `# Project Audit — ${audit.project?.name ?? audit.project?.slug ?? "Unknown"}`,
    "",
    "> Source of truth: the JSON sidecar. Edit JSON, then re-render.",
    "",
    "## Ranked Plan",
    "",
    "| # | Tier | Axis | Effort | Impact | Innov | Priority | Status | Item |",
    "|---|:-:|---|---|:-:|:-:|:-:|:-:|---|",
  ];
  for (const item of audit.items ?? []) {
    lines.push(
      `| ${item.id ?? ""} | ${item.tier ?? ""} | ${item.axis ?? ""} | ${effort(item.effortHours)} | ${item.impact ?? ""} | ${item.innovation ?? ""} | ${Number(item.priority ?? 0).toFixed(1)} | ${status(item.status)} | **${item.slug}** — ${item.title ?? ""}. ${item.why ?? ""} **Recipe:** ${item.recipe ?? ""} |`,
    );
  }
  const ladderItems = (audit.items ?? []).filter((item) => item.ladder);
  if (ladderItems.length) {
    lines.push("", "## Depth Ladder", "");
    for (const item of ladderItems) {
      lines.push(`### ${item.slug}`);
      for (const rung of ["L1", "L2", "L3"]) {
        if (!item.ladder[rung]) continue;
        lines.push(
          `- **${rung}** — ${item.ladder[rung].recipe ?? item.ladder[rung]}`,
        );
      }
      lines.push("");
    }
  }
  const logged = (audit.items ?? []).filter(
    (item) => item.executionLog?.length,
  );
  if (logged.length) {
    lines.push("## Execution Log", "");
    for (const item of logged) {
      lines.push(`### ${item.slug}`);
      for (const entry of item.executionLog) {
        if (typeof entry === "string") {
          lines.push(`- ${entry}`);
          continue;
        }
        lines.push(
          `- \`${entry.at ?? entry.date ?? "unknown"}\` · **${entry.status ?? "noted"}** · ${entry.note ?? entry.result ?? ""}`,
        );
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const args = process.argv.slice(2);
const dateIndex = args.indexOf("--date");
const requestedDate = dateIndex >= 0 ? args[dateIndex + 1] : null;
const root = process.cwd();
const selected = requestedDate
  ? { date: requestedDate, audit: readAuditSidecar(root, requestedDate) }
  : findLatestAuditSidecar(root);

if (!selected?.audit) {
  console.error("No readable docs/AUDIT_<date>.json sidecar found");
  process.exit(1);
}

const output = path.join(root, "docs", `AUDIT_${selected.date}.md`);
fs.writeFileSync(output, renderAudit(selected.audit, selected.date));
console.log(
  `Rendered ${output} from JSON (${selected.audit.items?.length ?? 0} items)`,
);
