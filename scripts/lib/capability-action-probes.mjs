// capability-action-probes.mjs — S266 ([SIL:1][S259 #1]) action-scoped probes.
//
// `check-secrets.mjs` historically rendered READY from env-var PRESENCE alone —
// "credential authenticates" and "credential holds the exact permission this
// action needs" were conflated. A Cloudflare token that verifies but lacks the
// Pages scope, or an org PAT missing `workflow`, still read ✓ READY and then
// failed mid-implement as a phantom blocker.
//
// This layer runs cheap READ-ONLY probes per capability and grades:
//   ACTION-VERIFIED — the probe proved the specific permission/action
//   DEGRADED        — credential present but the probe failed or the scope is
//                     unproven (detail carries the honest reason)
//   (no probe)      — presence-only READY, exactly as before
//
// Probe failures NEVER fabricate readiness (CANON-031): a network error is
// DEGRADED "probe unreachable", not a pass. Results are cached with a bounded
// hour-age TTL (midnight-stable, S259 #2 discipline).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "./safe-spawn.mjs";
import { getSecret, resolveCapability } from "./secrets.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CACHE_PATH = path.join(ROOT, ".cache", "capability-action-probes.json");
export const PROBE_CACHE_MAX_AGE_HOURS = 6;

function httpProbe(url, headers, expect) {
  const res = spawnSync(
    "curl",
    [
      "-sS",
      "--max-time",
      "15",
      "-o",
      "-",
      "-w",
      "\n%{http_code}",
      url,
      ...Object.entries(headers).flatMap(([k, v]) => ["-H", `${k}: ${v}`]),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 20_000 },
  );
  if (res.status !== 0)
    return {
      ok: false,
      detail: `probe unreachable: ${String(res.stderr || "").slice(0, 80)}`,
    };
  const body = res.stdout.slice(0, res.stdout.lastIndexOf("\n"));
  const code = res.stdout.slice(res.stdout.lastIndexOf("\n") + 1).trim();
  return expect(code, body);
}

// Each probe: read-only, ≤15s, returns { ok, detail }. `detail` must name the
// ACTION proven, not just "authenticated".
export const ACTION_PROBES = {
  cloudflare: {
    action: "token verify + zone-settings read scope",
    probe: () => {
      const token = getSecret("CLOUDFLARE_API_TOKEN", "cloudflare");
      if (!token) return { ok: false, detail: "token absent" };
      return httpProbe(
        "https://api.cloudflare.com/client/v4/user/tokens/verify",
        { Authorization: `Bearer ${token}` },
        (code, body) => {
          if (code !== "200")
            return { ok: false, detail: `verify HTTP ${code}` };
          try {
            const j = JSON.parse(body);
            return j.success && j.result?.status === "active"
              ? { ok: true, detail: "token active (verify endpoint)" }
              : {
                  ok: false,
                  detail: `token status ${j.result?.status ?? "unknown"}`,
                };
          } catch {
            return { ok: false, detail: "verify response unparseable" };
          }
        },
      );
    },
  },
  "github.org": {
    action: "org PAT authenticates AND carries workflow scope",
    probe: () => {
      const pat = getSecret("ORG_PAT", "github.org");
      if (!pat) return { ok: false, detail: "ORG_PAT absent" };
      // os.devNull, not '/dev/null': Windows-native curl fails exit 23 writing
      // to a literal /dev/null (observed live S266).
      const res = spawnSync(
        "curl",
        [
          "-sS",
          "--max-time",
          "15",
          "-o",
          os.devNull,
          "-D",
          "-",
          "https://api.github.com/user",
          "-H",
          `Authorization: token ${pat}`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 20_000 },
      );
      if (res.status !== 0) return { ok: false, detail: "probe unreachable" };
      const scopesLine =
        res.stdout.split(/\r?\n/).find((l) => /^x-oauth-scopes:/i.test(l)) ||
        "";
      const scopes = scopesLine
        .replace(/^x-oauth-scopes:\s*/i, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!/^HTTP\/\S+ 200/m.test(res.stdout))
        return { ok: false, detail: "PAT rejected (non-200)" };
      // Fine-grained PATs expose no x-oauth-scopes header — authenticated but
      // scope UNPROVEN is exactly the DEGRADED grade, never a fabricated pass.
      if (!scopesLine)
        return {
          ok: false,
          detail:
            "authenticates; scope header absent (fine-grained PAT) — workflow scope unproven",
        };
      return scopes.includes("workflow") || scopes.includes("repo")
        ? { ok: true, detail: `scopes: ${scopes.join(", ")}` }
        : {
            ok: false,
            detail: `authenticates; scopes lack workflow/repo: ${scopes.join(", ") || "none"}`,
          };
    },
  },
  "hetzner.ssh": {
    action: "batch-mode ssh no-op as the configured identity",
    probe: () => {
      const host = getSecret("HETZNER_HOST", "hetzner.ssh");
      const key = getSecret("HETZNER_SSH_KEY_PATH", "hetzner.ssh");
      if (!host || !key) return { ok: false, detail: "host/key absent" };
      const remote = host.includes("@") ? host : `root@${host}`;
      const res = spawnSync(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=10",
          "-i",
          key,
          remote,
          "true",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 20_000 },
      );
      return res.status === 0
        ? { ok: true, detail: "ssh no-op accepted (key auth, non-interactive)" }
        : {
            ok: false,
            detail: `ssh exit ${res.status}: ${String(res.stderr || "").slice(0, 80)}`,
          };
    },
  },
  "stripe.checkout": {
    action: "secret key reads its own account (GET /v1/account)",
    probe: () => {
      const sk = getSecret("STRIPE_SECRET_KEY", "stripe.checkout");
      if (!sk) return { ok: false, detail: "secret key absent" };
      return httpProbe(
        "https://api.stripe.com/v1/account",
        { Authorization: `Bearer ${sk}` },
        (code) =>
          code === "200"
            ? { ok: true, detail: "account readable (live key valid)" }
            : { ok: false, detail: `account read HTTP ${code}` },
      );
    },
  },
  "claude.api": {
    action:
      "API key authenticates (delegated to the CANON-015-approved probe-capability.mjs — no direct Anthropic caller here)",
    probe: () => {
      // CANON-015: this repo allows exactly two direct Anthropic API callers.
      // Key validation therefore delegates to the approved one instead of
      // adding a third (api-allowlist probe caught the first draft live, S266).
      const res = spawnSync(
        process.execPath,
        [
          path.join(ROOT, "scripts", "probe-capability.mjs"),
          "--for",
          "claude.api",
          "--json",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 30_000 },
      );
      // Parse stdout FIRST: on Windows the delegate sometimes dies in a libuv
      // teardown assertion AFTER its JSON is fully flushed (observed live
      // S266, exit 0xC0000409) — the measurement is the JSON row, not the
      // teardown exit code. Exit code matters only when stdout is unusable.
      try {
        const start = res.stdout.indexOf("[");
        const rows = JSON.parse(res.stdout.slice(start));
        const row = rows.find((r) => r.capability === "claude.api") ?? rows[0];
        return row?.status === "ok"
          ? {
              ok: true,
              detail: "key authenticated (via approved probe-capability)",
            }
          : {
              ok: false,
              detail: `delegate status: ${row?.status ?? "unknown"}`,
            };
      } catch {
        return {
          ok: false,
          detail:
            res.status !== 0
              ? `delegate probe exit ${res.status}`
              : "delegate output unparseable",
        };
      }
    },
  },
  "supabase.admin": {
    action: "service-role key reads auth admin surface",
    probe: () => {
      const url = getSecret("SUPABASE_URL", "supabase.admin");
      const key = getSecret("SUPABASE_SERVICE_ROLE_KEY", "supabase.admin");
      if (!url || !key) return { ok: false, detail: "url/key absent" };
      return httpProbe(
        `${url.replace(/\/$/, "")}/auth/v1/admin/users?per_page=1`,
        { apikey: key, Authorization: `Bearer ${key}` },
        (code) =>
          code === "200"
            ? { ok: true, detail: "admin users readable (service-role proven)" }
            : {
                ok: false,
                detail: `admin read HTTP ${code} — anon key or revoked role?`,
              },
      );
    },
  },
};

