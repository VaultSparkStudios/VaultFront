import { describe, expect, test } from "vitest";
import {
  CLIENT_FILE_BUDGETS,
  inspectClientComposition,
} from "../../scripts/check-client-composition.mjs";

describe("client composition (S99 audit #188)", () => {
  test("keeps every registered client file inside its line budget", () => {
    const result = inspectClientComposition();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(CLIENT_FILE_BUDGETS.length);
    for (const { lines, lineBudget } of result.files) {
      expect(lines).toBeLessThanOrEqual(lineBudget);
    }
  });

  test("registers ControlPanel.ts, the largest ungoverned client file", () => {
    const result = inspectClientComposition();
    expect(
      result.files.some((f) => f.file.endsWith("layers/ControlPanel.ts")),
    ).toBe(true);
  });
});
