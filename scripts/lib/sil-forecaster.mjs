// sil-forecaster.mjs
// Audit item #3 (S114). Forecast next session's SIL category scores from
// last-3 session deltas + current TASK_BOARD pressure + velocity signals.
//
// Read by: scripts/render-startup-brief.mjs (new SIL FORECAST block)
// Pure function — no I/O side-effects.

import fs from "node:fs";
import path from "node:path";
import { parseSilSessions } from "./sil-ledger.mjs";

const CATEGORIES = [
  "Dev Health",
  "Creative Alignment",
  "Momentum",
  "Engagement",
  "Process Quality",
  "Cross-Repo Coher",
  "Security Posture",
  "Ecosystem Integ",
  "Capital Efficiency",
  "Automation Cover",
];

const CATEGORY_ALIASES = {
  "Cross-Repo Coherence": "Cross-Repo Coher",
  "Ecosystem Integration": "Ecosystem Integ",
  "Automation Coverage": "Automation Cover",
  "Engagement (infra)": "Engagement",
};

export function parseSilHistory(silText, maxSessions = 5) {
  return parseSilSessions(silText)
    .filter((entry) => entry.total != null)
    .slice(0, maxSessions)
    .map((entry) => ({
      date: entry.date,
      session: entry.session,
      total: entry.totalNormalized,
      categories: Object.fromEntries(
        Object.entries(entry.categories).map(([raw, value]) => [
          CATEGORY_ALIASES[raw] || raw,
          value,
        ]),
      ),
    }));
}

export function forecastNext(sessions, signals = {}) {
  // signals: { velocity, blockerPressure, contextAge, unblocked }
  if (!sessions.length) return null;
  const forecast = {};
  for (const cat of CATEGORIES) {
    const series = sessions
      .map((s) => s.categories[cat])
      .filter((n) => typeof n === "number");
    if (!series.length) {
      forecast[cat] = { predicted: null, confidence: "none" };
      continue;
    }
    // Simple AR(1): predict = last + alpha * (last - last-1), clamped 0..100
    const last = series[0];
    const last2 = series[1] ?? last;
    let delta = last - last2;
    // Apply external-signal nudges
    if (cat === "Momentum" && signals.velocity != null) {
      delta += signals.velocity >= 10 ? 2 : signals.velocity <= 2 ? -5 : 0;
    }
    if (cat === "Security Posture" && signals.blockerPressure >= 80) {
      delta -= 2; // aging credentials drag security
    }
    if (cat === "Capital Efficiency" && signals.contextAge >= 7) {
      delta -= 1;
    }
    const predicted = Math.max(0, Math.min(100, last + 0.6 * delta));
    forecast[cat] = {
      predicted: Math.round(predicted),
      delta: Math.round(predicted - last),
      confidence: series.length >= 3 ? "medium" : "low",
    };
  }
  // Aggregate total
  const predicted = Object.values(forecast).filter(
    (entry) => entry.predicted != null,
  );
  if (!predicted.length) return null;
  const totalPred = predicted.reduce((sum, entry) => sum + entry.predicted, 0);
  return {
    categories: forecast,
    totalPredicted: totalPred,
    basis: sessions.length,
  };
}

export function renderForecastBlock(forecast, currentTotal = null) {
  if (!forecast) return "";
  const lines = [];
  lines.push(
    "╔══ SIL FORECAST (next session) ═════════════════════════════════╗",
  );
  const arrow = (d) => (d > 0 ? "↑" : d < 0 ? "↓" : "→");
  if (currentTotal != null) {
    const diff = forecast.totalPredicted - currentTotal;
    lines.push(
      `║  Projected total: ${forecast.totalPredicted}/1000  (${arrow(diff)}${Math.abs(diff)} vs current ${currentTotal})`.padEnd(
        67,
      ) + "║",
    );
  } else {
    lines.push(
      `║  Projected total: ${forecast.totalPredicted}/1000`.padEnd(67) + "║",
    );
  }
  const risky = Object.entries(forecast.categories)
    .filter(([, f]) => f.delta != null && f.delta <= -3)
    .sort((a, b) => a[1].delta - b[1].delta)
    .slice(0, 3);
  if (risky.length) {
    lines.push("║".padEnd(67) + "║");
    lines.push("║  At-risk categories (forecast drop ≥3):".padEnd(67) + "║");
    for (const [cat, f] of risky) {
      lines.push(
        `║    ↓ ${cat.padEnd(22)} ${f.predicted} (Δ${f.delta})`.padEnd(67) +
          "║",
      );
    }
  } else {
    lines.push("║  All categories forecast stable or rising.".padEnd(67) + "║");
  }
  lines.push(
    "╚════════════════════════════════════════════════════════════════╝",
  );
  return lines.join("\n");
}

// CLI entry
if (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` ||
  process.argv[1].endsWith("sil-forecaster.mjs")
) {
  const root = process.cwd();
  const silPath = path.join(root, "context", "SELF_IMPROVEMENT_LOOP.md");
  const sil = fs.readFileSync(silPath, "utf8");
  const sessions = parseSilHistory(sil);
  const last = sessions[0];
  const forecast = forecastNext(sessions, {
    velocity: 11,
    blockerPressure: 87,
    contextAge: 0,
  });
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          basis: sessions.map((s) => ({ session: s.session, total: s.total })),
          forecast,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderForecastBlock(forecast, last?.total));
  }
}
