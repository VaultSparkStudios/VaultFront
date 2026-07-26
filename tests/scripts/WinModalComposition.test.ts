import { describe, expect, test } from "vitest";
import { inspectWinModalComposition } from "../../scripts/check-win-modal-composition.mjs";

describe("WinModal composition", () => {
  test("keeps post-match concurrency inside the bounded session owner", () => {
    expect(inspectWinModalComposition()).toMatchObject({
      ok: true,
      errors: [],
      modal: { lines: 2384, budget: 2400 },
      lifecycle: { lines: 234, budget: 240 },
    });
  });
});
