import { describe, expect, it } from "vitest";
import { renderLastCompleted } from "../../scripts/lib/brief-blocks.mjs";
import { validateStartupBrief } from "../../scripts/validate-brief-format.mjs";

describe("canonical startup brief epistemic integrity", () => {
  it("parses Session N summaries, wraps the headline, and renders direct evidence", () => {
    const block = renderLastCompleted(
      "Session 88 complete: fresh worker quorum, exact artifact delivery, certified decisive-loop evidence, and schedule-free operations shipped.",
      {
        expectedSession: 88,
        tests: "1013/1013 passing",
        deploy: "NO-GO · no staging/production observation",
      },
    );

    expect(block).toContain("LAST SESSION (S88) - WHAT SHIPPED");
    expect(block).toContain("1013/1013 passing");
    expect(block).toContain("NO-GO · no staging/production observation");
    expect(block).not.toContain("S?");
    expect(block).not.toMatch(/Tests\s+-/);
    expect(block).not.toMatch(/Deploy\s+-/);
    expect(
      Math.max(...block.split("\n").map((line) => line.length)),
    ).toBeLessThanOrEqual(68);
  });

  it("rejects confident unknowns, placeholder evidence, and conflated provenance", () => {
    const body = [
      "<!-- generated-at: 2026-07-29 (Session 88 closeout) -->",
      "<!-- brief-coherent: true -->",
      "╔══ SCORE ═══════════════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ SIGNALS ═════════════════════════════════════════════════════╗",
      "║  ✓  Runway        unknown                                    ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ LAST SESSION (S?) - WHAT SHIPPED ═══════════════════════════╗",
      "║  Tests  -                                                     ║",
      "║  Deploy -                                                     ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ WHERE WE LEFT OFF ═══════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ GENIUS HIT LIST ═════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
    ].join("\n");

    const result = validateStartupBrief(body);

    expect(result.ok).toBe(false);
    expect(result.semanticContradictions.join(" ")).toMatch(/unknown.*green/i);
    expect(result.semanticContradictions.join(" ")).toContain("S?");
    expect(result.semanticContradictions.join(" ")).toMatch(/placeholder/i);
    expect(result.semanticContradictions.join(" ")).toMatch(
      /stamp them separately/i,
    );
  });

  it("accepts project release pressure when no human-pressure feed is available", () => {
    const body = [
      "<!-- generated-at: 2026-08-23 (Session 108 closeout) -->",
      "<!-- brief-coherent: true -->",
      "╔══ SCORE ═══════════════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ SIGNALS ═════════════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ WHERE WE LEFT OFF ═══════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ GENIUS HIT LIST ═════════════════════════════════════════════╗",
      "║ ok                                                           ║",
      "╚═══════════════════════════════════════════════════════════════╝",
      "╔══ RELEASE PRESSURE ════════════════════════════════════════════╗",
      "║ Open gates: 5                                                ║",
      "╚═══════════════════════════════════════════════════════════════╝",
    ].join("\n");

    const result = validateStartupBrief(body);
    expect(result.missingRecommended).not.toContain(
      "HUMAN or RELEASE PRESSURE block",
    );
  });
});
