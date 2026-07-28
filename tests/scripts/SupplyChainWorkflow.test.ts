import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("supply-chain workflow contract", () => {
  test("CI rejects production moderate-or-higher advisories without gating on development tooling", () => {
    const workflow = fs.readFileSync(
      path.join(root, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const auditCommands = workflow.match(/npm audit[^\r\n]*/g) ?? [];

    expect(auditCommands).toEqual([
      "npm audit --omit=dev --audit-level=moderate",
    ]);
  });

  test("protobufjs remains beyond the patched denial-of-service range", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    const lock = JSON.parse(
      fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
    );

    expect(manifest.devDependencies.protobufjs).toBe("7.6.5");
    expect(lock.packages["node_modules/protobufjs"].version).toBe("7.6.5");
    expect(lock.packages["node_modules/protobufjs"].integrity).toBe(
      "sha512-/FPD0nUc9jH6rfFjji9IBqOz4pcSE3CsT1m7Ep6Mdb0LxSUMj8hgl6GomOvZzpNpAqqGaXA0P3VSrZLFzIhQrw==",
    );
  });
});
