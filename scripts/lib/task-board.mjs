/**
 * Shared TASK_BOARD parsing helpers used by startup, blocker, and queue flows.
 * Supports both the private table schema and this public repo's compact bullets.
 */

export function extractSection(markdown, heading) {
  const parts = String(markdown || "").split(/^## /m);
  const match = parts.find((part) => part.startsWith(heading));
  if (!match) return "";
  const nl = match.indexOf("\n");
  return nl === -1 ? "" : match.slice(nl + 1);
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBulletItem(line, index) {
  const match = line.match(
    /^- \[([^\]]+)\]\s+(?:(🔥|⚡|💡|⚠)\s+)?([^·]+?)\s*·\s*([^·]+?)\s*·\s*(.+)$/,
  );
  if (!match) return null;
  const [, status, tier = "", category, effort, item] = match;
  const titleMatch = item.match(/^(?:\*\*)?(.+?)(?:\*\*)?\s+—\s+/);
  return {
    rank: String(index + 1),
    rankNumber: index + 1,
    tier,
    category: category.trim(),
    status: status.trim(),
    effort: effort.trim(),
    item: cleanTitle(item),
    rawItem: item,
    title: cleanTitle(titleMatch?.[1] ?? item),
  };
}

function parseChecklistItem(line, index) {
  const match = line.match(/^- \[([^\]]*)\]\s+(.+)$/);
  if (!match) return null;
  const marker = match[1].trim().toLowerCase();
  const rawItem = match[2].trim();
  const tags = [...rawItem.matchAll(/\[([^\]]+)\]/g)].map((item) =>
    item[1].toLowerCase(),
  );
  const status =
    marker === "x"
      ? "done"
      : tags.some((tag) =>
            ["release-evidence", "ecosystem", "externally-blocked"].includes(
              tag,
            ),
          )
        ? "externally-blocked"
        : "unblocked";
  return {
    rank: String(index + 1),
    rankNumber: index + 1,
    tier: "",
    category: tags.join(" / "),
    status,
    effort: "",
    item: cleanTitle(rawItem),
    rawItem,
    title: cleanTitle(rawItem.replace(/^(?:\[[^\]]+\]\s*)+/, "")),
  };
}

export function parseUnifiedItems(markdown) {
  const section = extractSection(markdown, "Unified Genius List");
  if (!section) return [];

  const items = [];
  for (const line of section.split(/\r?\n/)) {
    if (/^\|\s*[\d.]+\s*\|/.test(line)) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length < 6 || cells[0] === "#") continue;
      const [rank, tier, category, status, effort, item] = cells;
      const titleMatch = item.match(/\*\*(.+?)\*\*/);
      items.push({
        rank,
        rankNumber: parseFloat(rank),
        tier,
        category,
        status,
        effort,
        item: cleanTitle(item),
        rawItem: item,
        title: cleanTitle(titleMatch ? titleMatch[1] : item),
      });
      continue;
    }

    const bullet = parseBulletItem(line, items.length);
    if (bullet) items.push(bullet);
  }

  return items;
}

export function parseTaskRows(markdown) {
  const rows = [];
  let section = "(root)";
  let tableKind = null;
  const lines = String(markdown || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heading = line.match(/^#{2,6}\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1].trim();
      tableKind = null;
    }

    if (!/^\s*\|/.test(line)) tableKind = null;
    if (/^\|\s*audit id\s*\|/i.test(line)) {
      tableKind = "audit";
      continue;
    }
    if (/^\|\s*(?:task\s+)?id\s*\|/i.test(line)) {
      tableKind = "task";
      continue;
    }

    if (/^\|\s*\d+(?:\.\d+)?\s*\|/.test(line)) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length < 6) continue;
      const [id, tier, category, status, effort, ...itemCells] = cells;
      const rawItem = itemCells.join(" | ").trim();
      rows.push({
        id,
        idNumber: Number(id),
        tier,
        category,
        status,
        effort,
        item: cleanTitle(rawItem),
        rawItem,
        title: cleanTitle(rawItem.match(/\*\*(.+?)\*\*/)?.[1] ?? rawItem),
        section,
        tableKind: tableKind ?? "table",
        line: index + 1,
        raw: line,
      });
      continue;
    }

    const bullet =
      parseBulletItem(line, rows.length) ??
      parseChecklistItem(line, rows.length);
    if (bullet) {
      rows.push({
        ...bullet,
        id: `bullet:${index + 1}`,
        idNumber: null,
        section,
        tableKind: "checklist",
        line: index + 1,
        raw: line,
      });
    }
  }
  return rows;
}

