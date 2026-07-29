import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { inspectClientReachability } from "../../scripts/check-client-reachability.mjs";

const fixtures: string[] = [];

function fixture(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "vaultfront-reachability-"),
  );
  fixtures.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("client reachability contract", () => {
  test("follows static, dynamic, re-export, URL, and Vite worker-query module edges", () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "Main.ts"),
      [
        'import "./Static";',
        'export { value } from "./ReExport";',
        'void import("./Dynamic");',
        'new Worker(new URL("./Worker.ts", import.meta.url));',
        'import workerUrl from "./QueryWorker.ts?worker&url";',
        "void workerUrl;",
      ].join("\n"),
    );
    for (const name of [
      "Static",
      "ReExport",
      "Dynamic",
      "Worker",
      "QueryWorker",
    ]) {
      fs.writeFileSync(
        path.join(root, name + ".ts"),
        "export const value = 1;\n",
      );
    }

    const result = inspectClientReachability({
      entrypoints: [path.join(root, "Main.ts")],
      clientRoot: root,
    });
    expect(result).toMatchObject({
      ok: true,
      reachableModules: 6,
      clientModules: 6,
      unreachable: [],
      missingImports: [],
    });
  });

  test("reports orphan modules and unresolved source imports", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "Main.ts"), 'import "./Missing";\n');
    fs.writeFileSync(path.join(root, "Orphan.ts"), "export {};\n");

    const result = inspectClientReachability({
      entrypoints: [path.join(root, "Main.ts")],
      clientRoot: root,
    });
    expect(result.ok).toBe(false);
    expect(result.unreachable).toHaveLength(1);
    expect(result.unreachable[0]).toContain("Orphan.ts");
    expect(result.missingImports).toEqual([
      expect.objectContaining({ specifier: "./Missing" }),
    ]);
  });
});
