#!/usr/bin/env node
// context-meter.mjs — Session context-pressure + continuation-cost estimator
//
// Answers: "Is it cheaper to continue in this session or start a fresh one?"
//
// Heuristic (no provider API needed — all locally observable):
//
//   used_tokens        ≈ sum of bytes(context-read) + bytes(tool-outputs) + bytes(assistant-text) / 4
//   remaining_tokens   ≈ model_limit - used_tokens
//   continue_cost      ≈ used_tokens × marginal_factor (re-sent on every turn w/o cache hit)
//   fresh_cost         ≈ base_session_bootstrap + current_task_tokens
//   break_even         ≈ number of remaining turns where continue wins
//
// Inputs collected:
//   - .claude/metrics/session-{id}.jsonl     (if written by a hook — optional)
//   - context/.session-lock                  (session age + agent)
//   - logs/WORK_LOG.md tail                  (current session turn count)
//   - git diff --stat                        (working-tree churn as proxy)
//   - prompt cache stats                     (portfolio/ops/cache-cockpit.json if present)
//
// Usage:
//   node scripts/context-meter.mjs           (human summary + recommendation)
//   node scripts/context-meter.mjs --json
//   node scripts/context-meter.mjs --warn-threshold=0.75

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureLockTrigger } from "./lib/boot-amortization.mjs";
import { VERDICT_EXITS } from "./lib/context-verdicts.mjs";
import { execSync } from "./lib/safe-spawn.mjs";
import { STUDIO_STATE_DIRS } from "./lib/studio-state-dirs.mjs";
// Provider context and pricing are owned by the model-router chokepoint. The
// meter is already propagated with its lib dependencies, so duplicating these
// values here creates an observability-lie risk whenever providers change them.
import {
  contextWindowForAgent,
  priceForModel as priceFor,
} from "./lib/model-router.mjs";
function tierOf(modelId) {
  if (!modelId) return "unknown";
  if (modelId.includes("opus")) return "opus";
  if (modelId.includes("haiku")) return "haiku";
  if (modelId.includes("sonnet")) return "sonnet";
  return modelId;
}
function costOfEntry(e) {
  const p = priceFor(e.model);
  return (
    ((e.input || 0) * p.input +
      (e.output || 0) * p.output +
      (e.cache_read || 0) * p.cacheRead +
      (e.cache_create || 0) * p.cacheWrite) /
    1_000_000
  );
}

const ROOT = process.cwd();
// S248 [audit #3] — every context-meter run that sees a typed session lock
// persists the trigger to .cache/session-trigger.json, so a closeout/finalize
// running AFTER the Stop hook clears the lock still records typed provenance.
// Static import + sync call: the meter exits via process.exit, which would kill
// a fire-and-forget dynamic import before the capture lands. Best-effort.
try {
  captureLockTrigger(ROOT);
} catch {
  /* meter must never fail on capture */
}
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const thrArg = args.find((a) => a.startsWith("--warn-threshold="));
const WARN_AT = thrArg ? parseFloat(thrArg.split("=")[1]) : 0.75;

// 1 token ≈ 4 bytes of English text. Adjust if content is dense.
const BYTES_PER_TOKEN = 4;

