import fs from "node:fs";
import path from "node:path";

const UNKNOWN_DURATION_MS = 90_000;
const MAX_REASONABLE_MS = 10 * 60_000;

export function readDurationCache(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeDurationCache(cachePath, cache) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(
    cachePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        files: cache.files || {},
      },
      null,
      2,
    ) + "\n",
  );
}

export function durationSortKey(relPath, cache) {
  const entry = cache?.files?.[relPath];
  const observed = Number(entry?.durationMs);
  if (!Number.isFinite(observed) || observed <= 0) return UNKNOWN_DURATION_MS;
  return Math.min(observed, MAX_REASONABLE_MS);
}

export function sortByHistoricalDuration(files, cache, toRel = (f) => f) {
  return [...files].sort((a, b) => {
    const aRel = toRel(a);
    const bRel = toRel(b);
    const byDuration =
      durationSortKey(aRel, cache) - durationSortKey(bRel, cache);
    return byDuration || String(aRel).localeCompare(String(bRel));
  });
}

export function recordDuration(cache, relPath, durationMs) {
  const safeMs = Math.max(1, Math.round(Number(durationMs) || 1));
  const next = cache && typeof cache === "object" ? cache : {};
  next.files = next.files && typeof next.files === "object" ? next.files : {};
  const prior = Number(next.files[relPath]?.durationMs);
  const smoothed = Number.isFinite(prior)
    ? Math.round(prior * 0.7 + Math.min(safeMs, MAX_REASONABLE_MS) * 0.3)
    : Math.min(safeMs, MAX_REASONABLE_MS);
  next.files[relPath] = {
    durationMs: smoothed,
    lastObservedMs: safeMs,
    lastRunAt: new Date().toISOString(),
  };
  return next;
}
