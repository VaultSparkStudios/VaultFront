#!/usr/bin/env node
/**
 * scan-secrets.mjs — credential leak scanner (S79)
 *
 * Pre-commit / pre-push scanner. Pattern + entropy heuristics with allowlist.
 * Invoked by the `/scan-secrets` skill and closeout autopilot.
 *
 * Exit codes:
 *   0 — clean
 *   1 — findings detected (block push)
 *   2 — scanner error
 *
 * Usage:
 *   node scripts/scan-secrets.mjs --staged          # git diff --cached (default)
 *   node scripts/scan-secrets.mjs --all             # full working tree scan
 *   node scripts/scan-secrets.mjs <path>            # scan specific file/dir
 *   node scripts/scan-secrets.mjs --json            # machine-readable output
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "./lib/safe-spawn.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const MODE_STAGED =
  args.includes("--staged") ||
  (!args.includes("--all") && !args.find((a) => !a.startsWith("--")));
const MODE_ALL = args.includes("--all");
const MODE_JSON = args.includes("--json");
const pathArg = args.find((a) => !a.startsWith("--"));

// ── Patterns ───────────────────────────────────────────────────────────────
// Each pattern: { name, regex, confidence, type }
const PATTERNS = [
  {
    name: "AWS Access Key",
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    confidence: "high",
    type: "aws",
  },
  {
    name: "AWS Secret Key",
    regex: /\b[A-Za-z0-9+/]{40}\b/,
    confidence: "low",
    type: "aws-maybe",
    needsEntropy: true,
  },
  {
    name: "GitHub Personal Token",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/,
    confidence: "high",
    type: "github",
  },
  {
    name: "GitHub App Token",
    regex: /\bghs_[A-Za-z0-9_]{36,}\b/,
    confidence: "high",
    type: "github",
  },
  {
    name: "Anthropic API Key",
    regex: /\bsk-ant-[a-z0-9]+-[A-Za-z0-9_-]{40,}\b/,
    confidence: "high",
    type: "anthropic",
  },
  {
    name: "OpenAI API Key",
    regex: /\bsk-[A-Za-z0-9]{48}\b/,
    confidence: "high",
    type: "openai",
  },
  {
    name: "Stripe Live Secret",
    regex: /\b(sk|rk)_live_[A-Za-z0-9]{24,}\b/,
    confidence: "high",
    type: "stripe",
  },
  {
    name: "Stripe Test Secret",
    regex: /\b(sk|rk)_test_[A-Za-z0-9]{24,}\b/,
    confidence: "medium",
    type: "stripe-test",
  },
  {
    name: "Private Key Header",
    regex: /-----BEGIN (RSA |OPENSSH |EC |PGP )?PRIVATE KEY-----/,
    confidence: "high",
    type: "pem",
  },
  {
    name: "Google API Key",
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/,
    confidence: "high",
    type: "google",
  },
  {
    name: "Slack Bot Token",
    regex: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/,
    confidence: "high",
    type: "slack",
  },
  {
    name: "Supabase Service Role",
    regex:
      /\beyJhbGciOiJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{100,}\.[A-Za-z0-9_-]{20,}\b/,
    confidence: "high",
    type: "jwt-supabase",
  },
  {
    name: "Generic Token Field",
    regex:
      /(password|secret|token|api[_-]?key)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{32,}["']/i,
    confidence: "medium",
    type: "generic",
    needsEntropy: true,
  },
  {
    name: "Cloudflare API Token",
    regex: /\b[A-Za-z0-9_-]{40}\b/,
    confidence: "low",
    type: "cf-maybe",
    needsEntropy: true,
  },
];

// ── Allowlist rules ────────────────────────────────────────────────────────
const ALLOWLIST_PATHS = [
  /^secrets\//,
  /^\.ops-cache\//,
  /^portfolio\/ACCESS_LEDGER\.ndjson$/,
  /\.template\.(ts|tsx|js|mjs|json|md|yml|yaml|env)$/,
  /\.example\.(ts|tsx|js|mjs|json|md|yml|yaml|env)$/,
  /^docs\/templates\//,
  /^node_modules\//,
  /^\.git\//,
  /\/fixtures\//,
  // This scanner file itself contains regex literals that match patterns.
  /^scripts\/scan-secrets\.mjs$/,
];

const ALLOWLIST_COMMENT = /#\s*scan-secrets:\s*allow/i;

// ── Entropy calculation ────────────────────────────────────────────────────
function shannonEntropy(s) {
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let e = 0;
  const len = s.length;
  for (const k of Object.keys(freq)) {
    const p = freq[k] / len;
    e -= p * Math.log2(p);
  }
  return e;
}

const ENTROPY_THRESHOLD = 4.3; // typical random tokens score > 4.3

// ── Redaction ──────────────────────────────────────────────────────────────
function redact(value) {
  if (!value || value.length <= 12) return "***";
  return (
    value.slice(0, 4) +
    "*".repeat(Math.min(value.length - 8, 20)) +
    value.slice(-4)
  );
}

// ── File scanning ──────────────────────────────────────────────────────────
function isAllowlistedPath(relPath) {
  return ALLOWLIST_PATHS.some((rx) => rx.test(relPath));
}

const GENERATED_STATIC_PATH_RE = /^static\//u;
const BASE64_FLAG_PATH_RE = /^resources\/flags\/.*\.svg$/iu;
const COSMETIC_KEY_PATH_RE = /^resources\/cosmetics\/cosmetics\.json$/iu;

/** Suppress entropy-only token shapes only when the surrounding bytes prove asset provenance. */
export function isAssetEntropyNoise(relPath, line, pattern) {
  if (pattern?.confidence !== "low" || !pattern?.needsEntropy) return false;
  const normalized = relPath.replaceAll("\\", "/");
  if (GENERATED_STATIC_PATH_RE.test(normalized)) return true;
  if (
    BASE64_FLAG_PATH_RE.test(normalized) &&
    /data:image\/[a-z0-9.+-]+;base64,/iu.test(line)
  ) {
    return true;
  }
  return (
    COSMETIC_KEY_PATH_RE.test(normalized) &&
    /^\s*"[A-Za-z0-9+/_=-]{32,}"\s*:/u.test(line)
  );
}