function sh(cmd) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function bytesOf(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// --- Session identity (prefer lock file fields over inference)
const lockPath = path.join(ROOT, "context/.session-lock");
let sessionStart = Date.now();
let agent = "unknown";
let lockModel = null;
let lockLimit = null;
if (fs.existsSync(lockPath)) {
  const lock = fs.readFileSync(lockPath, "utf8");
  const m = lock.match(/session_start:\s*(\S+)/);
  const a = lock.match(/agent:\s*(\S+)/);
  const mid = lock.match(/^model:\s*(\S+)/m);
  const cl = lock.match(/^context_limit:\s*(\d+)/m);
  if (m) sessionStart = new Date(m[1]).getTime();
  if (a) agent = a[1];
  if (mid) lockModel = mid[1];
  if (cl) lockLimit = parseInt(cl[1], 10);
}
const limit = lockLimit || contextWindowForAgent(agent);
const model =
  lockModel ||
  (agent === "claude-code"
    ? limit === 200_000
      ? "sonnet-200k"
      : "opus-1m"
    : agent === "codex"
      ? "codex-272k"
      : "default");

// --- Ledger-measured tokens (when Studio Ops scripts called Claude via model-router).
// Interactive Claude Code tokens are NOT captured here — they don't flow through
// our chokepoint. Mark confidence accordingly.
function ledgerEntriesThisSession() {
  const ledgerPath = path.join(ROOT, "docs/cache-ledger.ndjson");
  if (!fs.existsSync(ledgerPath)) return [];
  const out = [];
  for (const line of fs.readFileSync(ledgerPath, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      const t = new Date(e.ts).getTime();
      if (t >= sessionStart) out.push(e);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}
const ledger = ledgerEntriesThisSession();
const ledgerTokens = ledger.reduce(
  (a, e) =>
    a +
    (e.input || 0) +
    (e.output || 0) +
    (e.cache_read || 0) +
    (e.cache_create || 0),
  0,
);
const ledgerUSD = ledger.reduce((a, e) => a + costOfEntry(e), 0);

// Separate the two ledger classes. Only `claude-code-interactive` entries (from
// the Stop hook) reflect the conversation Claude Code is actually running;
// other entries are Studio Ops' own API calls (worth tracking for cost but
// they don't consume the current session's context window).
const interactive = ledger.filter(
  (e) => e.script === "claude-code-interactive",
);
// For interactive turns, the BEST single measure of "current context pressure"
// is the `input_tokens + cache_read_input_tokens` of the most recent turn —
// that's what's actually loaded in the model right now. Earlier turns'
// inputs already include prior conversation tokens, so summing across turns
// would double-count. We take the latest interactive entry as the ground truth.
const lastInteractive = interactive[interactive.length - 1] || null;
const measuredContextTokens = lastInteractive
  ? (lastInteractive.input || 0) + (lastInteractive.cache_read || 0)
  : 0;

// --- Transcript-growth proxy (S240 audit #1 · SIL S239 #1) ------------------
// The Stop hook only fires BETWEEN turns. A /goal arc is one continuous turn,
// so for its entire duration no interactive ledger entry lands and the meter
// used to sit on the static heuristic ("2% used" through a full arc — the
// CANON-031 violation S239 flagged). But the Claude Code session transcript
// (~/.claude/projects/<munged-cwd>/*.jsonl) is appended LIVE during the turn:
// its growth is a real, locally observable measurement of context pressure.
//
// Honesty notes: the transcript keeps growing across compaction, so after a
// compaction this proxy OVERestimates (errs toward earlier closeout — the safe
// direction). JSONL envelope overhead means bytes/token is higher than prose;
// we use 5 bytes/token as the proxy divisor and label the source explicitly.
const TRANSCRIPT_BYTES_PER_TOKEN = 5;
const TRANSCRIPT_FRESH_MS = 10 * 60_000; // only trust a transcript growing NOW
const LEDGER_FRESH_MS = 5 * 60_000; // a Stop-hook entry this recent is exact truth
function transcriptProxy() {
  try {
    // Claude transcripts are provider-specific evidence. A fresh file in the
    // shared repo's ~/.claude directory may belong to another terminal while
    // Codex (or an unknown agent before its lock is written) is running here.
    // Treating that file as this session's context creates a phantom CLOSEOUT
    // and can deadlock durable /goal continuations. Never cross agent boundaries.
    if (agent !== "claude-code") return null;
    const dir =
      process.env.CLAUDE_TRANSCRIPT_DIR ||
      path.join(
        os.homedir(),
        ".claude",
        "projects",
        path.resolve(ROOT).replace(/[:\\/]/g, "-"),
      );
    if (!fs.existsSync(dir)) return null;
    let newest = null;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const st = fs.statSync(path.join(dir, f));
        if (!newest || st.mtimeMs > newest.mtimeMs)
          newest = { file: f, mtimeMs: st.mtimeMs, size: st.size };
      } catch {
        /* skip */
      }
    }
    if (!newest) return null;
    const ageMs = Date.now() - newest.mtimeMs;
    if (ageMs > TRANSCRIPT_FRESH_MS) return null; // stale = previous session/turn, not evidence
    return {
      file: newest.file,
      bytes: newest.size,
      tokens: Math.round(newest.size / TRANSCRIPT_BYTES_PER_TOKEN),
      ageSeconds: Math.round(ageMs / 1000),
    };
  } catch {
    return null;
  }
}
const proxy = transcriptProxy();
const lastInteractiveTs = lastInteractive
  ? new Date(lastInteractive.ts).getTime()
  : 0;

// --- Used-tokens estimate (ADVISORY — heuristic only, not a real token count)
//
// Philosophy: this meter is a GUIDE, not enforcement. Agents should use
// CONSIDER_CLOSEOUT as a prompt to wrap up, not a hard stop. Only CLOSEOUT
// (≥95%) should halt work.
//
// Estimation approach:
//   Baseline  = STARTUP_BRIEF.md (sole file read at session start per v1.3)
//   Hot files = 15% of each file modified after session start — partial read proxy
//   Churn     = git diff lines × 80 bytes — tool-output volume proxy
//
// 15% weight: a file being written/updated doesn't mean it was fully re-read.
// Agents typically read targeted sections, not full files on every edit.

const HOT_FILE_WEIGHT = 0.15;
const STARTUP_BASELINE = bytesOf(path.join(ROOT, "docs/STARTUP_BRIEF.md"));

function hotFilesBytes() {
  const dirs = STUDIO_STATE_DIRS;
  let total = 0;
  for (const dir of dirs) {
    const dirPath = path.join(ROOT, dir);
    if (!fs.existsSync(dirPath)) continue;
    try {
      for (const entry of fs.readdirSync(dirPath)) {
        const fp = path.join(dirPath, entry);
        try {
          const stat = fs.statSync(fp);
          if (stat.isFile() && stat.mtimeMs > sessionStart) {
            total += Math.round(stat.size * HOT_FILE_WEIGHT);
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
  }
  return total;
}

let ctxBytes = STARTUP_BASELINE + hotFilesBytes();

// Working-tree churn — ONLY count diff for files modified after sessionStart.
// Raw `git diff --shortstat` includes pre-existing uncommitted work from prior
// sessions, which inflates the meter to phantom-CLOSEOUT on a fresh terminal
// when a repo has a dirty working tree. Filter to session-hot files only.
let churnBytes = 0;
try {
  const dirtyList = sh("git diff --name-only")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const sessionHot = dirtyList.filter((f) => {
    try {
      return fs.statSync(path.join(ROOT, f)).mtimeMs > sessionStart;
    } catch {
      return false;
    }
  });
  if (sessionHot.length) {
    const shellList = sessionHot
      .map((f) => `"${f.replace(/"/g, '\\"')}"`)
      .join(" ");
    const stat = sh(`git diff --shortstat -- ${shellList}`).trim();
    const m = stat.match(/(\d+) insertions.*?(\d+) deletions/);
    if (m) churnBytes = (parseInt(m[1], 10) + parseInt(m[2], 10)) * 80;
  }
} catch {
  /* keep 0 */
}

// (c) hook-observed turns (optional)
const metricsDir = path.join(ROOT, ".claude/metrics");
let observedBytes = 0;
let turnCount = 0;
if (fs.existsSync(metricsDir)) {
  const files = fs.readdirSync(metricsDir).filter((f) => f.endsWith(".jsonl"));
  for (const f of files) {
    const events = readJsonl(path.join(metricsDir, f));
    for (const e of events) {
      observedBytes += e.bytes || 0;
      if (e.kind === "turn") turnCount += 1;
    }
  }
}

const usedBytes = ctxBytes + churnBytes + observedBytes;
const heuristicTokens = Math.round(usedBytes / BYTES_PER_TOKEN);
// Measurement-source preference (S240 audit #1):
//   1. interactive-ledger  — a Stop-hook entry landed within LEDGER_FRESH_MS:
//                            exact usage straight from Claude's usage block.
//   2. transcript-proxy    — mid-turn (arc) measurement from live transcript
//                            growth; real observation, labeled as a proxy.
//   3. interactive-ledger-stale — an entry exists this session but is old and
//                            no live transcript is visible; better than bytes.
//   4. heuristic           — static byte estimate; last resort, labeled.
let usedTokens;
let measurementSource;
if (
  measuredContextTokens > 0 &&
  Date.now() - lastInteractiveTs <= LEDGER_FRESH_MS
) {
  usedTokens = measuredContextTokens;
  measurementSource = "interactive-ledger";
} else if (proxy && proxy.tokens > 0) {
  // Mid-turn: transcript growth is the freshest real signal. Never report
  // LESS than an exact measurement we already have from this session.
  usedTokens = Math.max(proxy.tokens, measuredContextTokens);
  measurementSource = "transcript-proxy";
} else if (measuredContextTokens > 0) {
  usedTokens = measuredContextTokens;
  measurementSource = "interactive-ledger-stale";
} else {
  usedTokens = heuristicTokens;
  measurementSource = "heuristic";
}
// S262 [secondary, same report] — do NOT clamp usedTokens to the limit.
//
// The clamp turned a real 307,673 / 200,000 reading into a flat "100% used", so a
// session at ~154% of its window looked merely full. That is the same class of
// dishonesty as the UNMEASURED bug above: the display contradicted the tool's own
// token figure, which is what tripped check-startup-meter-freshness. An overrun is
// exactly the condition the founder most needs to see, and clipping it hides the
// magnitude — 101% and 154% demand very different responses.
//
// `remaining` still floors at 0 (there is no negative headroom), but `usedTokens`
// and `pctUsed` now report the truth and may exceed the limit.
const overLimit = usedTokens > limit;
const remaining = Math.max(0, limit - usedTokens);
const pctUsed = usedTokens / limit;

// --- Continuation vs fresh comparison
// Continuation cost per turn: fully re-reads used context if cache miss.
// With cache hit (assume 0.5 hit rate), continuation cost ≈ usedTokens × (1 - hitRate).
const cachePath = path.join(ROOT, "portfolio/ops/cache-cockpit.json");
let cacheHitRate = 0.5;
if (fs.existsSync(cachePath)) {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    cacheHitRate = c.recentHitRate ?? c.hitRate ?? 0.5;
  } catch {
    /* keep default */
  }
}

const continueCostPerTurn = Math.round(usedTokens * (1 - cacheHitRate));
// Fresh-session bootstrap: read full context stack once (roughly ctxBytes).
const freshBootstrap = Math.round(ctxBytes / BYTES_PER_TOKEN);
// Turns until fresh session pays itself off:
const breakEvenTurns =
  continueCostPerTurn > 0
    ? Math.ceil(freshBootstrap / continueCostPerTurn)
    : Infinity;

// --- Compaction predictor (audit #2 · S117)
// Predict how many turns remain before auto-compaction is triggered. Compaction
// fires near the model's context limit (Anthropic compacts at ~95% to make
// room). We treat 0.92 as the proactive trigger so PreCompact-hook autosave
// has runway. If current burn rate is unknown (no turns observed), null out.
const compactTriggerPct = 0.92;
const compactTriggerTokens = limit * compactTriggerPct;
const tokensTilCompact = Math.max(0, compactTriggerTokens - usedTokens);
const burnPerTurn = continueCostPerTurn > 0 ? continueCostPerTurn : null;
const turnsToCompact = burnPerTurn
  ? Math.max(0, Math.floor(tokensTilCompact / burnPerTurn))
  : null;
const compactImminent =
  turnsToCompact !== null && turnsToCompact <= 2 && pctUsed < 0.95;

// --- Sonnet context-breach guardrail
// Sonnet 4.6 caps at 200K even if the session-lock declares a 1M limit (e.g.
// opusplan mode plans on Opus 1M but executes on Sonnet 200K). Fire an
// earlier CONSIDER_CLOSEOUT when we detect usedTokens ≥ 80% of 200K while
// the execute-tier model is Sonnet. Protects against silent truncation.
const tierModel = (lockModel || "").toLowerCase();
const isSonnetExecTier = /sonnet|opusplan/i.test(tierModel);
const sonnetBreachPct = isSonnetExecTier ? usedTokens / 200_000 : 0;

// --- Recommendation
//
// S262 [cross-repo defect, reported by vaultsparkstudios-website S302] — the
// UNMEASURED gate comes FIRST, before any threshold can fire.
//
// When no ledger entry, no interactive turn, and no live transcript are readable,
// `usedTokens` is the byte heuristic: context FILE sizes + git churn + hook
// metrics. That is not a measurement of the agent's context window, and dividing
// it by the window produced a confident "1.5% used · CONTINUE" for a session
// actually at ~154%. A non-measurement rendered as a measurement, on the single
// signal that exists to stop an overrun.
//
// So: refuse. No verdict, no percentage. The gauge says it cannot read.
const hasRealMeasurement =
  ledger.length > 0 ||
  interactive.length > 0 ||
  Boolean(proxy && proxy.tokens > 0);

let recommendation;
let reason;
if (!hasRealMeasurement) {
  recommendation = "UNMEASURED";
  reason =
    "no ledger entry, interactive turn, or live transcript readable — context usage is UNKNOWN. " +
    "The byte heuristic measures context-file size, not window usage, and is not reported as one.";
} else if (pctUsed >= 0.95) {
  recommendation = "CLOSEOUT";
  reason = "context effectively exhausted — continuation risks truncation";
} else if (isSonnetExecTier && sonnetBreachPct >= 0.8) {
  recommendation = "CONSIDER_CLOSEOUT";
  reason = `Sonnet 200K guardrail — ${(sonnetBreachPct * 100).toFixed(0)}% of execute-tier limit · switch to opus or /closeout`;
} else if (compactImminent) {
  recommendation = "WARN_COMPACT_SOON";
  reason = `compaction predicted in ~${turnsToCompact} turn(s) at current burn rate — proactive autosave recommended`;
} else if (pctUsed >= WARN_AT) {
  recommendation = "CONSIDER_CLOSEOUT";
  reason = `context ${(pctUsed * 100).toFixed(0)}% used — fresh session saves ~${continueCostPerTurn} tokens/turn after ${breakEvenTurns} turns`;
} else if (pctUsed >= 0.5 && breakEvenTurns <= 3) {
  recommendation = "CONTINUE";
  reason = `fresh would pay off after ${breakEvenTurns} turns but you\'re only at ${(pctUsed * 100).toFixed(0)}% — keep going`;
} else {
  recommendation = "CONTINUE";
  reason = `${(pctUsed * 100).toFixed(0)}% used · ${remaining.toLocaleString()} tokens remaining`;
}

// --- Adaptive action menu (I from the redesign memo)
// Instead of a single verdict, emit a ranked list of viable next moves with
// estimated token savings + risk. Consumers (TUI, MCP, hooks) can show a
// menu instead of forcing a binary CONTINUE/CLOSEOUT decision.
function buildActions() {
  const acts = [];
  // "continue" is always available below closeout threshold
  if (pctUsed < 0.95) {
    acts.push({
      id: "continue",
      label: "Keep going",
      tokensSaved: 0,
      risk: pctUsed >= 0.75 ? "medium" : "low",
      reason: `stay in session · cost ${continueCostPerTurn.toLocaleString()} tok/turn`,
    });
  }
  // "compact-handoff" — cheap compaction, saves ~50-70% of handoff tokens
  if (pctUsed >= 0.3) {
    acts.push({
      id: "compact-handoff",
      label: "Compact LATEST_HANDOFF",
      tokensSaved: Math.round(usedTokens * 0.05),
      risk: "low",
      reason:
        "Haiku summarizes handoff → ≤500 tokens (cached 1h, near-zero cost)",
    });
  }
  // "swap-to-haiku" — only meaningful if we're on opus
  if (/opus/i.test(model) && pctUsed >= 0.4) {
    acts.push({
      id: "swap-to-haiku",
      label: "Route follow-up calls through Haiku",
      tokensSaved: 0,
      risk: "medium",
      reason:
        "10–15× cheaper on simple Q&A · use callWithEscalation for smart fallback",
    });
  }
  // "delegate-subagent" — context rolls off into the subagent's own window
  if (pctUsed >= 0.5) {
    acts.push({
      id: "delegate-subagent",
      label: "Delegate to Explore subagent",
      tokensSaved: Math.round(usedTokens * 0.15),
      risk: "low",
      reason: "heavy search / read work moves into a fresh context window",
    });
  }
  // "rotate-cache" — only if cache-creation cost is high
  if (lastInteractive && (lastInteractive.cache_create || 0) > 20_000) {
    acts.push({
      id: "rotate-cache",
      label: "Rotate 1h cache breakpoint",
      tokensSaved: 0,
      risk: "low",
      reason:
        "last turn wrote >20K to cache — move cache_control marker to stabilize",
    });
  }
  // "closeout" — always present above 50%
  if (pctUsed >= 0.5) {
    acts.push({
      id: "closeout",
      label: "Run /closeout",
      tokensSaved: usedTokens,
      risk: pctUsed >= 0.75 ? "low" : "medium",
      reason: `fresh session bootstrap ~${freshBootstrap.toLocaleString()} tok · break-even ${breakEvenTurns} turns`,
    });
  }
  return acts;
}
const actions = buildActions();

// Measurement confidence tiers:
//   "measured"          — Stop hook recorded ≥1 interactive turn this session.
//                         usedTokens comes straight from Claude's usage block.
//   "measured+heuristic" — Studio Ops scripts called Claude API but no Stop
//                         hook data yet (rare: scripts ran before any Stop).
//   "heuristic"         — No ledger entries this session; falling back to
//                         file-system byte estimates.
// S262 — "heuristic" with nothing measured is not a low-confidence READING, it is
// the ABSENCE of a reading. Naming it `heuristic` invited callers to treat it as a
// weak measurement and carry on; `unmeasured` cannot be misread that way.
const confidence = !hasRealMeasurement
  ? "unmeasured"
  : {
      "interactive-ledger": "measured",
      "transcript-proxy": "measured-proxy",
      "interactive-ledger-stale": "measured-stale",
      heuristic: ledger.length > 0 ? "measured+heuristic" : "heuristic",
    }[measurementSource];

const out = {
  agent,
  model,
  limit,
  // S262 — when nothing was measured, usedTokens/remainingTokens/pctUsed are
  // NULL, not zero and not a byte guess. A consumer that does `pctUsed ?? 0`
  // would otherwise convert "I cannot see" into "0% used", which reads as a
  // permanent CONTINUE — the precise way this defect propagated downstream.
  // The raw byte estimate stays visible under `measured.heuristicTokens` for
  // debugging; it is simply never promoted to a context reading.
  usedTokens: hasRealMeasurement ? usedTokens : null,
  remainingTokens: hasRealMeasurement ? remaining : null,
  pctUsed: hasRealMeasurement ? +(pctUsed * 100).toFixed(1) : null,
  measured_ok: hasRealMeasurement,
  // True when the reading EXCEEDS the window — surfaced so consumers can render
  // the overage instead of clipping it to a reassuring 100%.
  overLimit: hasRealMeasurement ? overLimit : null,
  turnCountObserved: turnCount,
  cacheHitRate: +cacheHitRate.toFixed(2),
  continueCostPerTurn,
  freshSessionBootstrap: freshBootstrap,
  breakEvenTurns: Number.isFinite(breakEvenTurns) ? breakEvenTurns : null,
  turnsToCompact,
  compactImminent,
  compactTriggerPct,
  recommendation,
  reason,
  actions,
  warnThreshold: WARN_AT,
  measurementSource,
  transcriptProxy: proxy,
  // Ledger-measured (API-call) usage from Studio Ops scripts this session.
  // Does NOT include the interactive Claude Code conversation — that's
  // outside our chokepoint and only the runtime can see it.
  measured: {
    ledgerEntries: ledger.length,
    interactiveTurns: interactive.length,
    interactiveContextTokens: measuredContextTokens,
    heuristicTokens,
    ledgerTokens,
    ledgerUSD: +ledgerUSD.toFixed(4),
    byScript: Object.entries(
      ledger.reduce((a, e) => {
        const k = e.script || "unknown";
        a[k] =
          (a[k] || 0) +
          (e.input || 0) +
          (e.output || 0) +
          (e.cache_read || 0) +
          (e.cache_create || 0);
        return a;
      }, {}),
    )
      .map(([script, tokens]) => ({ script, tokens }))
      .sort((a, b) => b.tokens - a.tokens),
    byModel: Object.entries(
      ledger.reduce((a, e) => {
        const tier = tierOf(e.model);
        const key = e.model || "unknown";
        if (!a[key]) a[key] = { tier, model: key, calls: 0, tokens: 0, usd: 0 };
        a[key].calls += 1;
        a[key].tokens +=
          (e.input || 0) +
          (e.output || 0) +
          (e.cache_read || 0) +
          (e.cache_create || 0);
        a[key].usd += costOfEntry(e);
        return a;
      }, {}),
    )
      .map(([, v]) => ({ ...v, usd: +v.usd.toFixed(4) }))
      .sort((a, b) => b.usd - a.usd),
  },
  confidence,
};

// Persist the latest reading — consumers (brief-v5 COMPACTION WARNING block,
// boot-amortization) read .cache/context-meter.json instead of re-running us.
try {
  fs.mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, ".cache", "context-meter.json"),
    JSON.stringify(out, null, 2) + "\n",
  );
} catch {
  /* cache write is best-effort */
}

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(
    `context-meter · ${agent} (${model}) · confidence: ${confidence} · source: ${measurementSource}`,
  );
  if (measurementSource === "transcript-proxy") {
    console.log(
      `  live-turn:   transcript ${proxy.file} · ${proxy.bytes.toLocaleString()} bytes (${proxy.ageSeconds}s fresh) → ~${proxy.tokens.toLocaleString()} tok proxy`,
    );
  }
  // S263 — S262 made usedTokens/remainingTokens/pctUsed NULL when the meter
  // cannot measure (UNMEASURED honesty), but this human branch still called
  // .toLocaleString() on them, so `context-meter` without --json threw
  // "Cannot read properties of null" on exactly the hosts that cannot measure.
  // That is the normal state in a SIBLING repo — and this meter was propagated
  // to the fleet. The JSON path was fixed; its paired consumer was not.
  if (out.measured_ok) {
    const over = out.overLimit
      ? `  ⛔ OVER LIMIT by ${(out.usedTokens - limit).toLocaleString()}`
      : "";
    console.log(
      `  used:        ${out.usedTokens.toLocaleString()} / ${limit.toLocaleString()} tokens (${out.pctUsed}%)${over}`,
    );
    console.log(
      `  remaining:   ${out.remainingTokens.toLocaleString()} tokens`,
    );
  } else {
    console.log(
      `  used:        UNMEASURED — context usage is unknown (limit ${limit.toLocaleString()})`,
    );
    console.log(`  remaining:   UNMEASURED`);
  }
  console.log(
    `  continue:    ~${out.continueCostPerTurn.toLocaleString()} tokens/turn (cache hit ${(cacheHitRate * 100).toFixed(0)}%)`,
  );
  console.log(
    `  fresh:       ~${out.freshSessionBootstrap.toLocaleString()} tokens bootstrap`,
  );
  console.log(`  break-even:  ${out.breakEvenTurns ?? "∞"} turns`);
  console.log(`  verdict:     ${out.recommendation} — ${out.reason}`);
  if (interactive.length > 0) {
    console.log(
      `  measured:    ${interactive.length} interactive turn(s) · last=${measuredContextTokens.toLocaleString()} ctx tokens · +${ledger.length - interactive.length} Studio Ops call(s)`,
    );
    console.log(
      `               ledger $${ledgerUSD.toFixed(4)} total this session (priced per-model)`,
    );
  } else if (ledger.length > 0) {
    console.log(
      `  measured:    ${ledger.length} Studio Ops call(s) · ${ledgerTokens.toLocaleString()} tokens · $${ledgerUSD.toFixed(4)}`,
    );
    console.log(
      `               (no interactive turns yet — Stop hook fires after this response)`,
    );
  } else if (measurementSource === "transcript-proxy") {
    console.log(
      `  measured:    no ledger entries yet — live transcript-growth proxy in use (above)`,
    );
  } else {
    console.log(
      `  measured:    (no ledger entries yet — heuristic estimate only)`,
    );
  }
  if (out.measured.byModel.length > 0) {
    console.log(`  by model:`);
    for (const row of out.measured.byModel) {
      console.log(
        `    · ${row.model.padEnd(32)} ${String(row.calls).padStart(3)} call  ${String(row.tokens.toLocaleString()).padStart(9)} tok  $${row.usd.toFixed(4)}  [${row.tier}]`,
      );
    }
  }
  for (const row of out.measured.byScript.slice(0, 5)) {
    console.log(
      `    · ${row.script.padEnd(28)} ${row.tokens.toLocaleString()} tok`,
    );
  }
  if (actions.length > 1) {
    console.log(`  actions:`);
    for (const a of actions) {
      const saved =
        a.tokensSaved > 0
          ? ` (saves ~${a.tokensSaved.toLocaleString()} tok)`
          : "";
      console.log(`    · [${a.id}] ${a.label}${saved} · risk:${a.risk}`);
      console.log(`        ${a.reason}`);
    }
  }
}

// Exit 0 on CONTINUE / WARN_COMPACT_SOON, 2 on CONSIDER_CLOSEOUT, 3 on CLOSEOUT —
// lets hooks/skills route on the verdict. Exit map is the single source of truth in
// lib/context-verdicts.mjs (shared with the tier1-context-meter-gate contract test so
// the vocabulary + exit codes can never drift — S198). A NON-ZERO exit is a routing
// signal, NOT a failure: callers wanting only the JSON must read stdout regardless of
// exit status (spawnSync, not execSync).
process.exit(VERDICT_EXITS[recommendation] ?? 0);
