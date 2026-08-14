#!/usr/bin/env node
/**
 * session-floor.mjs — S175. The agent-neutral /goal saturation check.
 *
 * Both harnesses call this after each verified checkpoint:
 *   - Claude Code: the /goal Stop hook consults it (alongside the goal condition).
 *   - Codex: the /goal loop runs it and MUST take the next item while it says CONTINUE.
 *
 * It turns "stop when the one objective is done" into "stop when the budget is
 * saturated" — closing the structural gap that makes Codex finish in 4-10 min.
 *
 * Live inputs (auto-derived, flag-overridable):
 *   contextPct    ← scripts/context-meter.mjs --json (pctUsed/100)
 *   startup/work  ← context-meter freshSessionBootstrap vs usedTokens (amortization)
 *   velocityFloor ← context/PROJECT_STATUS.json silVelocity
 *   listRemaining ← .cache/genius-list.json unblocked count (exhaustion)
 *
 * Usage:
 *   node scripts/session-floor.mjs --shipped 3                 # human verdict + exit code
 *   node scripts/session-floor.mjs --shipped 3 --json
 *   node scripts/session-floor.mjs --project ../some-repo --shipped 3
 *   node scripts/session-floor.mjs --repo ../some-repo --shipped 3
 *   node scripts/session-floor.mjs --shipped 1 --budget +300k  # with a /goal budget floor
 *   node scripts/session-floor.mjs --closeout-gate --shipped 1 # Codex closeout refusal check
 *
 * Exit code: CONTINUE → 10 · STOP → 0 (so `session-floor … || closeout` reads naturally).
 * --closeout-gate: pass → 0 · refuse → 11.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "./lib/safe-spawn.mjs";
import {
  bootAmortization,
  minSessionValueGate,
  parseBudgetDirective,
  sessionFloorVerdict,
} from "./lib/session-economics.mjs";
import { locallyActionableSessionFloorItems } from "./lib/session-floor-items.mjs";
import { sequenceCheapFirst } from "./lib/token-cost-tier.mjs";

const CONTROL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const has = (n) => argv.includes(n);
if (has("--help") || has("-h")) {
  console.log(
    "Usage: node scripts/session-floor.mjs [--project <repo>|--repo <repo>] --shipped <N> [--json|--closeout-gate]",
  );
  process.exit(0);
}
const requestedRoot = flag("--project") ?? flag("--repo") ?? process.cwd();
const ROOT = path.resolve(requestedRoot);
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`⛔ project root is not a readable directory: ${ROOT}`);
  process.exit(2);
}

function readJson(p, dflt) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return dflt;
  }
}

// ── Live signals ──────────────────────────────────────────────────────────────
function contextSignals() {
  try {
    const out = execFileSync(
      "node",
      [path.join(CONTROL_ROOT, "scripts", "context-meter.mjs"), "--json"],
      { cwd: ROOT, encoding: "utf8" },
    );
    const j = JSON.parse(out);
    // S262 — `?? 0` here was how the meter's non-measurement propagated: an
    // absent reading became "0% used", which is a permanent CONTINUE from the
    // one gate meant to stop an overrun. A null pctUsed now stays NULL and the
    // verdict treats it as unknown rather than as plenty-of-room.
    const measured = j.measured_ok !== false && j.pctUsed != null;
    return {
      pctUsed: measured ? j.pctUsed : null,
      usedTokens: measured ? (j.usedTokens ?? 0) : null,
      bootstrap: j.freshSessionBootstrap ?? 0,
      contextMeasured: measured,
    };
  } catch {
    return {
      pctUsed: null,
      usedTokens: null,
      bootstrap: 0,
      contextMeasured: false,
    };
  }
}

function velocityFloor() {
  const s = readJson(path.join(ROOT, "context", "PROJECT_STATUS.json"), {});
  const v = Number(s.silVelocity);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
}

function unblockedItems() {
  const g = readJson(path.join(ROOT, ".cache", "genius-list.json"), null);
  // The genius cache may be portfolio-scoped even inside studio-ops. The floor
  // gates local session saturation, so sibling-owned/cross-repo rows are not
  // counted as local debt (CANON-018); they still belong in the rendered list.
  const unblocked = locallyActionableSessionFloorItems(g);
  if (!Array.isArray(unblocked)) return null;
  // S178 ITEM 11 — order cheap-high-value first so a saturating session ships
  // more value before budget runs out. Suggest/sequence-only: this reorders the
  // NEXT-item suggestion, never the canonical impact ranking on disk.
  return sequenceCheapFirst(unblocked);
}
function listRemaining() {
  const items = unblockedItems();
  return items == null ? null : items.length;
}
// D-S177.2 — name the concrete next item so Codex's loop has zero friction
// continuing (a verdict that says "keep going" but not "to what" is half a loop).
function nextItemTitle() {
  const items = unblockedItems();
  if (!items || !items.length) return null;
  const top = items[0];
  const title = (top.title || top.name || top.id || "").toString().slice(0, 80);
  if (!title) return null;
  // Annotate with the suggested cost tier so cheap-first sequencing is visible.
  return top.costTier ? `${title}  [${top.costTier}]` : title;
}

// ── Compose ───────────────────────────────────────────────────────────────────
const ctx = contextSignals();
// S262 — null when the meter could not read. NOT 0: a null must never be
// arithmetically converted into "plenty of context left".
const contextPct = ctx.pctUsed == null ? null : ctx.pctUsed / 100;
const itemsShipped = Number(flag("--shipped", "0")) || 0;
const vFloor = Number(flag("--velocity-floor")) || velocityFloor();
const remaining = (() => {
  const r = flag("--list-remaining");
  return r != null ? Number(r) : listRemaining();
})();
const listExhausted = remaining != null ? remaining <= 0 : false;
const budgetTotal = (() => {
  const b = flag("--budget");
  return b ? parseBudgetDirective(b) : null;
})();

// ── S261 [audit #7] — budget spend must be MEASURED or declared unmeasured ────
// Before this, budgetSpent was `Number(flag('--spent')) || 0` and NOTHING in the
// repo ever passed --spent. So `/goal +950k` took branch 2 of sessionFloorVerdict
// on every single call and printed "budget floor not met (0% of +950k)" — a
// hard-coded 0 rendered as though it were an observation. The verdict happened to
// be right (CONTINUE), which is exactly why it went unnoticed: a lying surface
// that agrees with reality is still a lying surface (CANON-031), and it would
// have kept saying 0% at the 900k mark.
//
// The spend data already existed: record-skill-cost.mjs writes per-skill token
// rows to .cache/skill-costs.jsonl tagged with sessionId. Sum this session's rows.
function measuredSpend() {
  const explicit = flag("--spent");
  if (explicit != null)
    return { tokens: Number(explicit) || 0, measured: true, source: "--spent" };
  const p = path.join(ROOT, ".cache", "skill-costs.jsonl");
  // Scope by TIME, not by session id: the lock records `session_start` but no
  // id, while every ledger row carries `ts`. Time-scoping therefore works with
  // the files as they actually are, and stays correct for agents (Codex, cloud
  // routines) that never stamp a session id at all.
  let since = null;
  try {
    const lock = fs.readFileSync(
      path.join(ROOT, "context", ".session-lock"),
      "utf8",
    );
    const raw = (lock.match(/session_start:\s*(\S+)/) || [])[1];
    const t = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(t)) since = t;
  } catch {
    /* no lock */
  }
  if (since == null)
    return {
      tokens: 0,
      measured: false,
      source: "no session lock — cannot scope spend to this session",
    };
  let rows;
  try {
    rows = fs
      .readFileSync(p, "utf8")
      .trim()
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
  } catch {
    return { tokens: 0, measured: false, source: "no skill-cost ledger" };
  }
  const scoped = rows.filter((r) => {
    const t = Date.parse(r?.ts || "");
    return Number.isFinite(t) && t >= since;
  });
  if (!scoped.length) {
    // Zero rows since session start is a REAL observation of zero recorded spend,
    // not an absence of data — the ledger exists and we read it. Say so.
    return {
      tokens: 0,
      measured: true,
      source: "skill-cost ledger — 0 rows recorded since session start",
    };
  }
  const tokens = scoped.reduce(
    (s, r) => s + (Number(r?.actual?.tokens) || 0),
    0,
  );
  return {
    tokens,
    measured: true,
    source: `skill-cost ledger (${scoped.length} row(s) since session start)`,
  };
}
// S264 [S262 #5] — the ledger records only INSTRUMENTED skills, so a /goal +Nk
// floor could under-count real spend forever ("11.5k measured against a real
// spend far higher") and never be MET. The context-meter's transcript-growth
// proxy measures the session's actual total tokens; when it reads higher than
// the ledger, it is the closer-to-true total. Take max(ledger, meter) and say
// which source produced the number — never silently blend.
function totalSpend() {
  const ledger = measuredSpend();
  const meterTokens =
    ctx.contextMeasured && Number.isFinite(ctx.usedTokens)
      ? ctx.usedTokens
      : null;
  if (meterTokens != null && meterTokens > ledger.tokens) {
    return {
      tokens: meterTokens,
      measured: true,
      source: `context-meter transcript proxy (${meterTokens.toLocaleString()} tok total; skill ledger covers ${ledger.tokens.toLocaleString()} — ${meterTokens > 0 ? Math.round((ledger.tokens / meterTokens) * 100) : 0}% instrumented)`,
    };
  }
  return ledger;
}
const spend = totalSpend();
const budgetSpent = spend.tokens;

