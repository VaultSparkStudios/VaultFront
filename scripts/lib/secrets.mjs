/**
 * secrets.mjs — Studio Ops secrets gateway (v3.1)
 *
 * Single API for agents to read secrets from `secrets/*.env`.
 * Every access is audited to `secrets/.access.log` (gitignored).
 * Raw values are scrubbable from any downstream log via `redact()`.
 *
 * Agents MUST use this module rather than reading `secrets/*.env` directly.
 * AGENTS.md v3.1 rule: before labeling any item "Human Action Required",
 * call `resolveCapability(capability)` — if all required keys are present,
 * proceed autonomously.
 *
 * Usage:
 *   import { getSecret, resolveCapability, redact } from './lib/secrets.mjs';
 *
 *   const apiKey = getSecret('ANTHROPIC_API_KEY', 'claude.api');
 *   const { ok, missing } = resolveCapability('stripe.checkout');
 *   console.log(redact(`Key is ${apiKey}`));  // "Key is ****"
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
// Tests can redirect lookups with VAULTSPARK_SECRETS_DIR_OVERRIDE (see
// scripts/test/lib/credential-mocks.mjs). Production code never sets this.
const SECRETS_DIR =
  process.env.VAULTSPARK_SECRETS_DIR_OVERRIDE ||
  path.join(REPO_ROOT, "secrets");
// Sibling Studio Ops secrets dir — per AGENTS.md, all Studio credentials live here.
// Walk parents (up to 6 levels) so this script works whether it's running in
// studio-ops itself, a sibling project repo, or a worktree.
// Local `<repo>/secrets/` still wins when both define the same key (project override).
function findStudioOpsSecretsDir() {
  if (process.env.STUDIO_OPS_SECRETS_DIR)
    return process.env.STUDIO_OPS_SECRETS_DIR;
  let dir = REPO_ROOT;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "vaultspark-studio-ops", "secrets");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const STUDIO_OPS_SECRETS_DIR = findStudioOpsSecretsDir();
const LOCAL_CAP_MAP_PATH = path.join(SECRETS_DIR, "CAPABILITY_MAP.json");
const STUDIO_OPS_CAP_MAP_PATH = STUDIO_OPS_SECRETS_DIR
  ? path.join(STUDIO_OPS_SECRETS_DIR, "CAPABILITY_MAP.json")
  : null;
const ACCESS_LOG = path.join(SECRETS_DIR, ".access.log");

let _cache = null; // flat merged env
let _cacheStamp = 0;
let _capMap = null;
let _redactList = new Set();

/**
 * Load and merge every `secrets/*.env` file into a flat key→value map.
 * Cached for 60s to avoid repeated disk reads across a single session.
 */
function loadEnv() {
  const now = Date.now();
  if (_cache && now - _cacheStamp < 60_000) return _cache;

  const merged = {};

  // Read in low → high precedence so later dirs override.
  // Studio Ops sibling secrets dir → local repo secrets dir.
  // De-dupe so studio-ops doesn't read itself twice when run from its own repo.
  const dirSet = new Set();
  for (const d of [STUDIO_OPS_SECRETS_DIR, SECRETS_DIR]) {
    if (d && fs.existsSync(d)) dirSet.add(path.resolve(d));
  }
  if (dirSet.size === 0) {
    _cache = merged;
    _cacheStamp = now;
    return merged;
  }

  for (const dir of dirSet) {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".env") && !f.startsWith("."));
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (val && val !== "REPLACE_ME" && !val.startsWith("REPLACE_ME")) {
          merged[key] = val;
          if (val.length >= 8) _redactList.add(val);
        }
      }
    }
  }

  _cache = merged;
  _cacheStamp = now;
  return merged;
}

function readCapabilityMapLayer(filePath, layer) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { layer, path: filePath, state: "absent", value: null };
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !value.capabilities ||
      typeof value.capabilities !== "object" ||
      Array.isArray(value.capabilities)
    ) {
      throw new Error("root must contain an object-valued capabilities field");
    }
    return { layer, path: filePath, state: "loaded", value };
  } catch (e) {
    const msg =
      `${layer} CAPABILITY_MAP.json is present but UNPARSEABLE (${e.message}). ` +
      `Capability resolution cannot continue until this authority is repaired. ` +
      `Common cause: smart quotes (U+201C/U+201D) or encoding mojibake from a paste.`;
    const error = new Error(msg, { cause: e });
    error.code = "CAPABILITY_MAP_CORRUPT";
    error.layer = layer;
    error.capabilityMapPath = filePath;
    throw error;
  }
}

/**
 * Load the canonical Studio Ops capability catalog, then overlay project-local
 * definitions by capability. This is intentionally read-only composition:
 * project repos consume the sibling authority without copying or mutating it.
 */
export function loadCapabilityMapLayers({
  basePath = STUDIO_OPS_CAP_MAP_PATH,
  overridePath = LOCAL_CAP_MAP_PATH,
} = {}) {
  const resolvedBase = basePath ? path.resolve(basePath) : null;
  const resolvedOverride = overridePath ? path.resolve(overridePath) : null;
  const base = readCapabilityMapLayer(resolvedBase, "studio-ops");
  const override =
    resolvedOverride && resolvedOverride === resolvedBase
      ? {
          layer: "project-local",
          path: resolvedOverride,
          state: "deduplicated",
          value: null,
        }
      : readCapabilityMapLayer(resolvedOverride, "project-local");
  const baseValue = base.value ?? {};
  const overrideValue = override.value ?? {};
  return {
    ...baseValue,
    ...overrideValue,
    credentialOwnership: {
      ...(baseValue.credentialOwnership ?? {}),
      ...(overrideValue.credentialOwnership ?? {}),
    },
    capabilities: {
      ...(baseValue.capabilities ?? {}),
      ...(overrideValue.capabilities ?? {}),
    },
    _authority: {
      base: { path: base.path, state: base.state },
      override: { path: override.path, state: override.state },
    },
  };
}

