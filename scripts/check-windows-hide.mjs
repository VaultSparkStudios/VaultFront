#!/usr/bin/env node
// check-windows-hide.mjs — S186 window-storm guard, BROADENED in S187.
//
// THE BUG (observed live, S186 + S187): on Windows a Node child_process spawn pops a
// VISIBLE Git Bash / mingw console window per call unless `windowsHide: true` is set.
// A hot-path spawner — run-doctor.mjs (~90 probe children), run-tests.mjs (~190) —
// therefore (a) floods the screen with focus-stealing windows that make the machine
// UNUSABLE, and (b) trips Windows Defender's behavioral heuristic
// `Trojan:Win32/SuspExec.SE` (rapid mass shell execution looks like malware). Both
// share ONE root cause: a burst of un-hidden child spawns.
//
// WHY S186's guard was incomplete: it keyed ONLY on `shell: true`. But plain
// `spawn(node, [...])` / `spawnSync(node, [...])` with NO shell storms identically —
// that is exactly what run-doctor.mjs did, and the guard never flagged it. The
// correct rule is broader: EVERY spawn sets windowsHide:true.
//
// S187 mechanizes that via scripts/lib/safe-spawn.mjs — a hardened drop-in that forces
// windowsHide:true on every spawn. So the PRIMARY invariant is now structural and
// simple to enforce:
//
//   PRIMARY (S187): no script imports `child_process` directly — all spawn calls go
//   through ./lib/safe-spawn.mjs (allow-list: the wrapper itself, the runtime shim,
//   and the shim's test, which intentionally probe the raw module).
//   LEGACY (S186): any literal `shell: true` spawn still must set windowsHide:true
//   (covers the wrapper internals + any raw-module allow-listed file).
//
// Usage:
//   node scripts/check-windows-hide.mjs            # human report, exit 1 on violations
//   node scripts/check-windows-hide.mjs --json     # machine output
//
// Propagated studio-wide (CANON-016): every project ships this guard + safe-spawn.mjs
// + windows-hide-shim.cjs so no agent, in any repo, can reintroduce the window-storm.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Reuse the ONE canonical directory-walk ignore set — do NOT re-declare the literal
// (policy-drift-lint discipline, S188; same pattern as lib/committed-state.mjs).
import { WALK_IGNORE_DIRS } from "./lib/shared-policies.mjs";

const ROOT = (() => {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return process.cwd();
  }
})();
const OWNED_ROOTS = [
  join(ROOT, "scripts"),
  join(ROOT, "tests", "scripts"),
  join(ROOT, "tests", "perf"),
];

// Directories to skip (no source spawns we own / vendored): canonical set + 'coverage'.
const SKIP_DIRS = new Set([...WALK_IGNORE_DIRS, "coverage"]);

// Files allowed to import the raw `child_process` module: the hardened wrapper (which
// MUST), the runtime preload shim (CommonJS, patches the global module), and the shim's
// own test (intentionally spies on the raw module). Paths are repo-relative, POSIX.
const RAW_CP_ALLOWLIST = new Set([
  "scripts/lib/safe-spawn.mjs",
  "scripts/lib/windows-hide-shim.cjs",
  "scripts/test/tier1-windows-hide-shim.mjs",
]);

// A direct import/require of node:child_process (any quote/spacing, with or without node: prefix).
const RAW_CP_RE =
  /(?:from\s*['"]|require\(\s*['"]|import\(\s*['"])(?:node:)?child_process['"]/;

function roots(value) {
  return Array.isArray(value) ? value : [value];
}

// Scan a tree for scripts that import child_process directly instead of the hardened
// wrapper. Pure file reads — no child spawns — safe to call in-process from a test.
export function scanDirectChildProcessImports(root = OWNED_ROOTS) {
  const violations = [];
  for (const file of roots(root).flatMap((entry) => walk(entry))) {
    const relPath = relative(ROOT, file).replace(/\\/g, "/");
    if (RAW_CP_ALLOWLIST.has(relPath)) continue;
    const src = readFileSync(file, "utf8");
    if (!RAW_CP_RE.test(src)) continue;
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (RAW_CP_RE.test(lines[i]))
        violations.push({ file: relPath, line: i + 1 });
    }
  }
  return violations;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (
      name.endsWith(".mjs") ||
      name.endsWith(".js") ||
      name.endsWith(".ts") ||
      name.endsWith(".tsx")
    )
      out.push(p);
  }
  return out;
}

