import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { observeLiveFooterManifest } from "../../scripts/observe-live-footer-manifest.mjs";

const manifest = JSON.parse(
  fs.readFileSync(path.resolve("src/shared/PublicRouteGraph.json"), "utf8"),
);
const revision = "a".repeat(40);
const footerHtml = [
  "<footer>",
  `<a href="${manifest.brandHref}">VaultSpark Studios</a>`,
  manifest.copyright,
  ...manifest.footerLinks.map(
    (link: { href: string }) => `<a href="${link.href}">Link</a>`,
  ),
  "</footer>",
].join("");

function mockFetch(failingRoute?: string) {
  return async (input: URL | RequestInfo) => {
    const url = new URL(input.toString());
    if (url.pathname === "/commit.txt")
      return new Response(revision, { status: 200 });
    return new Response(
      url.pathname === failingRoute
        ? "<footer>incomplete</footer>"
        : footerHtml,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };
}

describe("live footer observation", () => {
  it("binds every declared public route to an exact runtime revision", async () => {
    const result = await observeLiveFooterManifest({
      origin: "https://staging.vaultfront.io",
      revision,
      fetchImpl: mockFetch() as typeof fetch,
      now: () => new Date("2026-08-16T02:00:00.000Z"),
    });
    expect(result).toMatchObject({
      ok: true,
      revision,
      routeCount: manifest.pages.length,
      footerLinkCount: manifest.footerLinks.length,
      errors: [],
    });
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("fails closed when any live route loses the canonical footer", async () => {
    const result = await observeLiveFooterManifest({
      origin: "https://staging.vaultfront.io",
      revision,
      fetchImpl: mockFetch("/terms/") as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("/terms/:copyright-missing");
    expect(result.errors).toContain("/terms/:brand-link-missing");
  });
});

describe("staging observation workflow contract", () => {
  it("admits deploy metadata before signing only measured staging evidence", () => {
    const workflow = fs.readFileSync(
      path.resolve(".github/workflows/observe-staging.yml"),
      "utf8",
    );
    for (const required of [
      "staging-attestation.mjs verify",
      "capture-release-parity.mjs",
      "check-theme-proof-receipt.mjs",
      "observe-live-footer-manifest.mjs",
      "create-staging-observations",
      "install-release-evidence.sh",
      "environment: staging",
    ])
      expect(workflow).toContain(required);
    expect(workflow).not.toMatch(/revenueObservation|alphaHumanEvidence/u);
  });

  it("extends an admitted observation bundle after exact rollback restoration", () => {
    const workflow = fs.readFileSync(
      path.resolve(".github/workflows/staging-rollback-drill.yml"),
      "utf8",
    );
    expect(workflow).toContain("observation_run_id");
    expect(workflow).toContain("add-rollback-observation");
    expect(workflow).toContain("runtime-release-evidence.json");
    expect(workflow).toContain("install-release-evidence.sh");
    const signer = fs.readFileSync(
      path.resolve("scripts/runtime-release-evidence.mjs"),
      "utf8",
    );
    expect(signer).not.toContain('deployClaim("obeliskIdentity")');
    expect(signer).not.toContain('["obeliskIdentity", {}, 24 * 60]');
    expect(signer).toContain("const verificationNow = Math.max(");
    expect(signer).toContain("now: verificationNow");
    expect(signer).toContain("verifyRollbackDrillReceipt(receipt).ok");
    expect(signer).not.toContain("reportDigest(receipt)");
    expect(signer).toMatch(
      /signed\(\s*"rollbackObservation",[\s\S]*?ROLLBACK_EVIDENCE_LIFETIME_MINUTES,/u,
    );
    expect(signer).toContain("Invalid evidence lifetime for ${gate}");
    expect(signer).toContain("validateReleaseParityMatrix");
    expect(signer).not.toContain("parity.summary?.cellCount !== 9");
  });
});
