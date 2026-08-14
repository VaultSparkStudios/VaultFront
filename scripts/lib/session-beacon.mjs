import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "./safe-spawn.mjs";

export const DEFAULT_LEASE_SECONDS = 8 * 60 * 60;

export function parseBeaconDocument(text) {
  const source = String(text || "").trim();
  if (!source) return { active: [] };
  const start = source.indexOf("{");
  if (start < 0) return { active: [] };
  const parsed = JSON.parse(source.slice(start));
  return { active: Array.isArray(parsed?.active) ? parsed.active : [] };
}

export function pruneExpired(entries, now = new Date()) {
  const nowMs = now.getTime();
  return (entries || []).filter((entry) => {
    const expiry = Date.parse(entry?.expiresAt || "");
    if (Number.isFinite(expiry)) return expiry > nowMs;
    const since = Date.parse(entry?.since || "");
    return (
      Number.isFinite(since) && since + DEFAULT_LEASE_SECONDS * 1000 > nowMs
    );
  });
}

export function mergeLease(document, lease, now = new Date()) {
  const active = pruneExpired(document?.active, now);
  const conflict = active.find(
    (entry) =>
      entry.project === lease.project && entry.sessionId !== lease.sessionId,
  );
  if (conflict) return { ok: false, conflict, document: { active } };
  const withoutSelf = active.filter(
    (entry) =>
      !(entry.project === lease.project && entry.sessionId === lease.sessionId),
  );
  return {
    ok: true,
    document: {
      active: [...withoutSelf, lease].sort((a, b) =>
        String(a.project).localeCompare(String(b.project)),
      ),
    },
  };
}

export function releaseLease(
  document,
  { project, sessionId },
  now = new Date(),
) {
  const active = pruneExpired(document?.active, now);
  const next = active.filter((entry) => {
    if (entry.project !== project) return true;
    if (!sessionId) return false;
    return entry.sessionId !== sessionId;
  });
  return { active: next };
}

export function findLease(document, project, now = new Date()) {
  return (
    pruneExpired(document?.active, now).find(
      (entry) => entry.project === project,
    ) || null
  );
}

export function readBeaconEnv(root) {
  const file = path.join(root, ".claude", "beacon.env");
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

export function readSessionLock(root) {
  const file = path.join(root, "context", ".session-lock");
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

export function gistTransport({
  gistId,
  root,
  spawn = spawnSync,
  filename = "beacon-active.json",
}) {
  return {
    read() {
      const result = spawn(
        "gh",
        ["gist", "view", gistId, "--raw", "--filename", filename],
        {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          timeout: 20_000,
        },
      );
      if (result.status !== 0)
        throw new Error(`beacon read failed (${result.status ?? "unknown"})`);
      return parseBeaconDocument(result.stdout);
    },
    write(document) {
      const cacheDir = path.join(root, ".cache");
      const local = path.join(cacheDir, `active-${process.pid}.json`);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(local, JSON.stringify(document, null, 2) + "\n");
      try {
        const result = spawn(
          "gh",
          ["gist", "edit", gistId, "--filename", filename, local],
          {
            cwd: root,
            encoding: "utf8",
            windowsHide: true,
            timeout: 20_000,
          },
        );
        if (result.status !== 0)
          throw new Error(
            `beacon write failed (${result.status ?? "unknown"})`,
          );
      } finally {
        try {
          fs.unlinkSync(local);
        } catch {}
      }
    },
  };
}

export function updateWithVerification({
  transport,
  mutate,
  verify,
  attempts = 3,
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const current = transport.read();
      const mutation = mutate(current);
      if (mutation?.ok === false) return mutation;
      const document = mutation?.document || mutation;
      transport.write(document);
      const observed = transport.read();
      if (verify(observed))
        return { ok: true, document: observed, attempts: attempt };
      lastError = new Error("beacon verification lost a concurrent update");
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, error: lastError?.message || "beacon update failed" };
}
