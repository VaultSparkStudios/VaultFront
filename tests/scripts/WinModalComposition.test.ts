import { describe, expect, test } from "vitest";
import { inspectWinModalComposition } from "../../scripts/check-win-modal-composition.mjs";

describe("WinModal composition", () => {
  test("keeps post-match concurrency inside the bounded session owner", () => {
    const result = inspectWinModalComposition();
    expect(result).toMatchObject({
      ok: true,
      errors: [],
      modal: { budget: 2380 },
      lifecycle: { budget: 240 },
    });
    expect(result.modal.lines).toBeLessThanOrEqual(2380);
    expect(result.lifecycle.lines).toBeLessThanOrEqual(234);
  });
});