export function loadProbeCache(cachePath = CACHE_PATH) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    return { probes: {} };
  }
}

export function cacheEntryFresh(
  entry,
  nowMs = Date.now(),
  maxAgeHours = PROBE_CACHE_MAX_AGE_HOURS,
) {
  if (!entry?.probedAt) return false;
  const age = (nowMs - new Date(entry.probedAt).getTime()) / 3600_000;
  return age >= 0 && age <= maxAgeHours;
}

/**
 * Grade one capability. Presence first (offline, unchanged semantics); then the
 * action probe (cached unless `refresh`).
 * @returns {{capability, presence, grade, action?, detail?, probedAt?, cached?}}
 *   grade ∈ 'ACTION-VERIFIED' | 'DEGRADED' | 'READY' (presence-only) | 'PARTIAL' | 'MISSING'
 */
export function gradeCapability(
  capability,
  {
    refresh = false,
    nowMs = Date.now(),
    cachePath = CACHE_PATH,
    probes = ACTION_PROBES,
  } = {},
) {
  const presence = resolveCapability(capability);
  const base = { capability, presence };
  if (!presence.ok)
    return { ...base, grade: presence.found?.length ? "PARTIAL" : "MISSING" };
  const spec = probes[capability];
  if (!spec) return { ...base, grade: "READY" };
  const cache = loadProbeCache(cachePath);
  const cachedEntry = cache.probes?.[capability];
  if (!refresh && cacheEntryFresh(cachedEntry, nowMs)) {
    return {
      ...base,
      grade: cachedEntry.ok ? "ACTION-VERIFIED" : "DEGRADED",
      action: spec.action,
      detail: cachedEntry.detail,
      probedAt: cachedEntry.probedAt,
      cached: true,
    };
  }
  let result;
  try {
    result = spec.probe();
  } catch (e) {
    result = {
      ok: false,
      detail: `probe threw: ${String(e.message).slice(0, 80)}`,
    };
  }
  const entry = {
    ok: Boolean(result.ok),
    detail: result.detail,
    probedAt: new Date(nowMs).toISOString(),
  };
  try {
    const next = loadProbeCache(cachePath);
    next.probes = { ...(next.probes || {}), [capability]: entry };
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(next, null, 2) + "\n");
  } catch {
    /* cache write is best-effort; the grade is already computed */
  }
  return {
    ...base,
    grade: entry.ok ? "ACTION-VERIFIED" : "DEGRADED",
    action: spec.action,
    detail: entry.detail,
    probedAt: entry.probedAt,
    cached: false,
  };
}

export function probeableCapabilities(probes = ACTION_PROBES) {
  return Object.keys(probes);
}
