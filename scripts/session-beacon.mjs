#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DEFAULT_LEASE_SECONDS,
  findLease,
  gistTransport,
  mergeLease,
  readBeaconEnv,
  readSessionLock,
  releaseLease,
  updateWithVerification,
} from "./lib/session-beacon.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("-")) || "list";
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const jsonMode = args.includes("--json");
const requireClear = args.includes("--require-clear");
const bestEffort = args.includes("--best-effort");
const env = readBeaconEnv(ROOT);
const lock = readSessionLock(ROOT);
const gistId =
  valueAfter("--gist-id") || process.env.BEACON_GIST_ID || env.BEACON_GIST_ID;
const project =
  valueAfter("--project") ||
  process.env.BEACON_PROJECT_ID ||
  env.BEACON_PROJECT_ID ||
  lock.project ||
  path.basename(ROOT);
const sessionId =
  valueAfter("--session-id") ||
  lock.session_start ||
  process.env.STUDIO_SESSION_ID ||
  randomUUID();
const ttlSeconds = Number(valueAfter("--ttl-seconds") || DEFAULT_LEASE_SECONDS);
const now = new Date();

function finish(payload, code = 0) {
  if (jsonMode) console.log(JSON.stringify(payload, null, 2));
  else console.log(payload.detail || payload.status || JSON.stringify(payload));
  process.exitCode = bestEffort ? 0 : code;
}

if (!gistId) {
  finish(
    {
      ok: false,
      status: "unconfigured",
      detail: "Session beacon unconfigured: BEACON_GIST_ID missing.",
    },
    requireClear ? 3 : 1,
  );
} else {
  const transport = gistTransport({ gistId, root: ROOT });
  if (command === "list") {
    try {
      const document = transport.read();
      finish({ ok: true, status: "listed", active: document.active });
    } catch (error) {
      finish({ ok: false, status: "unavailable", detail: error.message }, 3);
    }
  } else if (command === "check") {
    try {
      const document = transport.read();
      const lease = findLease(document, project, now);
      if (lease)
        finish(
          {
            ok: false,
            status: "occupied",
            project,
            lease,
            detail: `DENY scheduled write: ${project} has an active ${lease.agent || "agent"} lease.`,
          },
          2,
        );
      else
        finish({
          ok: true,
          status: "clear",
          project,
          detail: `ALLOW: ${project} has no active lease.`,
        });
    } catch (error) {
      finish(
        {
          ok: false,
          status: "unavailable",
          detail: `DENY: session beacon unavailable (${error.message}).`,
        },
        requireClear ? 3 : 1,
      );
    }
  } else if (command === "acquire") {
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const lease = {
      project,
      agent: valueAfter("--agent") || lock.agent || "other",
      trigger: valueAfter("--trigger") || lock.trigger || "ad-hoc",
      sessionId,
      since: lock.session_start || now.toISOString(),
      expiresAt,
    };
    const result = updateWithVerification({
      transport,
      mutate: (document) => mergeLease(document, lease, now),
      verify: (document) => {
        const observed = findLease(document, project, now);
        return observed?.sessionId === sessionId;
      },
    });
    if (result.ok)
      finish({
        ok: true,
        status: "acquired",
        lease,
        attempts: result.attempts,
        detail: `Session lease acquired for ${project} until ${expiresAt}.`,
      });
    else if (result.conflict)
      finish(
        {
          ok: false,
          status: "conflict",
          conflict: result.conflict,
          detail: `DENY: ${project} already has an active lease.`,
        },
        2,
      );
    else
      finish(
        {
          ok: false,
          status: "unavailable",
          detail: `Session lease unavailable: ${result.error}`,
        },
        3,
      );
  } else if (command === "release") {
    const result = updateWithVerification({
      transport,
      mutate: (document) => releaseLease(document, { project, sessionId }, now),
      verify: (document) => {
        const observed = findLease(document, project, now);
        return !observed || observed.sessionId !== sessionId;
      },
    });
    if (result.ok)
      finish({
        ok: true,
        status: "released",
        project,
        sessionId,
        detail: `Session lease released for ${project}.`,
      });
    else
      finish(
        {
          ok: false,
          status: "unavailable",
          detail: `Session lease release failed: ${result.error}`,
        },
        3,
      );
  } else {
    finish(
      {
        ok: false,
        status: "usage",
        detail:
          "Usage: session-beacon.mjs acquire|release|check|list [--project slug] [--require-clear] [--best-effort] [--json]",
      },
      64,
    );
  }
}
