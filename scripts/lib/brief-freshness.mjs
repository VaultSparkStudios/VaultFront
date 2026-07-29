import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractSessionNumbers } from "./session-chronology.mjs";

export const BRIEF_SOURCE_SCHEMA = 2;
export const BRIEF_SOURCE_FILES = Object.freeze([
  "context/PROJECT_STATUS.json",
  "context/TASK_BOARD.md",
  "context/LATEST_HANDOFF.md",
  "context/SELF_IMPROVEMENT_LOOP.md",
  "context/TRUTH_AUDIT.md",
  "context/CURRENT_STATE.md",
  "docs/GENIUS_LIST.md",
  "docs/SESSION_PLAN.md",
  "docs/CREATIVE_DIRECTION_RECORD.md",
]);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readRequired(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readTracked(root, relativePath) {
  const target = path.join(root, relativePath);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "<missing>";
}

function sessionNumbers(source) {
  return extractSessionNumbers(source);
}

export function buildBriefSourceManifest(root) {
  const sources = Object.fromEntries(
    BRIEF_SOURCE_FILES.map((relativePath) => {
      const body = readTracked(root, relativePath);
      return [relativePath, digest(body)];
    }),
  );
  const status = JSON.parse(readRequired(root, "context/PROJECT_STATUS.json"));
  const sessions = [Number(status.currentSession) || 0];
  for (const relativePath of [
    "context/TASK_BOARD.md",
    "context/LATEST_HANDOFF.md",
    "context/SELF_IMPROVEMENT_LOOP.md",
  ]) {
    sessions.push(...sessionNumbers(readRequired(root, relativePath)));
  }
  return {
    schema: BRIEF_SOURCE_SCHEMA,
    session: Math.max(...sessions),
    sources,
  };
}

export function parseBriefSourceManifest(brief) {
  const match = String(brief).match(
    /<!--\s*brief-sources:\s*(\{[^\n]+\})\s*-->/,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return { invalid: true };
  }
}

export function evaluateBriefSourceFreshness(root, brief) {
  const embedded = parseBriefSourceManifest(brief);
  if (!embedded) {
    return { fresh: false, reason: "brief source manifest missing" };
  }
  if (embedded.invalid || embedded.schema !== BRIEF_SOURCE_SCHEMA) {
    return {
      fresh: false,
      reason: "brief source manifest invalid or unsupported",
    };
  }
  let current;
  try {
    current = buildBriefSourceManifest(root);
  } catch (error) {
    return {
      fresh: false,
      reason: `brief source read failed: ${error.message}`,
    };
  }
  if (embedded.session !== current.session) {
    return {
      fresh: false,
      reason: `source session drift: brief S${embedded.session}, current S${current.session}`,
    };
  }
  const changed = BRIEF_SOURCE_FILES.filter(
    (relativePath) =>
      embedded.sources?.[relativePath] !== current.sources[relativePath],
  );
  if (changed.length > 0) {
    return {
      fresh: false,
      reason: `source hash drift: ${changed.join(", ")}`,
      changed,
    };
  }
  return { fresh: true, reason: "source-coherent", manifest: current };
}