const workTokens =
  ctx.usedTokens == null ? 0 : Math.max(0, ctx.usedTokens - ctx.bootstrap);
const amort = bootAmortization({ workTokens, startupTokens: ctx.bootstrap });

// S183 — git work-evidence: the truth the context meter can't see on a 1M window.
// commits made since this session's lock + files touched. Lets the value gate
// trust real work over a blind 0% context reading (CANON-031), while an empty
// session (no commits, nothing changed) still has no evidence and is refused.
function workEvidence() {
  let commits = 0,
    filesChanged = 0;
  try {
    const lock = fs.readFileSync(
      path.join(ROOT, "context", ".session-lock"),
      "utf8",
    );
    const since = (lock.match(/session_start:\s*(\S+)/) || [])[1];
    if (since) {
      const out = execFileSync(
        "git",
        ["-C", ROOT, "log", "--since", since, "--oneline"],
        { encoding: "utf8" },
      );
      commits = out.trim() ? out.trim().split("\n").length : 0;
    }
  } catch {
    /* no lock / not git */
  }
  try {
    const st = execFileSync("git", ["-C", ROOT, "status", "--porcelain"], {
      encoding: "utf8",
    });
    filesChanged = st.trim() ? st.trim().split("\n").length : 0;
  } catch {
    /* not git */
  }
  return {
    commits,
    filesChanged,
    substantial: commits >= 1 || filesChanged >= 5,
  };
}
const work = workEvidence();