export function summarizeFindings(findings) {
  return findings.reduce(
    (summary, finding) => {
      summary[finding.confidence] = (summary[finding.confidence] ?? 0) + 1;
      return summary;
    },
    { high: 0, medium: 0, low: 0 },
  );
}

export function scanContent(relPath, content) {
  if (!content) return [];
  const findings = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Comment-based allowlist: check current line + prior line
    const allowComment =
      ALLOWLIST_COMMENT.test(line) ||
      (i > 0 && ALLOWLIST_COMMENT.test(lines[i - 1]));
    if (allowComment) continue;

    // npm SRI values are public package-integrity metadata, not credentials.
    // Exempt only the exact lockfile integrity field so URLs and arbitrary
    // package metadata remain scanned.
    const packageIntegrityLine =
      relPath === "package-lock.json" &&
      /^\s*"integrity":\s*"sha(?:1|256|384|512)-[A-Za-z0-9+/=]+",?\s*$/u.test(
        line,
      );
    if (packageIntegrityLine) continue;

    for (const pat of PATTERNS) {
      const match = line.match(pat.regex);
      if (!match) continue;

      const matched = match[0];

      if (isAssetEntropyNoise(relPath, line, pat)) continue;

      // Entropy gate for low-confidence patterns
      if (pat.needsEntropy) {
        const candidate = matched
          .replace(/^[^A-Za-z0-9]*/, "")
          .replace(/[^A-Za-z0-9]*$/, "");
        if (candidate.length < 32) continue;
        const e = shannonEntropy(candidate);
        if (e < ENTROPY_THRESHOLD) continue;
      }

      findings.push({
        file: relPath,
        line: i + 1,
        pattern: pat.name,
        type: pat.type,
        confidence: pat.confidence,
        redactedMatch: redact(matched),
        snippet:
          line.length > 120 ? line.slice(0, 60) + "…" + line.slice(-40) : line,
      });
    }
  }
  return findings;
}

// ── Git-based staged scan ──────────────────────────────────────────────────
function gitStagedFiles() {
  const r = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  if (r.status !== 0) return [];
  return r.stdout.split("\n").filter(Boolean);
}

