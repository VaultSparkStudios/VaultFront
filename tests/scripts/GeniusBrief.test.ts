import { describe, expect, it } from "vitest";
import {
  classifyGeniusItems,
  renderGeniusBrief,
} from "../../scripts/lib/genius-brief.mjs";

const item = (rank: number, status: string, title: string) => ({
  rank,
  status,
  title,
  tier: "🔥",
  effort: "2h",
  axis: "truth",
  recommendedModel: "sonnet",
});

describe("actionable genius brief", () => {
  it("renders pending work without resurfacing shipped history", () => {
    const rendered = renderGeniusBrief([
      item(1, "shipped", "Already shipped"),
      item(2, "pending", "Do this next"),
      item(3, "human-blocked", "Needs a human"),
    ]);
    expect(rendered).toContain("→ #1 🔥 Do this next");
    expect(rendered).not.toContain("Already shipped");
    expect(rendered).not.toContain("Needs a human");
  });

  it("renders an explicit source-derived exhaustion ledger", () => {
    const rendered = renderGeniusBrief(
      [item(1, "done", "One"), item(2, "shipped", "Two")],
      { auditSource: "docs/AUDIT_2026-08-04.json" },
    );
    expect(rendered).toContain("Primary audit exhausted · 2/2 shipped");
    expect(rendered).toContain("node scripts/ops.mjs innovation-pack");
    expect(rendered).toContain("docs/AUDIT_2026-08-04.json");
  });

  it("keeps blocked-only work visible without calling it actionable", () => {
    const rendered = renderGeniusBrief([
      item(1, "externally-blocked", "External"),
      item(2, "deferred", "Later"),
    ]);
    expect(rendered).toContain("No actionable local items");
    expect(rendered).toContain("1 blocked · 1 deferred");
    expect(rendered).not.toContain("→ #");
  });

  it("fails closed on unknown taxonomy instead of hiding malformed work", () => {
    const groups = classifyGeniusItems([item(1, "mystery", "Unknown")]);
    expect(groups.unknown).toHaveLength(1);
    expect(renderGeniusBrief(groups.unknown)).toContain(
      "Genius taxonomy unknown",
    );
  });
});
