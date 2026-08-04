import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyConventionalCommit,
  parseSemanticTag,
  planGithubRelease,
} from "../../scripts/plan-github-release.mjs";

describe("proprietary GitHub release planner", () => {
  it("classifies release-bearing conventional commits", () => {
    expect(classifyConventionalCommit("feat(hud): add chain state")).toBe(
      "minor",
    );
    expect(classifyConventionalCommit("fix(ci): preserve hidden paths")).toBe(
      "patch",
    );
    expect(classifyConventionalCommit("chore: record closeout")).toBe("none");
  });

  it("gives breaking changes precedence over other commit types", () => {
    const plan = planGithubRelease({
      latestTag: "v2.4.9",
      commits: ["fix: patch transport", "feat(protocol)!: replace wire format"],
    });
    expect(plan).toMatchObject({
      shouldRelease: true,
      level: "major",
      baseTag: "v2.4.9",
      tag: "v3.0.0",
      title: "VaultFront v3.0.0",
      releaseCommitCount: 2,
    });
  });

  it("recognizes a BREAKING CHANGE body", () => {
    expect(
      classifyConventionalCommit(
        "refactor(protocol): new envelope\n\nBREAKING CHANGE: v1 removed",
      ),
    ).toBe("major");
  });

  it("emits an honest no-op when only process commits follow the tag", () => {
    expect(
      planGithubRelease({
        latestTag: "v1.2.3",
        commits: ["docs: closeout", "ci: pin action"],
      }),
    ).toMatchObject({
      shouldRelease: false,
      level: "none",
      tag: "v1.2.3",
      releaseCommitCount: 0,
    });
  });

  it("starts an untagged feature history at v0.1.0", () => {
    expect(
      planGithubRelease({ commits: ["feat: first playable surface"] }).tag,
    ).toBe("v0.1.0");
  });

  it("rejects malformed tag authority", () => {
    expect(() => parseSemanticTag("release/latest")).toThrow(
      "invalid-semantic-tag",
    );
  });

  it("keeps the workflow dependency-free and side-effect gated", () => {
    const workflow = fs.readFileSync(
      path.resolve(".github/workflows/semantic-release.yml"),
      "utf8",
    );
    expect(workflow).toContain("node scripts/plan-github-release.mjs --check");
    expect(workflow).toContain('gh release create "${args[@]}"');
    expect(workflow).toContain("steps.plan.outputs.should_release == 'true'");
    expect(workflow).not.toContain("npm ci");
    expect(workflow).not.toContain("npx semantic-release");
  });
});
