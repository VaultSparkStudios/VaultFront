const WIDTH = 62;

const ACTIONABLE = new Set(["pending", "unblocked"]);
const FINISHED = new Set(["done", "shipped", "complete", "completed"]);
const BLOCKED = new Set([
  "blocked",
  "human-blocked",
  "cross-repo-locked",
  "externally-blocked",
  "blocked-on-hub",
]);
const DEFERRED = new Set(["deferred", "staged"]);

function row(content) {
  const value = String(content ?? "");
  return `║  ${value.length > WIDTH ? value.slice(0, WIDTH) : value.padEnd(WIDTH, " ")}  ║`;
}

function top(title) {
  const label = `══ ${title} `;
  return `╔${label}${"═".repeat(Math.max(1, WIDTH + 2 - label.length))}╗`;
}

function bottom() {
  return `╚${"═".repeat(WIDTH + 2)}╝`;
}

export function classifyGeniusItems(items = []) {
  const result = {
    actionable: [],
    finished: [],
    blocked: [],
    deferred: [],
    unknown: [],
  };
  for (const item of items) {
    const status = String(item?.status ?? "")
      .trim()
      .toLowerCase();
    if (ACTIONABLE.has(status) && !item?.blocked) result.actionable.push(item);
    else if (FINISHED.has(status)) result.finished.push(item);
    else if (BLOCKED.has(status) || item?.blocked) result.blocked.push(item);
    else if (DEFERRED.has(status)) result.deferred.push(item);
    else result.unknown.push(item);
  }
  return result;
}

/** Render only work an agent can act on; completed history stays in the cache/MD. */
export function renderGeniusBrief(items = [], options = {}) {
  const topCount = Number.isSafeInteger(options.top) ? options.top : 8;
  const auditSource = options.auditSource ?? null;
  const groups = classifyGeniusItems(items);
  const lines = [top("GENIUS HIT LIST")];

  for (const [index, entry] of groups.actionable.slice(0, topCount).entries()) {
    lines.push(
      row(
        `→ #${index + 1} ${entry.tier ?? ""} ${entry.title ?? entry.slug ?? "Untitled item"}`,
      ),
    );
    lines.push(
      row(
        `   ${entry.effort ?? "unspecified"} · ${entry.axis ?? "uncategorized"} · ${entry.recommendedModel ?? "default"}`,
      ),
    );
  }

  if (groups.actionable.length > topCount) {
    lines.push(
      row(`… +${groups.actionable.length - topCount} more actionable item(s)`),
    );
  }

  if (groups.actionable.length === 0) {
    const total = items.length;
    if (groups.unknown.length > 0) {
      lines.push(
        row(
          `⛔ Genius taxonomy unknown · ${groups.unknown.length}/${total} item(s)`,
        ),
      );
      lines.push(row("Repair: node scripts/ops.mjs doctor"));
    } else if (groups.blocked.length + groups.deferred.length > 0) {
      lines.push(
        row(
          `⏸ No actionable local items · ${groups.blocked.length} blocked · ${groups.deferred.length} deferred`,
        ),
      );
      lines.push(row("Next: reclassify live blockers, then innovation-pack"));
    } else {
      lines.push(
        row(
          `✓ Primary audit exhausted · ${groups.finished.length}/${total} shipped`,
        ),
      );
      lines.push(row("Next: node scripts/ops.mjs innovation-pack"));
    }
  }

  if (auditSource) lines.push(row(`Audit: ${auditSource}`));
  lines.push(bottom());
  return lines.join("\n");
}
