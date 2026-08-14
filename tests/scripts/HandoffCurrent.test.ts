import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { selectLatestSessionHandoff } from "../../scripts/lib/handoff-current.mjs";

describe("selectLatestSessionHandoff", () => {
  it("selects the highest session even when append order is non-monotonic", () => {
    const markdown = [
      "## Session Intent — Session 102 (date)",
      "Deploy: old run 1",
      "## Session Intent — Session 99 (date)",
      "Deploy: older run 0",
      "## Session Intent — Session 103 (date)",
      "Deploy: current run 2",
    ].join("\n");
    expect(selectLatestSessionHandoff(markdown)).toContain("Session 103");
    expect(selectLatestSessionHandoff(markdown)).toContain("current run 2");
    expect(selectLatestSessionHandoff(markdown)).not.toContain("old run 1");
  });

  it("feeds the selected session to both deterministic and model paths", () => {
    const source = fs.readFileSync("scripts/compact-handoff.mjs", "utf8");
    expect(source).toContain(
      "const currentHandoff = selectLatestSessionHandoff(handoff)",
    );
    expect(source).toContain("content: currentHandoff.slice(0, 40000)");
  });

  it("feeds the selected session to the closeout board", () => {
    const source = fs.readFileSync("scripts/render-closeout-board.mjs", "utf8");
    expect(source).toContain(
      "const currentHandoff = selectLatestSessionHandoff(body)",
    );
    expect(source).toContain("currentHandoff.match(/^##\\s+Where We Left Off");
  });
});
