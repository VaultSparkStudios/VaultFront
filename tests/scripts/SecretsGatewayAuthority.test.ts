import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCapabilityMapLayers } from "../../scripts/lib/secrets.mjs";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultfront-cap-map-"));
  temporaryRoots.push(root);
  return root;
}

function writeMap(
  root: string,
  name: string,
  capabilities: Record<string, unknown>,
): string {
  const target = path.join(root, name);
  fs.writeFileSync(
    target,
    JSON.stringify({ schemaVersion: 1, capabilities }),
    "utf8",
  );
  return target;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("layered secrets capability authority", () => {
  it("loads the Studio catalog when the project has no local map", () => {
    const root = temporaryRoot();
    const basePath = writeMap(root, "studio.json", {
      "cloudflare.deploy": { env: ["CLOUDFLARE_API_TOKEN"] },
    });

    const map = loadCapabilityMapLayers({
      basePath,
      overridePath: path.join(root, "absent.json"),
    });

    expect(Object.keys(map.capabilities)).toEqual(["cloudflare.deploy"]);
    expect(map._authority.override.state).toBe("absent");
  });

  it("merges project capabilities without copying or erasing the Studio catalog", () => {
    const root = temporaryRoot();
    const basePath = writeMap(root, "studio.json", {
      "cloudflare.deploy": { env: ["BASE_TOKEN"] },
      "github.org": { env: ["GH_TOKEN"] },
    });
    const overridePath = writeMap(root, "project.json", {
      "cloudflare.deploy": { env: ["PROJECT_TOKEN"] },
      "vaultfront.replay": { env: ["REPLAY_KEY"] },
    });

    const map = loadCapabilityMapLayers({ basePath, overridePath });

    expect(map.capabilities["cloudflare.deploy"].env).toEqual([
      "PROJECT_TOKEN",
    ]);
    expect(map.capabilities["github.org"].env).toEqual(["GH_TOKEN"]);
    expect(map.capabilities["vaultfront.replay"].env).toEqual(["REPLAY_KEY"]);
  });

  it("deduplicates one shared authority path", () => {
    const root = temporaryRoot();
    const sharedPath = writeMap(root, "shared.json", {
      "github.org": { env: ["GH_TOKEN"] },
    });

    const map = loadCapabilityMapLayers({
      basePath: sharedPath,
      overridePath: sharedPath,
    });

    expect(map._authority.override.state).toBe("deduplicated");
    expect(Object.keys(map.capabilities)).toEqual(["github.org"]);
  });

  it("fails closed with a typed error when either declared authority is corrupt", () => {
    const root = temporaryRoot();
    const corruptPath = path.join(root, "corrupt.json");
    fs.writeFileSync(corruptPath, "{ not-json", "utf8");

    expect(() =>
      loadCapabilityMapLayers({
        basePath: corruptPath,
        overridePath: path.join(root, "absent.json"),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CAPABILITY_MAP_CORRUPT",
        layer: "studio-ops",
      }),
    );
  });
});
