const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoCalendarDate(value) {
  if (typeof value !== "string") return false;
  const match = value.match(ISO_DATE);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

export function freshestIsoDate(values) {
  const dates = values.filter(isIsoCalendarDate);
  return dates.length ? dates.sort().at(-1) : null;
}

export function averageLatestTotals(values, count = 3) {
  const totals = values
    .filter((value) => Number.isFinite(value))
    .slice(0, Math.max(1, count));
  if (!totals.length) return null;
  return Number(
    (totals.reduce((sum, value) => sum + value, 0) / totals.length).toFixed(1),
  );
}
function headingSession(title) {
  const explicit = String(title).match(/\bSession\s+(\d+)\b/iu);
  if (explicit) return Number(explicit[1]);
  const compact = String(title).match(/(?:^|[\s·—|([])S(\d+)\b/iu);
  return compact ? Number(compact[1]) : null;
}

function headingDate(title) {
  const match = String(title).match(/\b\d{4}-\d{2}-\d{2}\b/u);
  return match && isIsoCalendarDate(match[0]) ? match[0] : null;
}

/**
 * Parse only Markdown headings that explicitly identify a session. Prose
 * mentions never become chronology evidence. Bodies end at the next heading
 * of the same or shallower level, preserving nested category sections.
 */
export function parseSessionSections(markdown) {
  const source = String(markdown ?? "");
  const headings = [...source.matchAll(/^(#{1,6})[ \t]+([^\r\n]+)$/gmu)].map(
    (match) => ({
      level: match[1].length,
      title: match[2].trim(),
      start: match.index ?? 0,
      bodyStart: (match.index ?? 0) + match[0].length,
    }),
  );

  const sections = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const session = headingSession(heading.title);
    if (!Number.isFinite(session)) continue;
    const next = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);
    const end = next?.start ?? source.length;
    sections.push({
      session,
      date: headingDate(heading.title),
      header: `${"#".repeat(heading.level)} ${heading.title}`,
      title: heading.title,
      body: source.slice(heading.bodyStart, end).replace(/^\r?\n/u, ""),
      level: heading.level,
      start: heading.start,
      end,
    });
  }
  return sections;
}

/** Select the newest typed session section, optionally constrained by title. */
export function selectLatestSessionSection(markdown, { titlePrefix } = {}) {
  const normalizedPrefix = String(titlePrefix ?? "")
    .trim()
    .toLocaleLowerCase();
  return (
    parseSessionSections(markdown)
      .filter(
        (section) =>
          !normalizedPrefix ||
          section.title.toLocaleLowerCase().startsWith(normalizedPrefix),
      )
      .sort((a, b) => b.session - a.session || b.start - a.start)[0] ?? null
  );
}

/** Extract session numbers only from headings or anchored structured fields. */
export function extractSessionNumbers(markdown) {
  const source = String(markdown ?? "");
  const numbers = parseSessionSections(source).map(
    (section) => section.session,
  );
  for (const match of source.matchAll(/^\s*Session\s*:\s*(\d+)\b/gimu)) {
    numbers.push(Number(match[1]));
  }
  return [...new Set(numbers.filter(Number.isFinite))];
}
