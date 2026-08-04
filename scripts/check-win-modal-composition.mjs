#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WIN_MODAL_LINE_BUDGET = 2380;
export const POST_MATCH_SESSION_LINE_BUDGET = 240;

export function inspectWinModalComposition(root = process.cwd()) {
  const modal = fs.readFileSync(
    path.join(root, "src/client/graphics/layers/WinModal.ts"),
    "utf8",
  );
  const lifecycle = fs.readFileSync(
    path.join(root, "src/client/PostMatchSession.ts"),
    "utf8",
  );
  const lines = (source) => source.split(/\r?\n/).length;
  const errors = [];
  if (lines(modal) > WIN_MODAL_LINE_BUDGET) {
    errors.push(
      `WinModal.ts line budget exceeded: ${lines(modal)}/${WIN_MODAL_LINE_BUDGET}`,
    );
  }
  if (lines(lifecycle) > POST_MATCH_SESSION_LINE_BUDGET) {
    errors.push(
      `PostMatchSession.ts line budget exceeded: ${lines(lifecycle)}/${POST_MATCH_SESSION_LINE_BUDGET}`,
    );
  }
  for (const required of [
    "postMatchSessions.begin()",
    "postMatchSessions.cancel()",
    "session.settle(",
    "snapshot.eloHistory",
  ]) {
    if (!modal.includes(required)) {
      errors.push(`WinModal lifecycle binding missing: ${required}`);
    }
  }
  for (const forbidden of [
    "setTimeout(",
    "requestAnimationFrame(",
    'localStorage.getItem("vaultfront.lastElo")',
    'localStorage.setItem("vaultfront.lastElo"',
  ]) {
    if (modal.includes(forbidden)) {
      errors.push(`WinModal reclaimed unmanaged lifecycle state: ${forbidden}`);
    }
  }
  for (const required of [
    "clearTimeout(handle)",
    "cancelAnimationFrame(handle)",
    "this.current.cancel(",
    "PostMatchSessionReceipt",
    "taskOutcomes",
    "onReceipt",
  ]) {
    if (!lifecycle.includes(required)) {
      errors.push(`PostMatchSession cancellation binding missing: ${required}`);
    }
  }
  return {
    ok: errors.length === 0,
    modal: { lines: lines(modal), budget: WIN_MODAL_LINE_BUDGET },
    lifecycle: {
      lines: lines(lifecycle),
      budget: POST_MATCH_SESSION_LINE_BUDGET,
    },
    errors,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = inspectWinModalComposition();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