function loadCapMap() {
  if (_capMap) return _capMap;
  try {
    _capMap = loadCapabilityMapLayers();
    return _capMap;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      process.stderr.write(`⚠ secrets: ${message}\n`);
    } catch {
      /* stream closed */
    }
    try {
      audit({
        event: "capability-map-corrupt",
        layer: e?.layer ?? "unknown",
        error: message,
      });
    } catch {
      /* never hide the authority failure */
    }
    throw e;
  }
}

function audit(entry) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      agent: process.env.CLAUDE_AGENT_ID || process.env.USER || "unknown",
      ...entry,
    });
    fs.mkdirSync(SECRETS_DIR, { recursive: true });
    fs.appendFileSync(ACCESS_LOG, line + "\n");
  } catch {
    /* auditing never breaks callers */
  }
}

/**
 * Return the value of a secret key, or `null` if missing.
 * Resolution order: process.env → secrets/*.env → Anthropic Credential Vault (if configured).
 * `capability` is a free-form string for auditing (e.g. "claude.api").
 */
export function getSecret(key, capability = "unspecified") {
  // Deterministic test seam (S210). When STUDIO_OPS_TEST_NO_SECRETS is explicitly set,
  // the gateway behaves as if NO credential is vaulted — so credential-gated branches
  // (fallback / early-bail / offline paths) can be exercised the SAME way on a
  // credentialed founder host and in credential-less CI. Without this, tests that
  // `delete process.env.X` to force a fallback are silently host-dependent, because
  // getSecret reads from secrets/*.env, not process.env (see
  // tier1-gateway-credential-test-honesty). Production never sets this flag.
  if (/^(1|true|yes|on)$/i.test(process.env.STUDIO_OPS_TEST_NO_SECRETS || "")) {
    audit({ key, capability, result: "TEST_NO_SECRETS" });
    return null;
  }
  const env = loadEnv();
  const val = env[key] ?? process.env[key] ?? null;
  audit({ key, capability, result: val ? "FOUND" : "MISSING" });
  return val;
}

/**
 * Resolve a secret, falling back to the Anthropic Credential Vault if not found locally.
 * Vault is only consulted for MCP-related capabilities (sentry.mcp, google.calendar, etc.)
 * when ANTHROPIC_VAULT_ID is set in secrets/anthropic.env.
 * Returns { value, source: 'env'|'vault'|null }.
 */
export async function getSecretWithVaultFallback(
  key,
  capability = "unspecified",
) {
  const local = getSecret(key, capability);
  if (local) return { value: local, source: "env" };

  // Only attempt vault lookup for MCP capabilities
  const map = loadCapMap();
  const capDef = map.capabilities?.[capability] ?? {};
  if (!capDef.vault) return { value: null, source: null };

  const vaultId =
    loadEnv()["ANTHROPIC_VAULT_ID"] ?? process.env.ANTHROPIC_VAULT_ID;
  const apiKey =
    loadEnv()["ANTHROPIC_API_KEY"] ?? process.env.ANTHROPIC_API_KEY;
  if (!vaultId || !apiKey) return { value: null, source: null };

  try {
    // Lazy import to avoid loading vault-client when not needed
    const { VaultClient } = await import("./vault-client.mjs");
    const vault = new VaultClient(apiKey);
    const creds = await vault.listCredentials(vaultId);
    const match = creds.find(
      (c) => c.display_name === key || c.display_name === capability,
    );
    if (match) {
      audit({ key, capability, result: "VAULT_HIT", credentialId: match.id });
      return { value: match.id, source: "vault" };
    }
  } catch {
    /* vault unavailable — not an error */
  }

  return { value: null, source: null };
}

/**
 * Check whether all env vars required for a capability are present.
 * @param {string} capability - e.g. "stripe.checkout"
 * @returns {{ok: boolean, required: string[], missing: string[], found: string[]}}
 */
export function resolveCapability(capability) {
  const map = loadCapMap();
  const required = map.capabilities?.[capability]?.env || [];
  const env = loadEnv();
  const missing = [];
  const found = [];
  for (const k of required) {
    if (env[k] || process.env[k]) found.push(k);
    else missing.push(k);
  }
  const ok = required.length > 0 && missing.length === 0;
  audit({ capability, action: "resolveCapability", ok, missing });
  return { ok, required, missing, found };
}

/**
 * List all known capabilities and their readiness.
 */
export function listCapabilities() {
  const map = loadCapMap();
  const caps = Object.keys(map.capabilities || {}).sort();
  return caps.map((c) => ({ capability: c, ...resolveCapability(c) }));
}

/**
 * Redact all known secret values from a string before logging.
 * Call on any text that might contain secrets before emitting to stdout/stderr/file.
 */
export function redact(text) {
  if (!text || typeof text !== "string") return text;
  loadEnv(); // populate _redactList
  let out = text;
  for (const val of _redactList) {
    if (val && val.length >= 8) {
      out = out.split(val).join("****");
    }
  }
  return out;
}

/**
 * Returns a child of `process.env` augmented with secrets — for passing to
 * `spawnSync({ env: ... })` without polluting the parent process env.
 */
export function envForSpawn(capability = "spawn", extraKeys = []) {
  const env = loadEnv();
  const out = { ...process.env };
  // Merge all capability keys if cap map known, or caller-provided extras
  const map = loadCapMap();
  const req = [...(map.capabilities?.[capability]?.env || []), ...extraKeys];
  for (const k of req) {
    if (env[k]) out[k] = env[k];
  }
  audit({ capability, action: "envForSpawn", keys: req });
  return out;
}
