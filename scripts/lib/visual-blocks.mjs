// visual-blocks.mjs — S114 (S113 founder direction)
// Canonical chart primitives for every founder-facing brief across all 28 Studio
// projects + both Claude Code and Codex. Single import, identical visual language
// portfolio-wide.
//
// Used by:
//   - studio-ops:           scripts/render-startup-brief.mjs
//   - all project /start:   delegates to studio-brief-renderer subagent
//   - studio-ops:           scripts/render-state-vector.mjs · render-ignis-core.mjs
//   - studio-ops:           closeout-status-board · founder-cockpit
//   - vaultsparkstudios-website (S113 #608 — Option 3 auto-render)
//
// Design principles:
//   1. Pure functions — no I/O, no side effects, deterministic
//   2. ASCII-only by default (Codex/Windows-safe); Unicode opt-in
//   3. Cheap to render — no external deps; meant to be called many times per brief
//   4. Composable — blocks return strings or arrays of strings the caller boxes
//
// Reference: docs/UNIFIED_BRIEF_FORMAT.md

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 1 — Sparkline (8-level Unicode bar series)
// ─────────────────────────────────────────────────────────────────────────────

const SPARK_CHARS_U = "▁▂▃▄▅▆▇█".split("");
const SPARK_CHARS_A = " .:-=+*#".split(""); // ASCII fallback

/**
 * Render a numeric series as a sparkline (one char per value).
 * @param {number[]} values
 * @param {object} opts - { max?: number, min?: number, ascii?: boolean }
 * @returns {string}
 */
