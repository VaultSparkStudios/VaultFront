#!/usr/bin/env node
/**
 * write-session-lock.mjs
 *
 * Writes context/.session-lock reliably using Node fs.
 * bash `echo > file` silently fails for dotfiles on Windows — this doesn't.
 *
 * Usage:
 *   node scripts/write-session-lock.mjs [--agent <claude-code|codex|other>] [--trigger <founder-mission|recovery|scheduled-routine|ad-hoc>] [--note "..."]
 *   node scripts/ops.mjs write-session-lock --agent claude-code
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Self-healing default label, derived from the model-router chokepoint (the single
// source of truth for model IDs) when it's reachable: a chokepoint bump (opus 4.7
// -> 4.8) carries into the lock label automatically — no stale hardcode (S165).
// write-session-lock is deliberately copyable + invoked standalone (concurrency
// tests, bootstrap), so the chokepoint may be absent; fall back to the current
// canonical label rather than hard-failing the import. Strips the 'claude-' API
// prefix to keep a human label (not an API ID) and appends the 1M-context suffix.
let DEFAULT_CLAUDE_LABEL = "opus-4-8-1m";
let DEFAULT_CODEX_LABEL = "codex-272k";
let DEFAULT_CODEX_CONTEXT_LIMIT = 272_000;
try {
  const { MODELS, CONTEXT_WINDOWS } = await import("./lib/model-router.mjs");
  if (MODELS?.opus)
    DEFAULT_CLAUDE_LABEL = MODELS.opus.replace(/^claude-/, "") + "-1m";
  if (CONTEXT_WINDOWS?.["codex-272k"])
    DEFAULT_CODEX_CONTEXT_LIMIT = CONTEXT_WINDOWS["codex-272k"];
} catch {
  /* standalone copy — chokepoint unavailable, keep fallback */
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function valueArg(name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`⛔ ${name} requires a value`);
    process.exit(2);
  }
  return value;
}

function normalizeTrigger(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (/^(cron|timer|schedule|scheduled|routine|scheduled-routine)$/.test(raw))
    return "scheduled-routine";
  if (/^(founder|founder-mission|goal)$/.test(raw)) return "founder-mission";
  if (/^(manual|ad-hoc|adhoc)$/.test(raw)) return "ad-hoc";
  if (raw === "recovery") return raw;
  return null;
}

const agentArg =
  args.find((_, i) => args[i - 1] === "--agent") ?? "claude-code";
const noteArg =
  args.find((_, i) => args[i - 1] === "--note") ??
  "Session start via /start protocol v1.3";
const triggerInput =
  valueArg("--trigger") ?? process.env.STUDIO_SESSION_TRIGGER ?? "ad-hoc";
const triggerArg = normalizeTrigger(triggerInput);
if (!triggerArg) {
  console.error(
    `⛔ invalid session trigger "${triggerInput}" (expected founder-mission, recovery, scheduled-routine, or ad-hoc)`,
  );
  process.exit(2);
}
// Model can be pinned for accurate context-meter calibration. Precedence:
//   --model <id>  >  $CLAUDE_MODEL_ID  >  $CLAUDE_MODEL  >  auto (by agent)
const modelArg =
  args.find((_, i) => args[i - 1] === "--model") ??
  process.env.CLAUDE_MODEL_ID ??
  process.env.CLAUDE_MODEL ??
  // Lock stores a human-readable label, NOT an API model ID (keeps chokepoint
  // tier1 test happy: no "claude-*-N" hardcoded outside lib/model-router.mjs).
  (agentArg === "claude-code"
    ? DEFAULT_CLAUDE_LABEL
    : agentArg === "codex"
      ? DEFAULT_CODEX_LABEL
      : "unknown");
// Context window in tokens. Precedence:
//   --context-limit <n>  >  provider-specific env override  >  inferred model
function inferCtxLimit(modelId) {
  if (/1m/i.test(modelId)) return 1_000_000;
  if (/272k/i.test(modelId)) return DEFAULT_CODEX_CONTEXT_LIMIT;
  if (/opus|sonnet/i.test(modelId)) return 200_000;
  return 200_000;
}
const ctxLimitArg = args.find((_, i) => args[i - 1] === "--context-limit");
const providerContextOverride =
  agentArg === "codex"
    ? process.env.CODEX_CONTEXT_LIMIT
    : process.env.CLAUDE_CONTEXT_LIMIT;
const ctxLimit = ctxLimitArg
  ? parseInt(ctxLimitArg, 10)
  : providerContextOverride
    ? parseInt(providerContextOverride, 10)
    : inferCtxLimit(modelArg);

const projectName = path.basename(ROOT);
const lockPath = path.join(ROOT, "context", ".session-lock");
const now = new Date().toISOString();
// Preserve existing session_start so repeated /start invocations within the
// same Studio Ops session don't orphan ledger entries (the meter filters
// ledger entries by ts >= session_start). Use --force to rotate.
const FORCE = args.includes("--force");
let sessionStart = now;
if (!FORCE && fs.existsSync(lockPath)) {
  const prior = fs.readFileSync(lockPath, "utf8");
  const m = prior.match(/^session_start:\s*(\S+)/m);
  if (m) {
    const priorTs = new Date(m[1]).getTime();
    // Only carry over if the prior lock is <12h old — otherwise treat as stale.
    if (Date.now() - priorTs < 12 * 3600 * 1000) sessionStart = m[1];
  }
}

const content = [
  `locked_by: agent-session`,
  `session_start: ${sessionStart}`,
  `agent: ${agentArg}`,
  `trigger: ${triggerArg}`,
  `model: ${modelArg}`,
  `context_limit: ${ctxLimit}`,
  `project: ${projectName}`,
  `note: ${noteArg}`,
  "",
].join("\n");

fs.writeFileSync(lockPath, content, "utf8");
console.log(
  `✓ context/.session-lock written (agent: ${agentArg}, project: ${projectName})`,
);
// Calendar auto-event at /start removed S107.10 — noise without signal.
// Founder already knows they just typed /start; the calendar event restated
// that without providing any planning signal. Script stays available for
// on-demand use: `node scripts/ops.mjs calendar-session-event`.
