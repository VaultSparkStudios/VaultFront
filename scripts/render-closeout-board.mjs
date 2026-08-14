#!/usr/bin/env node
/**
 * render-closeout-board.mjs (v1.1)
 *
 * Renders docs/CLOSEOUT_STATUS_BOARD.md — the canonical end-of-session board
 * checked by validate-closeout-board-format.mjs. Composed from live state:
 *   - PROJECT_STATUS.json (session, SIL category scores)
 *   - LATEST_HANDOFF.md (latest "Where We Left Off" / shipped bullets)
 *   - git status (write-back coverage + uncommitted summary)
 *   - context/PROJECT_STATUS.json doctor block + tests
 *   - .cache/genius-list.json (next session's #1 hit)
 *
 * Produces 7 mandatory blocks: SESSION CLOSEOUT, WHAT SHIPPED, SCORES,
 * WRITE-BACK STATUS, GIT STATUS, POST-SESSION SIGNALS, NEXT SESSION.
 *
 * Usage:
 *   node scripts/render-closeout-board.mjs              # write file
 *   node scripts/render-closeout-board.mjs --stdout     # write to stdout instead
 *   node scripts/ops.mjs closeout-board
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  readGeniusCache,
  selectFirstPendingUnblocked,
} from "./lib/genius-cache.mjs";
import { formatTruthGenome } from "./lib/project-status-contract.mjs";
import { spawnSync } from "./lib/safe-spawn.mjs";
import {
  resolveTestSignal,
  testSignalMark,
  testSignalSeverity,
} from "./lib/test-signal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.resolve(__dirname, "..");

// S114 — accept --project <path> to render for a project repo other than studio-ops.
// Without --project, renders for studio-ops itself (backward-compatible).
const projectArgIdx = process.argv.indexOf("--project");
const PROJECT_ROOT =
  projectArgIdx >= 0 && process.argv[projectArgIdx + 1]
    ? path.resolve(process.cwd(), process.argv[projectArgIdx + 1])
    : STUDIO_ROOT;

const ROOT = PROJECT_ROOT; // back-compat alias
const STATUS_PATH = path.join(PROJECT_ROOT, "context", "PROJECT_STATUS.json");
const HANDOFF_PATH = path.join(PROJECT_ROOT, "context", "LATEST_HANDOFF.md");
const REGISTRY_PATH = path.join(
  STUDIO_ROOT,
  "portfolio",
  "PROJECT_REGISTRY.json",
); // always read from studio-ops
const geniusCacheArgIdx = process.argv.indexOf("--genius-cache");
const GENIUS_CACHE =
  geniusCacheArgIdx >= 0 && process.argv[geniusCacheArgIdx + 1]
    ? path.resolve(process.cwd(), process.argv[geniusCacheArgIdx + 1])
    : path.join(PROJECT_ROOT, ".cache", "genius-list.json");
const OUT_PATH = path.join(PROJECT_ROOT, "docs", "CLOSEOUT_STATUS_BOARD.md");

const STDOUT_MODE = process.argv.includes("--stdout");

const W = 62;
const pad = (s, w = W) => {
  const str = String(s ?? "");
  return str.length >= w ? str.slice(0, w) : str + " ".repeat(w - str.length);
};
const row = (s) => `║  ${pad(s)}  ║`;
const blank = () => `║  ${" ".repeat(W)}  ║`;
const top = (title) => {
  const t = title ? `══ ${title} ` : "";
  return "╔" + t + "═".repeat(Math.max(1, W + 2 - t.length)) + "╗";
};
const bottom = () => "╚" + "═".repeat(W + 2) + "╝";

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function sh(cmd) {
  const r = spawnSync(cmd, {
    shell: true,
    windowsHide: true,
    cwd: ROOT,
    encoding: "utf8",
  });
  return { out: r.stdout || "", err: r.stderr || "", code: r.status ?? -1 };
}

function projectName() {
  const status = readJson(STATUS_PATH);
  if (status?.name) return status.name;
  const reg = readJson(REGISTRY_PATH);
  const slug = path.basename(ROOT);
  const entry = reg?.projects?.find(
    (p) => p.slug === slug || p.localPath?.endsWith(slug),
  );
  return entry?.name || "Studio Ops";
}

/**
 * Canonical live URL surface — picks the most authoritative URL from registry.
 * Order: runtimeUrl → liveUrl → deployedUrl → stagingUrl (with badge).
 * Returns null for FORGE projects without any URL (suppress empty line).
 * Used by SESSION CLOSEOUT block per founder directive S114: one-click jump
 * to live project from the closeout brief.
 */
