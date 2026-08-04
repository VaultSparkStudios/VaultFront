import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.resolve(".github/workflows/ci.yml"),
  "utf8",
);

describe("single-build CI artifact fanout", () => {
  it("builds production exactly once and fans out the hash-bound artifact", () => {
    expect(workflow.match(/npm run build-prod/gu)).toHaveLength(1);
    expect(workflow).toContain("static-build-${{ github.sha }}");
    expect(
      workflow.match(/build-artifact-manifest\.mjs[^\n]*--verify/gu),
    ).toHaveLength(2);
    expect(
      workflow.match(/actions\/download-artifact@[0-9a-f]{40}/gu),
    ).toHaveLength(2);
    expect(workflow).toMatch(
      /name: static-build-\$\{\{ github\.sha \}\}[\s\S]*?include-hidden-files: true/u,
    );
  });

  it("projects post-verification evidence without rebuilding", () => {
    const releaseJob = workflow.slice(workflow.indexOf("  release-evidence:"));
    expect(releaseJob).toContain("node scripts/generate-release-evidence.mjs");
    expect(releaseJob).not.toContain("npm run build-prod");
    expect(releaseJob).toContain("release-artifact-manifest.json");
  });
});
