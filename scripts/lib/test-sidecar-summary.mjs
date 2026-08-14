// test-sidecar-summary.mjs — S191 [SIL S190 #1]. Pure reader for the failures-only
// streaming sidecar (.cache/test-failures.ndjson) that run-tests.mjs emits (S190).
//
// WHY THIS EXISTS. The sidecar is written line-by-line during a run: one record
// per FAILED file the instant it resolves (phase 'run'/'retry'), then a single
// closing `phase:'summary'` record with the run verdict. A `tail -f` makes a long
// run observable live (S190's win). This lib lets a CONSUMER — the doctor board
// probe, launch-control telemetry, any CI surface — read that same verdict + the
// last-failure-CAUSE in one cheap parse, WITHOUT re-running the suite. The doctor
// previously could only say "150/150 stale"; it can now say which file failed and
// why, sourced from the most recent run that already happened.
//
// HONESTY (CANON-031 + the S170 committed-vs-local-cache lesson). The sidecar is a
// gitignored LOCAL cache (absent on a fresh machine / in fresh CI). So this lib is
// an ENRICHMENT, never a sole source of truth: `present:false` when absent, and the
// consumer keeps its existing committed/freshness anchor. The one place it does
// drive a verdict is the anti-phantom cross-check (a consumer should not show a
// stale GREEN while a FRESHER local run actually failed) — and that only ever makes
// a surface MORE honest (flags a real failure), never flips a real failure green.
//
// Pure by construction: parseSidecar() takes the ndjson TEXT (unit-testable with no
// filesystem); loadSidecar() is the thin fs wrapper that also returns file age.

import fs from "node:fs";
import path from "node:path";

/**
 * Parse the failures-only sidecar ndjson text.
 * @param {string} text  raw .cache/test-failures.ndjson contents
 * @returns {{
 *   present: boolean,            // at least one parseable record
 *   complete: boolean,           // a closing summary record was found
 *   summary: null | { ok:boolean, totalPass:number, totalAll:number, files:number,
 *                     failures:number, flaky:number, inconclusive:number },
 *   lastFailures: Array<{ file:string, tier:string, cause:string, phase:string }>,
 *   failureCount: number,        // distinct failed files recorded
 *   lastFailureCause: string|null
 * }}
 */
export function parseSidecar(text) {
  const out = {
    present: false,
    complete: false,
    summary: null,
    lastFailures: [],
    failureCount: 0,
    lastFailureCause: null,
  };
  if (!text || typeof text !== "string") return out;
  const records = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      /* skip malformed line, stay greppable */
    }
  }
  if (!records.length) return out;
  out.present = true;

  // The closing record (if the run finished). Take the LAST summary so a re-run
  // appended to the same file reports the latest verdict, never an earlier one.
  const summaries = records.filter((r) => r && r.phase === "summary");
  if (summaries.length) {
    const s = summaries[summaries.length - 1];
    out.complete = true;
    out.summary = {
      ok: !!s.ok,
      totalPass: Number(s.totalPass) || 0,
      totalAll: Number(s.totalAll) || 0,
      files: Number(s.files) || 0,
      failures: Number(s.failures) || 0,
      flaky: Number(s.flaky) || 0,
      inconclusive: Number(s.inconclusive) || 0,
    };
  }

  // Failure records belong to the run that produced the trailing summary. run-tests
  // truncates the file at start of each run, so all failure records here are from
  // the current/most-recent run. A 'retry' record supersedes the 'run' record for
  // the same file (final classification), so key by file and let retry win.
  const byFile = new Map();
  for (const r of records) {
    if (!r || (r.phase !== "run" && r.phase !== "retry")) continue;
    if (!r.file) continue;
    const prev = byFile.get(r.file);
    if (!prev || r.phase === "retry") {
      byFile.set(r.file, {
        file: String(r.file),
        tier: r.tier != null ? String(r.tier) : "?",
        cause: r.cause ? String(r.cause) : "",
        phase: r.phase,
      });
    }
  }
  out.lastFailures = [...byFile.values()];
  out.failureCount = out.lastFailures.length;
  out.lastFailureCause = out.lastFailures.length
    ? out.lastFailures[out.lastFailures.length - 1].cause || null
    : null;
  return out;
}

/**
 * Read + parse the sidecar from disk, adding file age. Returns present:false when
 * the file is absent (the normal fresh-machine / fresh-CI case — never throws).
 * @param {string} rootDir  repo root (the dir containing .cache/)
 * @param {number} [nowMs]  injectable clock for deterministic tests
 * @returns {ReturnType<typeof parseSidecar> & { ageSec: number|null, sidecarPath: string }}
 */
export function loadSidecar(rootDir, nowMs = Date.now()) {
  const sidecarPath = path.join(rootDir, ".cache", "test-failures.ndjson");
  let text = "",
    ageSec = null;
  try {
    text = fs.readFileSync(sidecarPath, "utf8");
    const st = fs.statSync(sidecarPath);
    ageSec = Math.max(0, Math.round((nowMs - st.mtimeMs) / 1000));
  } catch {
    /* absent → present:false below */
  }
  return { ...parseSidecar(text), ageSec, sidecarPath };
}

/**
 * One-line human signal for a board/telemetry surface. Never throws; returns a
 * compact string safe to embed in a probe detail or JSON field.
 * @param {ReturnType<typeof parseSidecar>} parsed
 * @returns {string}
 */
export function formatSidecarSignal(parsed) {
  if (!parsed || !parsed.present) return "no local sidecar";
  const s = parsed.summary;
  if (!s) return `in-progress · ${parsed.failureCount} failure(s) so far`;
  const verdict = s.ok ? "ok" : "FAIL";
  const tail = s.ok ? "" : ` · last: ${parsed.lastFailureCause || "unknown"}`;
  return `${verdict} ${s.totalPass}/${s.totalAll} · ${s.files} files · ${s.failures} fail · ${s.flaky} flaky${tail}`;
}