function canonicalLiveUrl() {
  const status = readJson(STATUS_PATH);
  const reg = readJson(REGISTRY_PATH);
  const slug = path.basename(ROOT).toLowerCase();
  const entry = reg?.projects?.find(
    (p) =>
      p.slug?.toLowerCase() === slug ||
      p.localPath?.toLowerCase()?.endsWith(slug) ||
      p.folderName?.toLowerCase() === slug,
  );
  // Prefer status.runtimeUrl if set (per-project authoritative); fall back to registry.
  const candidates = [
    status?.runtimeUrl,
    entry?.runtimeUrl,
    entry?.liveUrl,
    entry?.deployedUrl,
  ].filter(Boolean);
  if (candidates.length > 0) {
    const url = candidates[0];
    const vs = (entry?.vaultStatus || "").toUpperCase();
    const isLive = vs === "SPARKED";
    return { url, badge: isLive ? "🌐 LIVE" : "preview", type: "production" };
  }
  // Fallback to staging if SPARKED is in-flight
  if (entry?.stagingUrl)
    return { url: entry.stagingUrl, badge: "staging", type: "staging" };
  return null;
}

/**
 * Explicit deployment surface (S183 founder directive): the closeout board must
 * always show BOTH the staging/testing URL and the live URL, each with an honest
 * status — never collapse them, never hide one. `internal` / pre-deploy projects
 * render N/A (truthful, not blank). Auto-sourced from the registry so it can't
 * drift from PROJECT_STATUS.
 */
function deploymentRows() {
  const status = readJson(STATUS_PATH);
  const reg = readJson(REGISTRY_PATH);
  const slug = path.basename(ROOT).toLowerCase();
  const entry =
    reg?.projects?.find(
      (p) =>
        p.slug?.toLowerCase() === slug ||
        p.localPath?.toLowerCase()?.endsWith(slug) ||
        p.folderName?.toLowerCase() === slug,
    ) || {};
  const stagingType = status?.stagingType ?? entry?.stagingType;
  const stagingUrl = status?.stagingUrl ?? entry?.stagingUrl;
  const liveUrl =
    status?.runtimeUrl ||
    entry?.runtimeUrl ||
    entry?.liveUrl ||
    entry?.deployedUrl;
  const vs = (entry?.vaultStatus || "").toUpperCase();

  // Staging row
  let staging;
  if (stagingType === "none")
    staging = "N/A — internal/exempt (stagingType: none)";
  else if (stagingUrl)
    staging = `${stagingUrl}  ·  ${stagingType || "staging"}`;
  else staging = `not configured  ·  type: ${stagingType || "—"}`;

  // Live row
  let live;
  if (liveUrl && vs === "SPARKED") live = `${liveUrl}  ·  🌐 LIVE (SPARKED)`;
  else if (liveUrl)
    live = `${liveUrl}  ·  preview/${vs || "FORGE"} (not yet SPARKED)`;
  else if (vs === "VAULTED") live = "N/A — VAULTED (paused)";
  else live = "N/A — pre-deploy (FORGE)";

  return { staging, live };
}

function parseShippedFromHandoff() {
  const body = readText(HANDOFF_PATH);
  if (!body) return [];
  const match =
    body.match(/^##\s+Where We Left Off[\s\S]*?(?=^##\s|\Z)/m) ||
    body.match(/^#\s+(?:S\d+\s+|Session\s+\d+\s+).*?\n([\s\S]*?)(?=^#\s|\Z)/m);
  const segment = match ? match[0] : body.slice(0, 4000);
  const bullets = segment
    .split("\n")
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, "").trim())
    .filter((l) => l.length > 4)
    .slice(0, 5);
  return bullets;
}

