// host-load.mjs — cheap host-saturation probe for freshness-honest signalling.
//
// WHY: when the test suite can't run because the host is saturated with concurrent
// sessions (many node.exe processes + handle exhaustion), `test-suite-freshness`
// would only see "age > 24h" and report the suite as "code-stale" — implying a
// code regression that doesn't exist. This probe lets the surface distinguish:
//   • env-blocked  → host saturation is the likely cause (many node procs)
//   • code-stale   → host looks idle; staleness more likely a real regression
//
// CANON-031: this surface must not lie. "env-blocked" is not a green-wash — the
// probe still returns pass:false; it just carries an honest cause qualifier.
//
// S197 [SIL #2] — freshness-host-limited honest state.

import { spawnSync } from "./safe-spawn.mjs";

// Node processes ≥ this count → "host likely saturated with concurrent sessions".
// Each Claude Code session spawns ~1-3 node.exe instances; 6+ = 2+ concurrent sessions.
const HOST_SATURATION_THRESHOLD = 6;

/**
 * Returns a cheap snapshot of the current host node-process count.
 *
 * @returns {{ nodeCount: number, saturated: boolean, error?: boolean }}
 */
export function getHostLoad() {
  try {
    const isWin = process.platform === "win32";
    let r;
    if (isWin) {
      // `tasklist /FI "IMAGENAME eq node.exe" /NH /FO CSV` — /NH requires CSV or TABLE
      r = spawnSync(
        "tasklist",
        ["/FI", "IMAGENAME eq node.exe", "/NH", "/FO", "CSV"],
        { windowsHide: true, encoding: "utf8", timeout: 5000 },
      );
      if (r.error) return { nodeCount: -1, saturated: false, error: true };
      // Each matching process produces one CSV row; no header (we used /NH).
      // When nothing matches, tasklist still exits 0 but prints "INFO: No tasks …"
      const nodeCount = r.stdout
        .split("\n")
        .filter((l) => l.startsWith('"node.exe"')).length;
      return { nodeCount, saturated: nodeCount >= HOST_SATURATION_THRESHOLD };
    } else {
      // `ps -A -o comm=` lists all process command names, one per line
      r = spawnSync("ps", ["-A", "-o", "comm="], {
        encoding: "utf8",
        timeout: 5000,
      });
      if (r.status !== 0 || r.error)
        return { nodeCount: -1, saturated: false, error: true };
      const nodeCount = r.stdout
        .split("\n")
        .filter((l) => l.trim() === "node").length;
      return { nodeCount, saturated: nodeCount >= HOST_SATURATION_THRESHOLD };
    }
  } catch {
    return { nodeCount: -1, saturated: false, error: true };
  }
}

/**
 * Returns a human-readable saturation tag for embedding in probe detail strings.
 * Empty string when host looks idle (avoids noisy normal-state output).
 *
 * @param {{ nodeCount: number, saturated: boolean, error?: boolean }} load
 * @returns {string}
 */
export function formatHostTag(load) {
  if (load.error || load.nodeCount < 0) return "";
  if (!load.saturated) return "";
  return ` · env-blocked (${load.nodeCount} node procs, host saturated — code-stale unconfirmed)`;
}
