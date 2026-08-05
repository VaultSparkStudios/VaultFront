import { describe, expect, it } from "vitest";
import {
  prepareControlPlaneArgs,
  PROJECT_ROOT,
} from "../../scripts/lib/control-plane-tool.mjs";

describe("project-local control-plane tool policies", () => {
  it("injects the correct project flag for each allowlisted tool family", () => {
    expect(
      prepareControlPlaneArgs("sample-codebase.mjs", ["--max-tokens", "100"]),
    ).toEqual(["--root", PROJECT_ROOT, "--max-tokens", "100"]);
    expect(prepareControlPlaneArgs("render-state-vector.mjs", [])).toEqual([
      "--project",
      PROJECT_ROOT,
    ]);
    expect(prepareControlPlaneArgs("lib/skill-profile.mjs", ["audit"])).toEqual(
      ["audit"],
    );
  });

  it("preserves an explicit root and refuses unknown control-plane tools", () => {
    expect(
      prepareControlPlaneArgs("sample-codebase.mjs", [
        "--root",
        "src",
        "--json",
      ]),
    ).toEqual(["--root", "src", "--json"]);
    expect(() => prepareControlPlaneArgs("arbitrary.mjs", [])).toThrow(
      "control-plane-tool-not-allowlisted:arbitrary.mjs",
    );
  });
});