function parseShippedFromGitLog() {
  // Fallback when LATEST_HANDOFF lacks parseable bullets: surface the last
  // meaningful commits on the current branch so the closeout board never
  // shows the placeholder. Skip auto-generated noise (genius cache refreshes,
  // protocol-sync bots, merge commits) so the surface stays signal-dense.
  const r = sh('git log -n 30 --pretty=format:"%s"');
  if (r.code !== 0 || !r.out.trim()) return [];
  const NOISE_PATTERNS = [
    /^Merge\b/i,
    /^chore\(genius\): refresh cache/i,
    /^chore\(protocol-sync\)/i,
    /^chore\(propagation\)/i,
    /^chore\(rotation\)/i,
    /studio-ops-bot/i,
  ];
  const seen = new Set();
  const out = [];
  for (const raw of r.out.split("\n")) {
    const subject = raw.trim();
    if (!subject) continue;
    if (NOISE_PATTERNS.some((re) => re.test(subject))) continue;
    if (seen.has(subject)) continue;
    seen.add(subject);
    out.push(subject);
    if (out.length >= 5) break;
  }
  return out;
}

function silCategoryRows(status) {
  const SIL_CATS = [
    ["Dev Health", "devHealth"],
    ["Alignment", "creativeAlignment"],
    ["Momentum", "momentum"],
    ["Engagement", "engagement"],
    ["Process Qual", "processQuality"],
    ["Coherence", "crossRepoCoherence"],
    ["Security", "securityPosture"],
    ["Ecosystem", "ecosystemIntegration"],
    ["Capital", "capitalEfficiency"],
    ["Automation", "automationCoverage"],
  ];
  const cats = status?.silCategoriesV3 || status?.silCategories || {};
  return SIL_CATS.map(([label, key]) => {
    const v = cats[key];
    const score =
      typeof v === "number" ? v : typeof v?.score === "number" ? v.score : null;
    if (score == null) return `  ${pad(label, 18)} —`;
    const bar =
      "█".repeat(Math.round(score / 10)) +
      "░".repeat(10 - Math.round(score / 10));
    return `  ${pad(label, 18)} ${pad(String(score), 4)} ${bar}`;
  });
}

function gitChangeSummary() {
  const s = sh("git status --short");
  const lines = s.out.split("\n").filter((l) => l.trim());
  const counts = { M: 0, A: 0, D: 0, R: 0, "??": 0 };
  for (const ln of lines) {
    const code = ln.slice(0, 2).trim() || "??";
    if (code in counts) counts[code]++;
    else counts.M++;
  }
  return { lines, counts, total: lines.length };
}

