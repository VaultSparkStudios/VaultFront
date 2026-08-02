import { describe, expect, it } from "vitest";
import {
  analyzeTaskBoard,
  parseTaskRows,
} from "../../scripts/lib/task-board.mjs";

describe("TASK_BOARD shared structural parser", () => {
  it("parses the public compact Now/Next representation without a vacuous pass", () => {
    const report = analyzeTaskBoard(`# Tasks

## Now

- [ ] [release-evidence] Establish staging truth.
- [ ] Build the local authority.

## Next

- [x] Completed item.
`);
    expect(report.supported).toBe(true);
    expect(report.counts).toMatchObject({
      parsed: 3,
      numericTaskIds: 0,
      checklist: 3,
      active: 2,
    });
    expect(report.activeRows.map((row) => row.status)).toEqual([
      "externally-blocked",
      "unblocked",
    ]);
  });

  it("distinguishes audit row indices from task IDs", () => {
    const rows = parseTaskRows(`## Completed

| Audit ID | Tier | Category | Status | Effort | Item |
|---|---|---|---|---|---|
| 1 | 🔥 | security | done | 1h | Audit result |

## Unified Genius List

| ID | Tier | Category | Status | Effort | Item |
|---|---|---|---|---|---|
| 101 | 🔥 | security | unblocked | 2h | Real task |
`);
    expect(rows.map((row) => [row.id, row.tableKind])).toEqual([
      ["1", "audit"],
      ["101", "task"],
    ]);
  });

  it("accepts an intentionally exhausted active surface and rejects unsupported prose", () => {
    expect(
      analyzeTaskBoard("## Now\n\nComplete-all gate: 0 pending unblocked.\n")
        .supported,
    ).toBe(true);
    expect(
      analyzeTaskBoard("## Now\n\nSomething ambiguous lives here.\n").supported,
    ).toBe(false);
  });
});
