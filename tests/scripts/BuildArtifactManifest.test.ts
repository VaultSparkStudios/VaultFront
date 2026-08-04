import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildArtifactManifest,
  verifyArtifactManifest,
} from "../../scripts/lib/build-artifact-manifest.mjs";

describe("build artifact manifest", () => {
  it("binds the complete sorted artifact and detects mutation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultfront-artifact-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "index.html"), "index");
    fs.writeFileSync(path.join(root, "assets", "app.js"), "app");
    const manifest = buildArtifactManifest(root, "a".repeat(40));
    expect(verifyArtifactManifest(root, manifest)).toMatchObject({ ok: true });
    fs.writeFileSync(path.join(root, "assets", "app.js"), "tampered");
    expect(verifyArtifactManifest(root, manifest)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["artifact-manifest-digest-mismatch"]),
    });
  });
});
