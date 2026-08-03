import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  certifiedFeedbackReachabilityContract,
  checkCertifiedFeedbackReachability,
} from "../../scripts/check-certified-feedback-reachability.mjs";

describe("certified feedback reachability", () => {
  it("proves the live route-to-player receipt chain", () => {
    expect(checkCertifiedFeedbackReachability(process.cwd())).toMatchObject({
      ok: true,
      capability: "certified-match-feedback",
      errors: [],
      sourceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it("fails closed when any layer loses its required connection", () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), "vf-feedback-reach-"),
    );
    try {
      for (const entry of certifiedFeedbackReachabilityContract) {
        const target = path.join(fixture, entry.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, entry.includes.join("\n"));
      }
      expect(checkCertifiedFeedbackReachability(fixture).ok).toBe(true);
      const clientPath = path.join(
        fixture,
        "src/client/CertifiedMatchFeedback.ts",
      );
      fs.writeFileSync(
        clientPath,
        "certified-match-feedback\npostMatchRating\n",
      );

      const result = checkCertifiedFeedbackReachability(fixture);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining("retentionDays"),
      );
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