export function analyzeTaskBoard(markdown) {
  const source = String(markdown || "");
  const rows = parseTaskRows(source);
  const taskRows = rows.filter(
    (row) => row.idNumber !== null && row.tableKind !== "audit",
  );
  const checklistRows = rows.filter((row) => row.tableKind === "checklist");
  const activeRows = rows.filter(
    (row) =>
      /^(now|next|unified genius list)/i.test(row.section) &&
      !/^(done|shipped|complete)$/i.test(row.status),
  );
  const hasActiveSection = /^## (?:Now|Next|Unified Genius List)\s*$/im.test(
    source,
  );
  const explicitExhaustion =
    /(?:zero|0)\s+(?:pending\s+)?unblocked|complete-all[^\n]*(?:green|pass)|work exhaustion[^\n]*(?:green|pass)/i.test(
      source,
    );
  const supported = rows.length > 0 || (hasActiveSection && explicitExhaustion);
  return {
    supported,
    rows,
    taskRows,
    checklistRows,
    activeRows,
    hasActiveSection,
    explicitExhaustion,
    counts: {
      parsed: rows.length,
      numericTaskIds: taskRows.length,
      checklist: checklistRows.length,
      active: activeRows.length,
      done: rows.filter((row) => /^(done|shipped|complete)$/i.test(row.status))
        .length,
      blocked: rows.filter((row) => /blocked/i.test(row.status)).length,
    },
  };
}

export function findTaskRowsById(markdown, id) {
  const key = String(id ?? "").trim();
  return parseTaskRows(markdown).filter((row) => row.id === key);
}

function humanItemFromRow(row) {
  return {
    title: row.title,
    description: row.item,
    raw: row.raw,
    ageSessions: null,
  };
}

/**
 * Parse Human Action Required without treating an unsupported representation
 * as an empty queue. Durable-state callers must inspect `status` so parser
 * drift cannot erase first-seen evidence.
 */
export function parseHumanItemsResult(markdown) {
  const section = extractSection(markdown, "Human Action Required");
  const explicit = section
    .split(/\r?\n/)
    .map((line) => line.match(/^- \[ \] \*\*(.*?)\*\* — (.*)$/))
    .filter(Boolean)
    .map((parts) => {
      const title = parts[1].trim();
      const description = parts[2].trim();
      const ageMatch =
        description.match(/\((~?\d+)\s+sessions?\)/i) ||
        description.match(/\((\d+)\s+sessions?\s+old\)/i);
      return {
        title,
        description,
        raw: `**${title}** — ${description}`,
        ageSessions: ageMatch
          ? parseInt(ageMatch[1].replace("~", ""), 10)
          : null,
      };
    });

  const tableItems = parseTaskRows(markdown)
    .filter((row) => /human-blocked/i.test(row.status))
    .map(humanItemFromRow);
  const byTitle = new Map();
  for (const item of [...explicit, ...tableItems]) {
    if (!byTitle.has(item.title)) byTitle.set(item.title, item);
  }
  const items = [...byTitle.values()];
  if (items.length) return { status: "parsed", items };

  if (!section) return { status: "absent", items: [] };

  const meaningfulLines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^<!--.*-->$/.test(line) &&
        !/^(?:none|no human actions?(?: required)?|—|-)\.?$/i.test(line),
    );
  return meaningfulLines.length
    ? {
        status: "unknown",
        items: [],
        reason:
          "Human Action Required contains content that does not match the canonical bullet or table schema.",
      }
    : { status: "parsed", items: [] };
}

export function parseHumanItems(markdown) {
  return parseHumanItemsResult(markdown).items;
}

export function extractCurrentSessionIntent(markdown) {
  const source = String(markdown || "");
  const current = source.match(
    /## Current Session Intent: Session \d+\r?\n([\s\S]*?)(?=\r?\n## |\r?\n---|$)/,
  );
  if (current) return current[1].trim().replace(/\r?\n+/g, " ");

  const labeled = source.match(
    /(?:^|\r?\n)\*\*Session Intent:\*\*\s*([^\r\n]+)/i,
  );
  if (labeled) return labeled[1].trim();

  const heading = source.match(
    /## Session \d+[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n## |$)/i,
  );
  return heading ? heading[1].trim().replace(/\r?\n+/g, " ") : "";
}