export function sparkline(values, opts = {}) {
  if (!Array.isArray(values) || values.length === 0) return "—";
  const chars = opts.ascii ? SPARK_CHARS_A : SPARK_CHARS_U;
  const max = opts.max ?? Math.max(...values, 1);
  const min = opts.min ?? 0;
  const range = Math.max(0.0001, max - min);
  return values
    .map((v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return chars[0];
      const n = Math.min(7, Math.max(0, Math.floor(((v - min) / range) * 7)));
      return chars[n];
    })
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 2 — Horizontal progress bar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `██████░░░░` style 10-cell bar.
 * @param {number} value
 * @param {object} opts - { max?: number=100, width?: number=10, ascii?: boolean }
 */
export function bar(value, opts = {}) {
  const max = opts.max ?? 100;
  const width = opts.width ?? 10;
  const filled = Math.min(
    width,
    Math.max(0, Math.round((value / max) * width)),
  );
  const empty = width - filled;
  if (opts.ascii) return "#".repeat(filled) + ".".repeat(empty);
  return "█".repeat(filled) + "░".repeat(empty);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 3 — Trend arrow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare current to prior (or trend-of-3). Returns one of: ↑ ↓ → ⤒ ⤓
 */
export function trend(current, prior, opts = {}) {
  const threshold = opts.threshold ?? 0.5;
  if (typeof current !== "number" || typeof prior !== "number") return "→";
  const delta = current - prior;
  if (opts.ascii) {
    if (delta > threshold * 2) return "^^";
    if (delta > threshold) return "^";
    if (delta < -threshold * 2) return "vv";
    if (delta < -threshold) return "v";
    return "->";
  }
  if (delta > threshold * 2) return "⤒";
  if (delta > threshold) return "↑";
  if (delta < -threshold * 2) return "⤓";
  if (delta < -threshold) return "↓";
  return "→";
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 4 — Status glyphs (semaphore-aware)
// ─────────────────────────────────────────────────────────────────────────────

export const GLYPH = {
  ok: "✓",
  warn: "⚠",
  fail: "⛔",
  info: "ℹ",
  spark: "⚡",
  urgent: "🔥",
  idea: "💡",
  ascii: {
    ok: "OK",
    warn: "!",
    fail: "X",
    info: "i",
    spark: "*",
    urgent: "!!",
    idea: "?",
  },
};

export function glyph(status, opts = {}) {
  if (opts.ascii) return GLYPH.ascii[status] || "·";
  return GLYPH[status] || "·";
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 5 — Heatmap row (n-cell intensity strip)
// ─────────────────────────────────────────────────────────────────────────────

const HEAT_CHARS_U = " ░▒▓█";
const HEAT_CHARS_A = " .:#█";

/**
 * Heatmap of intensities (0..max) → row of cells.
 * @param {number[]} values
 * @param {object} opts - { max?: number=100, ascii?: boolean }
 */
export function heatmap(values, opts = {}) {
  if (!Array.isArray(values) || values.length === 0) return "";
  const chars = opts.ascii ? HEAT_CHARS_A : HEAT_CHARS_U;
  const max = opts.max ?? Math.max(...values, 1);
  return values
    .map((v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return chars[0];
      const n = Math.min(
        chars.length - 1,
        Math.max(0, Math.floor((v / max) * (chars.length - 1))),
      );
      return chars[n];
    })
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 6 — Gauge (circular-style ASCII)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Half-circle gauge: returns 2-line array showing dial position.
 * Useful for budget-style "% remaining" displays.
 *  pct=0   →  [ "  ╭───╮  ", "  ╰───╯  " ]   (empty)
 *  pct=50  →  [ "  ╭███╮  ", "  ╰█──╯  " ]
 *  pct=100 →  [ "  ╭███╮  ", "  ╰███╯  " ]   (full)
 */
export function gauge(pct, opts = {}) {
  pct = Math.min(100, Math.max(0, pct));
  const filled = Math.round(pct / 10);
  if (opts.ascii) {
    const top = "[" + "#".repeat(filled).padEnd(10, " ") + "]";
    return [top, `${pct.toFixed(0).padStart(3)}%`];
  }
  const topBar = "╭" + "─".repeat(10) + "╮";
  const fillBar = "│" + "█".repeat(filled).padEnd(10, "░") + "│";
  const botBar = "╰" + "─".repeat(10) + "╯";
  return [topBar, fillBar, botBar, `${pct.toFixed(0).padStart(3)}%`];
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 7 — Boxed section (canonical box-drawing wrapper)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap content lines in a labeled box. Width auto-fits or fixed via opts.width.
 * Default width 66 chars (matches existing studio-ops brief).
 *
 * Examples (default):
 *   ╔══ TITLE ══════════════════════════════════════════════════════╗
 *   ║  content line 1                                                  ║
 *   ║  content line 2                                                  ║
 *   ╚════════════════════════════════════════════════════════════════╝
 */
export function box(title, lines, opts = {}) {
  const width = opts.width ?? 66;
  const inner = width - 4; // 2 chars padding on each side
  const ascii = opts.ascii ?? false;
  const C = ascii
    ? { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" }
    : { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" };

  const out = [];
  const titleStr = title ? ` ${title} ` : "";
  const headFill = C.h.repeat(Math.max(2, inner + 2 - titleStr.length));
  out.push(`${C.tl}${C.h}${C.h}${titleStr}${headFill}${C.tr}`);
  for (const line of lines) {
    const stripped = stripAnsi(line);
    const pad = Math.max(0, inner - stripped.length);
    out.push(`${C.v}  ${line}${" ".repeat(pad)}  ${C.v}`);
  }
  out.push(`${C.bl}${C.h.repeat(width - 2)}${C.br}`);
  return out;
}

function stripAnsi(s) {
  const escapeSequence = new RegExp(
    `${String.fromCharCode(27)}\\[[0-9;]*m`,
    "g",
  );
  return String(s).replace(escapeSequence, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 8 — Vertical-bar mini chart (for short series, e.g. last-5 velocity)
// ─────────────────────────────────────────────────────────────────────────────

const VBAR_CHARS_U = "▁▂▃▄▅▆▇█".split("");
const VBAR_CHARS_A = ".,:;|#$@".split("");

export function vbars(values, opts = {}) {
  if (!Array.isArray(values) || values.length === 0) return "—";
  const chars = opts.ascii ? VBAR_CHARS_A : VBAR_CHARS_U;
  const max = opts.max ?? Math.max(...values, 1);
  return values
    .map((v) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return chars[0];
      const n = Math.min(7, Math.max(0, Math.floor((v / max) * 7)));
      return chars[n];
    })
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 9 — Categorized score table row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard format: "  CategoryName    Score  Bar        Spark   Δ "
 * Used for SIL category breakdown + IGNIS pillar scoring.
 */
export function scoreRow(
  label,
  score,
  history = [],
  priorAvg = score,
  opts = {},
) {
  const labelW = opts.labelW ?? 17;
  const scoreStr = String(Math.round(score)).padStart(3);
  return `  ${label.padEnd(labelW)} ${scoreStr}    ${bar(score, { width: 10, max: opts.max ?? 100, ascii: opts.ascii })}  ${sparkline(history, { ascii: opts.ascii }).padEnd(8)} ${trend(score, priorAvg, { ascii: opts.ascii })}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE 10 — Tier glyph for ranked items (🔥 / ⚡ / 💡)
// ─────────────────────────────────────────────────────────────────────────────

export function tierGlyph(tier, opts = {}) {
  if (opts.ascii) {
    if (tier === "critical" || tier === "🔥") return "!!";
    if (tier === "high" || tier === "⚡") return "!";
    if (tier === "medium" || tier === "💡") return "?";
    return " ";
  }
  if (tier === "critical" || tier === "🔥") return "🔥";
  if (tier === "high" || tier === "⚡") return "⚡";
  if (tier === "medium" || tier === "💡") return "💡";
  return " ";
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Compose primitives into common founder-brief sections
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SCORE block — the canonical 10-category SIL section.
 * Caller passes { current: {dev,align,...}, history: {dev:[...],...}, prior: {...} }
 */
export function scoreBlock({
  current,
  history = {},
  prior = {},
  total,
  max = 1000,
  ascii = false,
}) {
  const pct = total != null ? Math.round((total / max) * 100) : 0;
  const lines = [
    "",
    `    ${total}/${max}   ${bar(total, { width: 24, max, ascii })}   ${pct}%`,
    `    SIL v3.0  ·  Trend  ${vbars(history.totals || [], { ascii })}  ${trend(total, prior.total ?? total, { ascii })}`,
    "",
    `    Category         Score  Bar        Spark   Δ`,
    `    ─────────────── ────── ────────── ──────── ─`,
    scoreRow(
      "Dev Health",
      current.dev ?? 0,
      history.dev || [],
      prior.dev ?? current.dev,
      { ascii },
    ),
    scoreRow(
      "Alignment",
      current.align ?? 0,
      history.align || [],
      prior.align ?? current.align,
      { ascii },
    ),
    scoreRow(
      "Momentum",
      current.momentum ?? 0,
      history.momentum || [],
      prior.momentum ?? current.momentum,
      { ascii },
    ),
    scoreRow(
      "Engagement",
      current.engage ?? 0,
      history.engage || [],
      prior.engage ?? current.engage,
      { ascii },
    ),
    scoreRow(
      "Process Qual",
      current.process ?? 0,
      history.process || [],
      prior.process ?? current.process,
      { ascii },
    ),
    scoreRow(
      "Coherence",
      current.coherence ?? 0,
      history.coherence || [],
      prior.coherence ?? current.coherence,
      { ascii },
    ),
    scoreRow(
      "Security",
      current.security ?? 0,
      history.security || [],
      prior.security ?? current.security,
      { ascii },
    ),
    scoreRow(
      "Ecosystem",
      current.ecosystem ?? 0,
      history.ecosystem || [],
      prior.ecosystem ?? current.ecosystem,
      { ascii },
    ),
    scoreRow(
      "Capital",
      current.capital ?? 0,
      history.capital || [],
      prior.capital ?? current.capital,
      { ascii },
    ),
    scoreRow(
      "Automation",
      current.automation ?? 0,
      history.automation || [],
      prior.automation ?? current.automation,
      { ascii },
    ),
    "",
  ];
  return box("SCORE", lines, { ascii });
}

/**
 * SIGNALS block — semaphore-style multi-row signal list.
 * Caller passes an array of { status, label, detail } objects.
 */
export function signalsBlock(signals, opts = {}) {
  const lines = signals.map(
    (s) => `  ${glyph(s.status, opts)}  ${s.label.padEnd(14)} ${s.detail}`,
  );
  return box("SIGNALS", lines, opts);
}

/**
 * GENIUS HIT LIST — ranked items.
 * items: [{ tier, slug, category, title, line2? }]
 */
export function geniusHitList(items, opts = {}) {
  const lines = [""];
  items.forEach((item, i) => {
    const n = String(i + 1).padStart(2);
    lines.push(
      `  ${tierGlyph(item.tier, opts)}  ${n}  [${item.category}]  ${item.title}`,
    );
    if (item.line2) lines.push(`        ${item.line2}`);
    lines.push("");
  });
  return box("GENIUS HIT LIST", lines, opts);
}

/**
 * FOUNDER UNLOCKS — single-action items that reopen sprint surface.
 * items: [{ age, label, urgent? }]
 */
export function founderUnlocksBlock(items, opts = {}) {
  const lines = [
    "  Single founder actions that reopen sprint surface:",
    "",
    ...items.map(
      (u) =>
        `  ${String(u.age).padStart(5)} · ${u.urgent ? glyph("urgent", opts) + " " : ""}${u.label}`,
    ),
  ];
  return box("FOUNDER UNLOCKS", lines, opts);
}

/**
 * Validation helper — caller can assert their brief has the canonical sections.
 */
export const CANONICAL_SECTIONS = [
  "WHERE TO TEST",
  "SCORE",
  "WHERE WE LEFT OFF",
  "SIGNALS",
  "IGNIS INSIGHT",
  "FOUNDER UNLOCKS",
  "PORTFOLIO TASK BOARDS",
  "EXECUTION PLAN",
  "HUMAN PRESSURE",
  "SESSION VOICE",
  "MOMENTUM METER",
  "GENIUS HIT LIST",
];

export function validateBrief(briefText) {
  const present = CANONICAL_SECTIONS.filter((s) => briefText.includes(s));
  const missing = CANONICAL_SECTIONS.filter((s) => !briefText.includes(s));
  return {
    valid: missing.length === 0,
    presentCount: present.length,
    totalCount: CANONICAL_SECTIONS.length,
    missing,
  };
}