function gitStagedContent(file) {
  const r = spawnSync("git", ["show", `:${file}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return r.stdout;
}

// ── Working-tree scan ──────────────────────────────────────────────────────
function walkFiles(dir, base = "", out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (
      e.name.startsWith(".") &&
      e.name !== ".gitignore" &&
      e.name !== ".env.example"
    )
      continue;
    if (e.isDirectory()) {
      if (
        e.name === "node_modules" ||
        e.name === ".git" ||
        e.name === "secrets" ||
        e.name === ".ops-cache"
      )
        continue;
      walkFiles(path.join(dir, e.name), rel, out);
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────
function run() {
  let findings = [];

  try {
    let files;
    if (MODE_ALL) {
      files = walkFiles(pathArg ? path.resolve(ROOT, pathArg) : ROOT);
    } else if (pathArg) {
      const target = path.resolve(ROOT, pathArg);
      if (fs.statSync(target).isDirectory()) {
        files = walkFiles(target);
      } else {
        files = [path.relative(ROOT, target)];
      }
    } else {
      files = gitStagedFiles();
    }

    for (const file of files) {
      if (isAllowlistedPath(file)) continue;

      let content;
      if (MODE_STAGED && !MODE_ALL && !pathArg) {
        content = gitStagedContent(file);
      } else {
        try {
          const full = path.resolve(ROOT, file);
          const stat = fs.statSync(full);
          if (stat.size > 8 * 1024 * 1024) continue; // skip huge files
          content = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
      }

      findings.push(...scanContent(file, content || ""));
    }

    // De-duplicate: same file+line+type only once
    const seen = new Set();
    findings = findings.filter((f) => {
      const k = `${f.file}:${f.line}:${f.type}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Append to access ledger
    try {
      const ledgerPath = path.join(ROOT, "portfolio", "ACCESS_LEDGER.ndjson");
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.appendFileSync(
        ledgerPath,
        JSON.stringify({
          type: "scan",
          ts: new Date().toISOString(),
          scope: MODE_ALL ? "all" : pathArg || "staged",
          findingCount: findings.length,
          cleanedBeforePush: findings.length === 0,
        }) + "\n",
      );
    } catch {}

    if (MODE_JSON) {
      process.stdout.write(
        JSON.stringify(
          {
            findings,
            count: findings.length,
            byConfidence: summarizeFindings(findings),
          },
          null,
          2,
        ),
      );
      process.exit(findings.length ? 1 : 0);
    }

    // Human-readable output
    const scope = MODE_ALL
      ? "working tree"
      : pathArg
        ? `path: ${pathArg}`
        : "staged changes";
    const banner = "╔" + "═".repeat(66) + "╗";
    const line = "║ " + "SECRETS SCAN".padEnd(64) + " ║";
    const scopeL = "║ " + `scope: ${scope}`.padEnd(64) + " ║";
    process.stdout.write([banner, line, scopeL, banner].join("\n") + "\n");

    if (findings.length === 0) {
      process.stdout.write("✓ Clean — 0 findings\n");
      process.exit(0);
    }

    process.stdout.write(`⛔ ${findings.length} finding(s):\n\n`);
    for (const f of findings) {
      process.stdout.write(
        `  ${f.file}:${f.line}  [${f.confidence}]  ${f.pattern}\n`,
      );
      process.stdout.write(`    match: ${f.redactedMatch}\n`);
      process.stdout.write(`    line:  ${f.snippet.trim().slice(0, 120)}\n\n`);
    }
    process.stdout.write("Remediation:\n");
    process.stdout.write("  1. Rotate the credential at the source\n");
    process.stdout.write("  2. git rm --cached <file> and add to .gitignore\n");
    process.stdout.write(
      "  3. If high-confidence + already pushed: rewrite history (git filter-repo)\n",
    );
    process.stdout.write(
      "  4. Allowlist intentional matches with  # scan-secrets: allow\n",
    );
    process.exit(1);
  } catch (err) {
    process.stderr.write(`scan-secrets error: ${err.message}\n`);
    process.exit(2);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) run();