function agentMemoryRecentlyTouched() {
  // Check whether agent memory (~/.claude/projects/<slug>/memory) has files
  // modified within the last 24h. Best-effort — cross-platform path resolution
  // varies; absence is reported as "·" rather than failing.
  const home = os?.homedir?.() || process.env.HOME || process.env.USERPROFILE;
  if (!home) return false;
  const slug = path.basename(ROOT);
  // Project memory dirs use a prefix-encoded form; fall back to a glob scan.
  const projectsDir = path.join(home, ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return false;
  try {
    const cutoff = Date.now() - 24 * 3600_000;
    for (const entry of fs.readdirSync(projectsDir)) {
      if (!entry.includes(slug)) continue;
      const memDir = path.join(projectsDir, entry, "memory");
      if (!fs.existsSync(memDir)) continue;
      for (const f of fs.readdirSync(memDir)) {
        const stat = fs.statSync(path.join(memDir, f));
        if (stat.mtimeMs > cutoff) return true;
      }
    }
  } catch {
    /* best-effort */
  }
  return false;
}

function writeBackCoverage() {
  const TARGETS = [
    "context/CURRENT_STATE.md",
    "context/TASK_BOARD.md",
    "context/LATEST_HANDOFF.md",
    "logs/WORK_LOG.md",
    "context/DECISIONS.md",
    "context/SELF_IMPROVEMENT_LOOP.md",
    "docs/CREATIVE_DIRECTION_RECORD.md",
    "context/TRUTH_AUDIT.md",
    "context/PROJECT_STATUS.json",
  ];
  const s = sh("git status --short");
  const touched = new Set();
  for (const ln of s.out.split("\n")) {
    const fileMatch = ln.match(/^.{2,3}\s+(.+)$/);
    if (!fileMatch) continue;
    const file = fileMatch[1].replace(/\\/g, "/").replace(/^"|"$/g, "");
    for (const t of TARGETS) {
      if (file.endsWith(t)) touched.add(t);
    }
  }
  const result = TARGETS.map((t) => ({ file: t, touched: touched.has(t) }));
  // 10th item (per closeout spec): agent memory at ~/.claude/projects/<slug>/memory/
  result.push({
    file: "agent memory (~/.claude/projects/<slug>/memory/)",
    touched: agentMemoryRecentlyTouched(),
  });
  return result;
}

function daysSinceISO(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

function validationBadge(status) {
  const mode = String(status?.testsLastRunMode || "");
  if (status?.testsShardProofDir) {
    const rel = `${status.testsShardProofDir}/aggregate.json`;
    const aggregate = readJson(path.join(ROOT, rel));
    const shardCount =
      aggregate?.shardCount || Number(String(mode).split(":")[1]) || "?";
    const clean =
      aggregate &&
      aggregate.failures === 0 &&
      !aggregate.childParseFailed &&
      !aggregate.budgetExhausted &&
      !(aggregate.deferred || []).length &&
      !(aggregate.envBlocked || []).length;
    const executed = new Set([
      ...(aggregate?.executedShards || []),
      ...(aggregate?.resumedShards || []),
    ]).size;
    return clean
      ? `shard-clean ${shardCount}/${shardCount}`
      : `shard-partial ${executed || "?"}/${shardCount}`;
  }
  if (/changed/i.test(mode)) return "changed-fresh";
  if ((status?.testsDeferred || []).length || status?.testsBudgetExhausted)
    return "full-deferred";
  if (status?.testsLastRun) return "full-fresh";
  return "unknown";
}

// S240 [audit #11] · SIL S235 #1 — quiet-host defer/resume receipt state:
// distinguishes "broad proof PENDING until the host is quiet" from "aggregate
// proof completed" on the founder-facing board.
function quietHostReceiptBadge() {
  try {
    // Lazy import keeps the board render resilient if the lib is absent in a
    // propagated repo that predates S240.
    const receiptsPath = path.join(
      ROOT,
      ".cache",
      "quiet-host-proof-receipts.json",
    );
    const rows = readJson(receiptsPath);
    const last = Array.isArray(rows) ? rows[rows.length - 1] : null;
    if (!last) return null;
    if (last.kind === "deferred")
      return `pending-quiet (deferred ${String(last.at || "").slice(0, 16)})`;
    if (last.kind === "resumed")
      return last.ok
        ? `proven (resumed ${String(last.resumedAt || "").slice(0, 16)})`
        : "resume-FAILED";
    return null;
  } catch {
    return null;
  }
}

function postSessionSignals(status) {
  const doctor =
    status?.doctorScore && typeof status.doctorScore === "object"
      ? `${status.doctorScore.passing ?? "?"}/${status.doctorScore.total ?? "?"}`
      : typeof status?.doctorScore === "number"
        ? String(status?.doctorScore)
        : "—";
  // S263 — the closeout board is the LAST surface a session sees, so a phantom
  // green here is the most expensive one. Reconcile both test surfaces
  // (D-S263.1); a contradicted signal reports the contradiction, not the count.
  // S283 — the enumeration named only 'contradicted', so a bounded (budget-
  // deferred) run printed a bare count on the closeout board as if it were a
  // full pass. Any non-ok severity now reports itself.
  const testSignal = resolveTestSignal(status || {});
  const tests =
    testSignal.state === "contradicted"
      ? `⛔ CONTRADICTED — ${status.testsPassing}/${status.testsTotal} files vs ${status.testsAssertionsPassing}/${status.testsAssertionsTotal} assertions`
      : testSignalSeverity(testSignal) !== "ok"
        ? `${testSignalMark(testSignal)} ${testSignal.detail}`
        : status?.testsPassing != null && status?.testsTotal != null
          ? `${status.testsPassing}/${status.testsTotal}`
          : "—";
  const shardProof = status?.testsShardProofDir
    ? `${status.testsLastRunMode || "sharded"} · ${status.testsShardProofDir}/aggregate.json`
    : null;
  const quietHostReceipt = quietHostReceiptBadge();
  const ignisDays = daysSinceISO(status?.ignisLastComputed);
  const ignisLabel = ignisDays == null ? "—" : `${ignisDays}d ago`;
  const truth =
    status?.truthAuditStatus || formatTruthGenome(status?.truthGenome);
  return {
    doctor,
    compliance:
      status?.complianceScore != null
        ? `${status.complianceScore}/${status.complianceTotal ?? 27}`
        : "—",
    tests,
    validationBadge: validationBadge(status),
    shardProof,
    quietHostReceipt,
    ignis: ignisLabel,
    truth,
    sanitization: status?.sanitizationLastCleared
      ? `${daysSinceISO(status.sanitizationLastCleared) ?? "—"}d ago`
      : "—",
  };
}

/**
 * CANON-031 shell hygiene: only a session-scoped, internally coherent
 * enumeration may render numeric counts. Missing, stale, negative, or
 * arithmetically inconsistent evidence stays explicitly unknown; the board
 * must never manufacture a comforting zero.
 */
export function sessionShellHygiene(status, session) {
  const evidence = status?.sessionShellHygiene;
  const counts = ["started", "closed", "running"].map((key) => evidence?.[key]);
  const validCounts = counts.every(
    (value) => Number.isInteger(value) && value >= 0,
  );
  const sameSession = Number(evidence?.session) === Number(session);
  const coherent = validCounts && counts[0] === counts[1] + counts[2];
  if (!sameSession || !coherent || !evidence?.enumeratedAt) {
    return "unknown · missing/stale enumeration";
  }
  return `${counts[0]} started · ${counts[1]} closed · ${counts[2]} running`;
}

function nextSessionHint() {
  if (!fs.existsSync(GENIUS_CACHE)) return null;
  try {
    const cache = readGeniusCache(GENIUS_CACHE);
    const top = selectFirstPendingUnblocked(cache);
    if (!top) {
      return {
        title: "Unified Genius List exhausted",
        rationale: "No pending unblocked audit item remains.",
        cmd: null,
      };
    }
    return {
      title: top.title || top.id,
      rationale: top.rationale || top.summary || top.why || top.recipe || "",
      cmd: top.command || null,
    };
  } catch {
    return null;
  }
}

function render() {
  const status = readJson(STATUS_PATH) || {};
  const session = status.currentSession ?? status.lastSession ?? "?";
  const sil = status.silScore ?? "?";
  const silMax = status.silMax ?? 1000;
  const date = new Date().toISOString().slice(0, 10);
  const name = projectName();

  let shipped = parseShippedFromHandoff();
  let shippedSource = "handoff";
  if (shipped.length === 0) {
    shipped = parseShippedFromGitLog();
    shippedSource = "git-log";
  }
  const silRows = silCategoryRows(status);
  const wb = writeBackCoverage();
  const git = gitChangeSummary();
  const sig = postSessionSignals(status);
  const next = nextSessionHint();

  const lines = [];

  // 1. SESSION CLOSEOUT header (S114 — adds live URL one-click line per founder directive)
  lines.push(top(`SESSION CLOSEOUT · ${name} · S${session}`));
  const vel = status.silVelocity ?? status.velocity;
  const velLabel =
    vel != null ? `${vel}${status.silDebt ? " " + status.silDebt : ""}` : "—";
  lines.push(
    row(`Date: ${date}  ·  SIL: ${sil}/${silMax}  ·  Velocity: ${velLabel}`),
  );
  lines.push(
    row(
      `Mode: ${(status.sessionMode || "FOUNDER").toUpperCase()}  ·  Agent: ${status.lastAgent || "claude-code"}`,
    ),
  );
  const live = canonicalLiveUrl();
  if (live) {
    lines.push(row(`Live:  ${live.badge}  →  ${live.url}`));
  }
  lines.push(bottom());

  // 2. WHAT SHIPPED
  const shippedHeader =
    shippedSource === "git-log"
      ? "WHAT SHIPPED · last 5 commits"
      : "WHAT SHIPPED";
  lines.push(top(shippedHeader));
  if (shipped.length === 0) {
    lines.push(row("(no parseable handoff bullets and no recent commits)"));
  } else {
    for (const b of shipped) lines.push(row(`✓ ${b.slice(0, W - 2)}`));
  }
  lines.push(bottom());

  // 3. SCORES
  lines.push(top(`SCORES · SIL ${sil}/${silMax}`));
  for (const r of silRows) lines.push(row(r));
  lines.push(bottom());

  // 4. WRITE-BACK STATUS
  lines.push(top("WRITE-BACK STATUS"));
  for (const w of wb) {
    const icon = w.touched ? "✓" : "·";
    const label = w.file.replace(/^.+\//, "");
    lines.push(row(`${icon} ${pad(w.file, W - 2)}`));
  }
  lines.push(bottom());

  // 5. GIT STATUS
  lines.push(top("GIT STATUS"));
  lines.push(
    row(
      `Changes: ${git.total} files  ·  M:${git.counts.M} A:${git.counts.A} D:${git.counts.D} ?:${git.counts["??"]}`,
    ),
  );
  const aheadRes = sh("git rev-list --count @{u}..HEAD").out.trim();
  const behindRes = sh("git rev-list --count HEAD..@{u}").out.trim();
  lines.push(row(`Ahead: ${aheadRes || "?"}  ·  Behind: ${behindRes || "?"}`));
  const branch = sh("git branch --show-current").out.trim();
  lines.push(row(`Branch: ${branch || "?"}`));
  lines.push(bottom());

  // 5.5 DEPLOYMENT (S183 — staging + live, always both, honest status)
  const deploy = deploymentRows();
  lines.push(top("DEPLOYMENT"));
  lines.push(row(`Staging:  ${deploy.staging.slice(0, W - 10)}`));
  lines.push(row(`Live:     ${deploy.live.slice(0, W - 10)}`));
  lines.push(bottom());

  // 6. POST-SESSION SIGNALS
  lines.push(top("POST-SESSION SIGNALS"));
  lines.push(row(`Doctor:        ${sig.doctor}`));
  lines.push(row(`Compliance:    ${sig.compliance}`));
  lines.push(row(`Tests:         ${sig.tests}`));
  lines.push(row(`Validation:    ${sig.validationBadge}`));
  if (sig.shardProof)
    lines.push(row(`Shard proof:   ${sig.shardProof.slice(0, W - 15)}`));
  if (sig.quietHostReceipt)
    lines.push(row(`Broad proof:   ${sig.quietHostReceipt.slice(0, W - 15)}`));
  lines.push(row(`IGNIS:         ${sig.ignis}`));
  lines.push(row(`Truth:         ${sig.truth}`));
  lines.push(row(`Sanitization:  ${sig.sanitization}`));
  lines.push(row(`Shell hygiene: ${sessionShellHygiene(status, session)}`));
  lines.push(bottom());

  // 7. NEXT SESSION
  lines.push(top("NEXT SESSION"));
  if (next) {
    lines.push(row(`#1: ${(next.title || "").slice(0, W - 4)}`));
    if (next.rationale)
      lines.push(row(`    ${next.rationale.slice(0, W - 4)}`));
    if (next.cmd) lines.push(row(`    ↳ ${next.cmd.slice(0, W - 6)}`));
  } else {
    lines.push(
      row("(no genius cache — run `node scripts/cache-genius-list.mjs`)"),
    );
  }
  lines.push(bottom());

  const header = `<!-- generated-by: scripts/render-closeout-board.mjs v1.1 -->\n<!-- generated-at: ${date} (Session ${session} closeout) -->\n\n# Closeout Status Board — ${name}\n\n\`\`\`\n`;
  const footer =
    "\n```\n\n*Generated by `scripts/render-closeout-board.mjs v1.1`*\n";

  return header + lines.join("\n") + footer;
}

const out = render();
if (STDOUT_MODE) {
  process.stdout.write(out);
} else {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, out);
  const sessionTag = (readJson(STATUS_PATH) || {}).currentSession ?? "?";
  console.log(
    `✓ Closeout board → docs/CLOSEOUT_STATUS_BOARD.md  (Session ${sessionTag})`,
  );
}
