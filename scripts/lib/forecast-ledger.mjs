// forecast-ledger.mjs — SIL forecast calibration loop (S220 audit #16).
//
// VERIFIED S220: the brief has emitted a SIL FORECAST every session since S114
// and NOTHING ever scored it against the actual — an unscored forecast is
// decoration, borderline CANON-031. This module closes the loop:
//
//   recordAndResolve({ forSession, forecastTotal, actuals }) — called at brief
//     render time. Resolves any pending forecast whose target session now has
//     an actual total, then appends the new pending forecast (idempotent per
//     target session: re-rendering the same brief updates, never duplicates).
//   rollingMae(n) — mean absolute error over the last n resolved forecasts.
//
// Ledger: portfolio/compiled/FORECAST_LEDGER.json
// Rollback: delete the ledger file — the brief renders without the MAE line.

import fs from "node:fs";
import path from "node:path";

const LEDGER_REL = path.join("portfolio", "compiled", "FORECAST_LEDGER.json");

function ledgerPath(root) {
  return path.join(root, LEDGER_REL);
}

export function loadLedger(root) {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(root), "utf8"));
  } catch {
    return { schemaVersion: 1, entries: [] };
  }
}

/**
 * @param root repo root
 * @param forSession session number the new forecast targets
 * @param forecastTotal predicted total for that session
 * @param actuals array of { session, total } known actual SIL totals (newest first ok)
 */
export function recordAndResolve(
  root,
  { forSession, forecastTotal, actuals = [] },
) {
  const ledger = loadLedger(root);
  const bySession = new Map(actuals.map((a) => [a.session, a.total]));

  // Resolve pending entries whose target session now has an actual.
  for (const e of ledger.entries) {
    if (e.actual == null && bySession.has(e.forSession)) {
      e.actual = bySession.get(e.forSession);
      e.absErr = Math.abs(e.actual - e.forecast);
      e.resolvedAt = new Date().toISOString().slice(0, 10);
    }
  }

  // Upsert the new pending forecast (re-render of the same session updates in place).
  if (Number.isFinite(forSession) && Number.isFinite(forecastTotal)) {
    const existing = ledger.entries.find(
      (e) => e.forSession === forSession && e.actual == null,
    );
    if (existing) existing.forecast = forecastTotal;
    else
      ledger.entries.push({
        forSession,
        forecast: forecastTotal,
        recordedAt: new Date().toISOString().slice(0, 10),
        actual: null,
      });
  }

  // Bound the ledger (rotation-in-place; this is a small calibration record, not history).
  if (ledger.entries.length > 200) ledger.entries = ledger.entries.slice(-200);

  fs.mkdirSync(path.dirname(ledgerPath(root)), { recursive: true });
  fs.writeFileSync(ledgerPath(root), JSON.stringify(ledger, null, 2));
  return ledger;
}

/** Rolling MAE over the last n resolved forecasts. Returns null when <min samples. */
export function rollingMae(ledger, n = 10, min = 3) {
  const resolved = ledger.entries.filter((e) => e.absErr != null).slice(-n);
  if (resolved.length < min) return { mae: null, samples: resolved.length };
  const mae = resolved.reduce((s, e) => s + e.absErr, 0) / resolved.length;
  return { mae: Math.round(mae * 10) / 10, samples: resolved.length };
}
