// spawn-resilience.mjs — S203 [SIL][S202 #1] test-runner handle-exhaustion ROOT-FIX.
//
// ONE shared spawn-resilience policy for every test-spawning surface in the repo
// (run-tests.mjs · refresh-test-count.mjs). Both used to run files SERIALLY via
// spawnSync, so the "handle-exhaustion" carried as [SIL #2] since S200 was never the
// runner's own concurrency — it was the OS process/handle table saturating under
// 8-12 concurrent founder sessions, so spawnSync itself could not create the child.
// Node signals that by setting `res.error` with a resource code (EAGAIN/EMFILE/…)
// and producing NO test output. The two runners handled it INCONSISTENTLY and both
// wrongly: run-tests treated the spawn failure as a test failure; refresh-test-count
// (the canonical surface the doctor + brief read) fell through to its generic else
// branch and counted it as a hard FAILURE — flipping a green suite red purely from
// machine load. Divergent observability policies across paired surfaces is the exact
// antipattern the studio extracts to a shared lib (S153/S159). This is that lib.
//
// Contract (CANON-031 observability honesty):
//   • A spawn-level resource failure is INFRASTRUCTURE, not a regression.
//   • Retry with bounded exponential backoff to ride out the transient exhaustion
//     (the canonical EAGAIN remedy) — on any reasonable host this drives it to 0.
//   • If STILL unspawnable after the backoff budget, report it DISTINCTLY (the
//     caller buckets it 'env-blocked' / 'inconclusive'): never counted green
//     (no fabrication), never counted as a real fail (no phantom regression).
//   • It can NEVER mask an assertion failure: a test that actually ran leaves
//     res.error undefined, so a real `pass < total` stays red.

// OS resource-exhaustion codes that a backoff retry can ride out. ENOENT (command
// genuinely missing) is deliberately EXCLUDED — retrying a missing binary forever
// would hide a real "node/npx not found", so it must surface as a normal failure.
export const SPAWN_EXHAUSTION_CODES = new Set([
  "EAGAIN",
  "EMFILE",
  "ENFILE",
  "ENOMEM",
  "UV_EMFILE",
]);

// True iff spawnSync could not create the child due to host resource exhaustion.
// Pure + total: never throws on null/partial input.
export function isSpawnExhaustion(res) {
  if (!res || !res.error) return false;
  return SPAWN_EXHAUSTION_CODES.has(res.error.code || "");
}

// Deterministic backoff (ms) for the Nth retry: 200,400,800,1600,3200 capped at 5s.
// Exported pure so the schedule is unit-pinned and can't silently shorten (a too-short
// schedule would defeat the whole fix). attempt ≤ 1 → base delay; never negative.
export function spawnBackoffMs(attempt) {
  return Math.min(200 * 2 ** Math.max(0, attempt - 1), 5000);
}

// Synchronous sleep — the test runners are serial (spawnSync), so an async sleep
// would force promises through their forEach. Atomics.wait blocks the thread without
// busy-spinning. Best-effort: degrades to a no-op if SharedArrayBuffer is unavailable.
export function sleepSync(ms) {
  if (!(ms > 0)) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SAB blocked → skip wait */
  }
}

// Resilient wrapper around a caller-supplied spawnSync. Retries ONLY spawn-level
// resource exhaustion (never a test that actually ran-and-failed). Returns the final
// spawnSync result plus metadata so the caller can bucket honestly:
//   { res, spawnRetries, envBlocked }
//   - envBlocked === true  → still couldn't spawn after the backoff budget (host
//                            saturated). Caller must NOT count it as pass or fail.
//   - envBlocked === false → res is a genuine run result (pass or real failure).
// `sleep` is injectable so unit tests run instantly without real backoff waits.
export function spawnResilient(
  spawnSyncFn,
  cmd,
  args,
  opts = {},
  { retries = 5, sleep = sleepSync } = {},
) {
  let res,
    attempt = 0;
  for (;;) {
    res = spawnSyncFn(cmd, args, opts);
    if (!isSpawnExhaustion(res) || attempt >= retries) break;
    attempt++;
    sleep(spawnBackoffMs(attempt));
  }
  return { res, spawnRetries: attempt, envBlocked: isSpawnExhaustion(res) };
}
