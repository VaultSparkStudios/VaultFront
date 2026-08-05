import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const deployableRoots = ["src", "scripts"];
const forbiddenControlPlaneTokens = [
  "portfolio/obelisk-policy.json",
  "portfolio/ops/obelisk-receipts.ndjson",
];

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|mjs)$/u.test(entry.name) ? [target] : [];
  });
}

describe("public repository boundary", () => {
  it("keeps the Studio Ops secret broker out of deployable project code", () => {
    expect(
      fs.existsSync(path.join(root, "scripts/lib/obelisk-broker.mjs")),
    ).toBe(false);

    const violations = deployableRoots
      .flatMap((directory) => sourceFiles(path.join(root, directory)))
      .flatMap((file) => {
        const source = fs.readFileSync(file, "utf8");
        return forbiddenControlPlaneTokens
          .filter((token) => source.includes(token))
          .map((token) => `${path.relative(root, file)}: ${token}`);
      });

    expect(violations).toEqual([]);
  });
});