// ── Closeout-refusal gate (Codex parity for Claude's blocking Stop hook) ────────
if (has("--closeout-gate")) {
  const gate = minSessionValueGate({
    amortizationRatio: amort.ratio,
    itemsShipped,
    velocityFloor: vFloor,
    contextPct,
    founderInvoked: has("--founder"),
    workEvidence: work,
  });
  if (has("--json"))
    console.log(
      JSON.stringify({ ...gate, amortization: amort, contextPct }, null, 2),
    );
  else {
    console.log("Session value gate · S175");
    console.log("─".repeat(56));
    console.log(
      `  ${gate.pass ? "✓ closeout allowed" : "⛔ closeout REFUSED"} — ${gate.reason}`,
    );
    console.log(
      `  boot-amortization: ${amort.ratio == null ? "unknown" : amort.ratio + "×"} (${amort.verdict})`,
    );
  }
  process.exit(gate.pass ? 0 : 11);
}

// ── Saturation verdict ──────────────────────────────────────────────────────────
const v = sessionFloorVerdict({
  contextPct,
  itemsShipped,
  velocityFloor: vFloor,
  listExhausted,
  budgetTotal,
  budgetSpent,
  budgetSpentMeasured: spend.measured,
});

const nextItem = v.verdict === "CONTINUE" ? nextItemTitle() : null;

if (has("--json")) {
  console.log(
    JSON.stringify(
      {
        ...v,
        amortization: amort,
        nextItem,
        derived: {
          contextPct,
          itemsShipped,
          velocityFloor: vFloor,
          listRemaining: remaining,
          budgetTotal,
          budgetSpent,
          budgetSpentMeasured: spend.measured,
          budgetSpentSource: spend.source,
        },
      },
      null,
      2,
    ),
  );
} else {
  console.log("Session floor · S175 — /goal saturation check");
  console.log("─".repeat(56));
  console.log(
    `  ${v.verdict === "CONTINUE" ? "▶ CONTINUE" : "■ STOP"} — ${v.reason}`,
  );
  console.log(
    `  shipped ${itemsShipped}/${vFloor} floor · context ${contextPct == null ? "UNMEASURED" : Math.round(contextPct * 100) + "%"} · list-remaining ${remaining ?? "?"} · amortization ${amort.ratio == null ? "?" : amort.ratio + "×"} (${amort.verdict})`,
  );
  if (v.verdict === "CONTINUE") {
    console.log(
      nextItem
        ? `  → NEXT: ${nextItem}  — take this item (or climb the depth ladder on what you just shipped) and keep working.`
        : "  → select the next-highest unblocked item (or climb the depth ladder) and keep working.",
    );
  }
}
process.exit(v.verdict === "CONTINUE" ? 10 : 0);
