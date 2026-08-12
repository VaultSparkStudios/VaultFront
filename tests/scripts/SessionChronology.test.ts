import { describe, expect, it } from "vitest";
import {
  averageLatestTotals,
  extractSessionNumbers,
  freshestIsoDate,
  isIsoCalendarDate,
  parseSessionSections,
  selectLatestSessionSection,
} from "../../scripts/lib/session-chronology.mjs";
import { parseSilHistory } from "../../scripts/lib/sil-forecaster.mjs";
import { validateStartupBrief } from "../../scripts/validate-brief-format.mjs";

describe("session chronology", () => {
  it("accepts only real ISO calendar dates", () => {
    expect(isIsoCalendarDate("2026-07-21")).toBe(true);
    expect(isIsoCalendarDate("2026-02-30")).toBe(false);
    expect(isIsoCalendarDate(77)).toBe(false);
  });

  it("selects the freshest date without admitting numeric session ids", () => {
    expect(
      freshestIsoDate(["2026-07-19", 77, "2026-07-21", "not-a-date"]),
    ).toBe("2026-07-21");
  });

  it("derives Avg3 from the newest scored session totals", () => {
    expect(averageLatestTotals([997, undefined, 985, 959, 1000])).toBe(980.3);
  });

  it("rejects implausible rendered activity ages", () => {
    const result = validateStartupBrief(
      "Last active: 20654d " + "╔╗╚╝║═╠╣".repeat(6),
    );
    expect(result.semanticContradictions).toContain(
      "Last active reports 20654 days; reject likely non-date chronology input.",
    );
  });
});
describe("typed session ledger parsing", () => {
  it("supports legacy and current headings without treating prose as evidence", () => {
    const sections = parseSessionSections(`
A sentence says Session 999 but is not evidence.

## 2026-07-20 — Session 76 | Total: 980/1000
older body

### Nested detail
kept with the owning session

## Session 78 — 2026-07-21
newer body

# S77 recovery
recovery body
`);
    expect(
      sections.map((section) => ({
        session: section.session,
        date: section.date,
      })),
    ).toEqual([
      { session: 76, date: "2026-07-20" },
      { session: 78, date: "2026-07-21" },
      { session: 77, date: null },
    ]);
    expect(sections[0].body).toContain("Nested detail");
    expect(extractSessionNumbers("prose Session 999 only")).toEqual([]);
  });

  it("accepts anchored structured session fields and rejects malformed dates", () => {
    expect(
      extractSessionNumbers("Session: 79\nNarrative mentions Session 900."),
    ).toEqual([79]);
    const [section] = parseSessionSections("## 2026-02-30 — Session 12\nbody");
    expect(section.date).toBeNull();
  });

  it("ends a session body at the next same-level heading", () => {
    const [first, second] = parseSessionSections(
      "## Session 4 — 2026-01-01\none\n### Detail\ntwo\n## Session 5 — 2026-01-02\nthree",
    );
    expect(first.body).toContain("two");
    expect(first.body).not.toContain("three");
    expect(second.body).toContain("three");
  });

  it("selects the newest matching section instead of a sibling intent heading", () => {
    const markdown = [
      "## Where We Left Off — Session 101 complete",
      "- current product truth",
      "## Completed Session Intent — Session 101",
      "intent prose",
      "## Where We Left Off — Session 100 complete",
      "- stale product truth",
    ].join("\n");
    expect(
      selectLatestSessionSection(markdown, {
        titlePrefix: "Where We Left Off",
      })?.body,
    ).toContain("current product truth");
  });
});
describe("SIL session identity", () => {
  it("uses the newest physical entry once when a session heading is duplicated", () => {
    const sessions = parseSilHistory(
      [
        "## 2026-01-01 — Session 4 | Total: 900/1000",
        "old",
        "## 2026-01-02 — Session 4 | Total: 950/1000",
        "corrected",
        "## 2026-01-03 — Session 5 | Total: 960/1000",
      ].join("\n"),
      10,
    );
    expect(sessions.map(({ session, total }) => ({ session, total }))).toEqual([
      { session: 5, total: 960 },
      { session: 4, total: 950 },
    ]);
  });
});