// For each `shell: true` (any spacing), look in a ±450-char window for both a
// spawn-family caller and a `windowsHide: true`. A shell:true spawn missing
// windowsHide in its own options object is a violation.
const SHELL_RE = /shell\s*:\s*true/g;
const SPAWN_NEAR =
  /\b(spawnSync|spawn|execSync|execFileSync|execFile|exec|fork)\s*\(/;
const HIDE_RE = /windowsHide\s*:\s*true/;

// Scan a tree for shell:true spawns missing windowsHide:true. Pure file reads —
// no child spawns — so it is safe to call in-process from a test.
export function scanWindowsHide(root = join(ROOT, "scripts")) {
  const violations = [];
  for (const file of walk(root)) {
    if (file.endsWith("check-windows-hide.mjs")) continue; // don't lint the guard's own pattern doc
    // This is a source guard, not a prose linter. Comments routinely explain
    // why shell mode is avoided; treating those words as executable options
    // creates false failures and hides real regressions in noise.
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    SHELL_RE.lastIndex = 0;
    let m;
    while ((m = SHELL_RE.exec(src)) !== null) {
      const idx = m.index;
      const before = src.slice(Math.max(0, idx - 450), idx);
      const window = src.slice(
        Math.max(0, idx - 450),
        Math.min(src.length, idx + 450),
      );
      if (!SPAWN_NEAR.test(before)) continue; // not a spawn options object
      if (HIDE_RE.test(window)) continue; // properly hidden
      const line = src.slice(0, idx).split("\n").length;
      violations.push({ file: relative(ROOT, file).replace(/\\/g, "/"), line });
    }
  }
  return violations;
}

// S206 root-cause guard: shell-resolving literal `node` is the window-storm/DEP0190
// source when `process.execPath` would work. `npx`/`.cmd` shim calls may still need
// a shell on Windows; literal node does not.
const LITERAL_NODE_SPAWN_NEAR =
  /\b(spawnSync|spawn|execFileSync|execFile)\s*\(\s*['"]node['"]/;

export function scanShellNodeSpawns(root = join(ROOT, "scripts")) {
  const violations = [];
  for (const file of walk(root)) {
    if (file.endsWith("check-windows-hide.mjs")) continue;
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    SHELL_RE.lastIndex = 0;
    let m;
    while ((m = SHELL_RE.exec(src)) !== null) {
      const idx = m.index;
      const before = src.slice(Math.max(0, idx - 450), idx);
      if (!LITERAL_NODE_SPAWN_NEAR.test(before)) continue;
      const line = src.slice(0, idx).split("\n").length;
      violations.push({ file: relative(ROOT, file).replace(/\\/g, "/"), line });
    }
  }
  return violations;
}
// CLI entry — only when run directly (not on import).
const INVOKED_DIRECTLY =
  process.argv[1] && process.argv[1].endsWith("check-windows-hide.mjs");
if (INVOKED_DIRECTLY) {
  const JSON_OUT = process.argv.includes("--json");
  const shellViolations = scanWindowsHide(); // legacy: shell:true missing windowsHide
  const rawImports = scanDirectChildProcessImports(); // primary: direct child_process import
  const shellNodeSpawns = scanShellNodeSpawns(); // root-cause: literal node behind shell:true
  const total =
    shellViolations.length + rawImports.length + shellNodeSpawns.length;
  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          ok: total === 0,
          count: total,
          directChildProcessImports: rawImports,
          shellTrueMissingHide: shellViolations,
          shellNodeSpawns,
        },
        null,
        2,
      ),
    );
  } else if (total === 0) {
    console.log(
      "✓ windows-hide: all spawns route through lib/safe-spawn.mjs and set windowsHide:true (no window-storm / no SuspExec heuristic)",
    );
  } else {
    if (rawImports.length) {
      console.log(
        `⛔ windows-hide: ${rawImports.length} direct child_process import(s) — route through ./lib/safe-spawn.mjs instead (windowsHide:true is forced there):`,
      );
      for (const v of rawImports) console.log(`   ${v.file}:${v.line}`);
    }
    if (shellNodeSpawns.length) {
      console.log(
        `⛔ windows-hide:  shell-resolved literal node spawn(s) — use process.execPath instead (window-storm root):`,
      );
      for (const v of shellNodeSpawns) console.log(`   ${v.file}:${v.line}`);
    }
    if (shellViolations.length) {
      console.log(
        `⛔ windows-hide: ${shellViolations.length} shell:true spawn(s) missing windowsHide:true — they pop a console window per call on Windows:`,
      );
      for (const v of shellViolations) console.log(`   ${v.file}:${v.line}`);
      console.log(
        "   Fix: add `windowsHide: true` to the spawn options object (§0 no-OS-window).",
      );
    }
  }
  process.exit(total === 0 ? 0 : 1);
}
