/**
 * human-action-ages.mjs — First-seen tracker for Human Action Required items.
 *
 * Founder unlocks brief box showed "new" for items that had no `~N sessions`
 * notation, so aged-item escalation couldn't fire. This module maintains
 * portfolio/HUMAN_ACTION_AGES.json mapping each canonical action title to its
 * first-seen ISO date and session number.
 *
 * Usage:
 *   import { ensureAges, daysSince } from './lib/human-action-ages.mjs';
 *   const ages = ensureAges(taskBoardText, { root });
 *   ages[title] -> { firstSeen: '2026-01-02', session: 45 }
 */

import fs from "node:fs";
import path from "node:path";
import { parseHumanItemsResult } from "./task-board.mjs";

const LEDGER_REL = "portfolio/HUMAN_ACTION_AGES.json";

function readLedger(root) {
  const p = path.join(root, LEDGER_REL);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function writeLedger(root, ledger) {
  const p = path.join(root, LEDGER_REL);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ledger, null, 2));
}

export function ensureAges(taskBoardText, opts = {}) {
  const root = opts.root || process.cwd();
  const ledger = readLedger(root);
  const parsed = parseHumanItemsResult(taskBoardText);
  if (parsed.status === "unknown") {
    opts.onUnknown?.(parsed.reason);
    return ledger;
  }
  const items = parsed.items;
  const today = new Date().toISOString().slice(0, 10);
  const session = opts.currentSession || null;
  let dirty = false;

  // Add any new items with today's date.
  for (const item of items) {
    if (!ledger[item.title]) {
      ledger[item.title] = { firstSeen: today, session };
      dirty = true;
    }
  }

  // Prune titles that no longer appear (they got resolved).
  const activeTitles = new Set(items.map((i) => i.title));
  for (const title of Object.keys(ledger)) {
    if (!activeTitles.has(title)) {
      delete ledger[title];
      dirty = true;
    }
  }

  if (dirty && !opts.readonly) writeLedger(root, ledger);
  return ledger;
}

export function daysSince(isoDate) {
  const d = new Date(isoDate).getTime();
  if (!Number.isFinite(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
}
