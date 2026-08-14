// sil-ledger.mjs — one parser for the append-only, mixed-format SIL ledger.
//
// SELF_IMPROVEMENT_LOOP.md is append-only but not physically ordered and carries
// several historical header shapes. Session number, never document position, is
// the ordering authority. Every consumer gets the same parsed block contract.

// `##` ONLY — a `###` sub-heading is an ADDENDUM to the session above it, not a
// session of its own. Matching `###` here made every addendum a phantom duplicate
// entry carrying `total: null`, and (because addenda are appended out of document
// order) sometimes sorted that phantom AHEAD of the real entry. Historical
// `##`-level addenda that carry their own `Total:` are unaffected and stay
// first-class entries, which is the format S180/S183 actually used.
const HEADER_RE = /^##(?!#)[^\n]*\bSession\s+(\d+)\b[^\n]*$/gim;

/**
 * A session's score can be REVISED after the fact by an addendum:
 *   `### 2026-08-10 — Session 275 addendum | Score revised: 982 → 985 | Kind: …`
 * The ledger has used this convention since S272, but no consumer understood it —
 * every reader reported the superseded base score. The last revision in a block
 * wins; `Score retained: N` deliberately asserts no change and is not a revision.
 */
// Attribution is BY NAME, never by document position. The ledger is append-only and
// physically unordered, so an addendum for S273 can sit inside the byte range of the
// S274 block — attributing revisions positionally silently rescored the neighbouring
// session (S274 read 982, which was S273's revision). The addendum header names its
// own session; that name is the authority, exactly as session number (not position)
// is the ordering authority everywhere else in this parser.
const REVISION_RE =
  /^###[^\n]*\bSession\s+(\d+)\b[^\n]*?\bScore\s+revised:\s*(\d+)\s*(?:→|->|—>|–>)\s*(\d+)/gim;

/** session number → revisions in document order (last one wins). */
function revisionsBySession(markdown) {
  const map = new Map();
  for (const m of String(markdown).matchAll(REVISION_RE)) {
    const session = Number(m[1]);
    if (!map.has(session)) map.set(session, []);
    map.get(session).push({ from: Number(m[2]), to: Number(m[3]) });
  }
  return map;
}

const CATEGORY_ALIASES = new Map([
  ["cross-repo coherence", "Cross-Repo Coherence"],
  ["cross-repo coher", "Cross-Repo Coherence"],
  ["ecosystem integration", "Ecosystem Integration"],
  ["ecosystem integ", "Ecosystem Integration"],
  ["automation coverage", "Automation Coverage"],
  ["automation cover", "Automation Coverage"],
  ["engagement (infra)", "Engagement"],
]);

function numberMatch(text, label) {
  const re = new RegExp(`(?:\\*\\*)?${label}:(?:\\*\\*)?\\s*(\\d+)`, "i");
  const value = String(text).match(re)?.[1];
  return value == null ? null : Number(value);
}

function totalMatch(text) {
  const match = String(text).match(
    /(?:(?:\*\*)?Total:(?:\*\*)?|SIL(?:[^:|()]*)?:)\s*(\d+)\/(\d+)/i,
  );
  return match
    ? { total: Number(match[1]), max: Number(match[2]) }
    : { total: null, max: null };
}

function parseCategories(block) {
  const categories = {};
  const rowRe = /^\|\s*(?:\d+\s*\|\s*)?([A-Za-z][^|]+?)\s*\|\s*(\d+)\s*\|/gm;
  for (const match of String(block).matchAll(rowRe)) {
    let label = match[1].trim().replace(/\s+/g, " ");
    label =
      CATEGORY_ALIASES.get(label.toLowerCase()) ??
      label.replace(/\s*\([^)]*\)\s*$/, "");
    categories[label] = Number(match[2]);
  }
  return categories;
}

/** Parse every SIL session and sort greatest session first by default. */
export function parseSilSessions(markdown = "", { order = "desc" } = {}) {
  const text = String(markdown);
  const headers = [...text.matchAll(HEADER_RE)];
  const revisionMap = revisionsBySession(text);
  const entries = headers
    .map((match, index) => {
      const sourceIndex = match.index ?? 0;
      const headerEnd = sourceIndex + match[0].length;
      const nextIndex = headers[index + 1]?.index ?? text.length;
      const header = match[0];
      const body = text.slice(headerEnd, nextIndex).replace(/^\r?\n/, "");
      const block = `${header}\n${body}`;
      const { total: baseTotal, max } = totalMatch(block);
      const date = header.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null;
      const velocity = numberMatch(block, "Velocity");
      // Effective score = the last addendum revision, else the base header total.
      // `baseTotal` and `revisions` stay exposed so the derivation is inspectable
      // rather than a number that silently differs from the one in the header.
      const session = Number(match[1]);
      const revisions = revisionMap.get(session) ?? [];
      const total = revisions.length
        ? revisions[revisions.length - 1].to
        : baseTotal;
      return {
        session,
        date,
        header,
        body,
        block,
        total,
        baseTotal,
        revisions,
        max,
        totalNormalized:
          total == null || max == null ? null : max === 500 ? total * 2 : total,
        velocity,
        categories: parseCategories(body),
        sourceIndex,
      };
    })
    .filter((entry) => Number.isFinite(entry.session));

  const newestBySession = new Map();
  for (const entry of entries) {
    const existing = newestBySession.get(entry.session);
    if (!existing || entry.sourceIndex > existing.sourceIndex) {
      newestBySession.set(entry.session, entry);
    }
  }
  const direction = order === "asc" ? 1 : -1;
  return [...newestBySession.values()].sort(
    (a, b) =>
      direction * (a.session - b.session) || a.sourceIndex - b.sourceIndex,
  );
}

export function latestSilEntry(markdown = "", { requireScore = false } = {}) {
  const entries = parseSilSessions(markdown);
  return (
    (requireScore
      ? entries.find((entry) => entry.total != null)
      : entries[0]) ?? null
  );
}

export function latestSilSession(markdown = "") {
  return latestSilEntry(markdown)?.session ?? null;
}

export function selectSilPair(markdown = "", { requireScore = false } = {}) {
  const entries = parseSilSessions(markdown);
  const current =
    (requireScore
      ? entries.find((entry) => entry.total != null)
      : entries[0]) ?? null;
  const previous = current
    ? (entries.find(
        (entry) =>
          entry.session < current.session &&
          (!requireScore || entry.total != null),
      ) ?? null)
    : null;
  return { current, previous };
}

export default {
  parseSilSessions,
  latestSilEntry,
  latestSilSession,
  selectSilPair,
};
