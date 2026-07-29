/**
 * brief-blocks.mjs — Reusable box-drawing blocks for startup + closeout briefs (v3.1).
 *
 * Exports block renderers used by render-startup-brief.mjs + render-closeout-board.mjs.
 * Each function returns a multi-line string fragment (no trailing newline).
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const W = 62;
const BW = W + 4;

function pad(s, w) {
  const str = String(s ?? "");
  return str.length >= w ? str.slice(0, w) : str + " ".repeat(w - str.length);
}
function row(content) {
  return `║  ${pad(content, W)}  ║`;
}
function blank() {
  return `║  ${" ".repeat(W)}  ║`;
}
function top(title) {
  const t = title ? `══ ${title} ` : "";
  return "╔" + t + "═".repeat(Math.max(1, W + 2 - t.length)) + "╗";
}
function bottom() {
  return "╚" + "═".repeat(W + 2) + "╝";
}

function wrapWords(value, width = W, maxLines = 2) {
  const words = String(value ?? "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const lines = [];
  let current = "";
  while (words.length && lines.length < maxLines) {
    const word = words.shift();
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length <= width ? word : word.slice(0, width - 1) + "…";
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.length && lines.length) {
    const last = lines.length - 1;
    lines[last] = lines[last].slice(0, width - 1).trimEnd() + "…";
  }
  return lines;
}

/**
 * Render the project title header block.
 * Emoji based on type; mode from sessionMode.
 */
export function renderTitleHeader({
  name,
  type,
  lifecycle,
  audience,
  vaultStatus,
  session,
  date,
  mode = "BUILDER",
  owner,
}) {
  const emoji =
    {
      game: "🎮",
      app: "📱",
      platform: "🌐",
      infrastructure: "⚙️ ",
      novel: "📖",
      tool: "🔧",
    }[type] || "🚀";
  const nameUpper = (name || "Project").toUpperCase();
  const modeLabel = mode.toUpperCase();
  return [
    top(),
    row(`${emoji} ${nameUpper}`),
    row(
      `${type || "project"} · ${lifecycle || "—"}/${audience || "—"} · ${(vaultStatus || "FORGE").toUpperCase()}`,
    ),
    row(`Session ${session || "?"} · ${date || "—"} · ${modeLabel} MODE`),
    row(`Owner: ${owner || "VaultSpark Studios"}`),
    bottom(),
  ].join("\n");
}

/**
 * Render the "Last session · what shipped" block from PROJECT_STATUS.lastSessionSummary.
 */
export function renderLastCompleted(summary, opts = {}) {
  if (typeof summary === "string") {
    const session = summary.match(/\b(?:S|Session\s+)(\d+)\b/i)?.[1] || "?";
    const expected =
      opts.expectedSession != null ? String(opts.expectedSession) : null;
    if (expected && session !== "?" && session !== expected) {
      const fallback =
        opts.fallback ||
        "Use WHERE WE LEFT OFF and CURRENT_STATE for the live latest-session summary.";
      return [
        top(`STALE LAST SESSION SUMMARY`),
        row(`Expected S${expected}; PROJECT_STATUS summary says S${session}.`),
        row(fallback.slice(0, W)),
        row(`Repair: update PROJECT_STATUS.lastSessionSummary at closeout.`),
        bottom(),
      ].join("\n");
    }
    const summaryLines = wrapWords(summary, W, 2);
    return [
      top(`LAST SESSION (S${session}) - WHAT SHIPPED`),
      ...summaryLines.map((line) => row(line)),
      row(`Tests  ${opts.tests || "No direct suite count recorded"}`),
      row(`Deploy ${opts.deploy || "No deployment observation recorded"}`),
      bottom(),
    ].join("\n");
  }
  if (!summary) return "";
  const header = top(`LAST SESSION (S${summary.session}) · WHAT SHIPPED`);
  const shipLines = (summary.shipped || [])
    .slice(0, 5)
    .map((s) => row(`✓ ${s.slice(0, W - 2)}`));
  return [
    header,
    ...shipLines,
    row(`Tests  ${summary.tests || "—"}`),
    row(`Deploy ${summary.deploy || "—"}`),
    bottom(),
  ].join("\n");
}

/**
 * Render the "Where to test" block from PROJECT_STATUS.testingSurfaces.
 * Shows every active surface (local, staging, production, preview, supabase, etc.)
 * with URL/command and last-checked age.
 */
export function renderTestItNow({ name, testingSurfaces = [] }) {
  const header = top(`WHERE TO TEST · ${name || "Project"}`);
  if (!testingSurfaces.length) {
    return [
      header,
      row("(no testing surfaces registered — add to PROJECT_STATUS.json)"),
      bottom(),
    ].join("\n");
  }
  const typeLabel = {
    local: "Local dev     →",
    tests: "Unit tests    →",
    doctor: "Doctor        →",
    staging: "Staging       →",
    production: "Production    →",
    preview: "Preview       →",
    supabase: "Supabase      →",
    github: "GitHub        →",
    vercel: "Vercel        →",
    netlify: "Netlify       →",
    cloudflare: "CF Pages      →",
    render: "Render        →",
    railway: "Railway       →",
    hetzner: "Hetzner       →",
    custom: "Custom        →",
  };
  const statusIcon = { green: "✓", yellow: "⚠", red: "⛔", unknown: "·" };
  const lines = testingSurfaces.slice(0, 8).map((s) => {
    const label = typeLabel[s.type] || `${s.type.padEnd(12)} →`;
    const icon = statusIcon[s.status || "unknown"] || "·";
    const target = s.url || s.command || "—";
    const truncated = target.slice(0, W - label.length - 4);
    return row(`${label} ${truncated} ${icon}`);
  });
  return [header, ...lines, bottom()].join("\n");
}

/**
 * Render a compact mode-indicator line (BUILDER / FOUNDER + reason).
 * Used mid-brief to flag when mode was auto-shifted.
 */
export function renderModeBanner({ mode, auto = false, reason = "" }) {
  const modeLabel = mode.toUpperCase();
  const flag = auto ? `⚡ auto-shift: ${reason}` : "";
  const line = `Mode: ${modeLabel}${flag ? "  ·  " + flag : ""}`;
  return [top("MODE"), row(line.slice(0, W)), bottom()].join("\n");
}
