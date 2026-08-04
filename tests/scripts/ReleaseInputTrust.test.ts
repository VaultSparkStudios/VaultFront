import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkReleaseInputTrust } from "../../scripts/lib/release-input-trust.mjs";

function fixture(workflow: string, dockerfile = "FROM node:24-slim\n") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultfront-trust-"));
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), workflow);
  fs.writeFileSync(
    path.join(root, ".github", "workflows", "db-migrate.yml"),
    "services:\n  postgres:\n    image: postgres:16-alpine\n",
  );
  fs.writeFileSync(path.join(root, "Dockerfile"), dockerfile);
  fs.writeFileSync(
    path.join(root, "config", "release-trust-evidence.json"),
    JSON.stringify({
      schemaVersion: 1,
      containerImages: [
        {
          source: "Dockerfile",
          reference: "node:24-slim",
          status: "unresolved-external",
          reason: "registry evidence absent",
        },
        {
          source: ".github/workflows/db-migrate.yml",
          reference: "postgres:16-alpine",
          status: "unresolved-external",
          reason: "registry evidence absent",
        },
      ],
    }),
  );
  return root;
}

function pinFixture(root: string) {
  const nodeDigest = `sha256:${"a".repeat(64)}`;
  const postgresDigest = `sha256:${"b".repeat(64)}`;
  const nodeReference = `node:24-slim@${nodeDigest}`;
  const postgresReference = `postgres:16-alpine@${postgresDigest}`;
  fs.writeFileSync(path.join(root, "Dockerfile"), `FROM ${nodeReference}\n`);
  fs.writeFileSync(
    path.join(root, ".github", "workflows", "db-migrate.yml"),
    `services:\n  postgres:\n    image: ${postgresReference}\n`,
  );
  const verified = (
    source: string,
    reference: string,
    manifestDigest: string,
  ) => ({
    source,
    reference,
    status: "verified",
    registry: `docker.io/library/${reference.split(":")[0]}`,
    manifestDigest,
    sourceRepository: "https://github.com/example/official-image.git",
    sourceRevision: "c".repeat(40),
    observedAt: "2026-08-03T12:00:00.000Z",
    verification: `docker buildx imagetools inspect ${reference.split("@")[0]}`,
  });
  fs.writeFileSync(
    path.join(root, "config", "release-trust-evidence.json"),
    JSON.stringify({
      schemaVersion: 1,
      containerImages: [
        verified("Dockerfile", nodeReference, nodeDigest),
        verified(
          ".github/workflows/db-migrate.yml",
          postgresReference,
          postgresDigest,
        ),
      ],
    }),
  );
  return { nodeReference, postgresReference };
}

describe("release input trust", () => {
  it("accepts SHA-pinned actions while honestly blocking release on unresolved images", () => {
    const root = fixture(
      `steps:\n  - uses: actions/checkout@${"a".repeat(40)} # v4\n`,
    );
    expect(checkReleaseInputTrust(root)).toMatchObject({
      ok: true,
      releaseReady: false,
    });
    expect(checkReleaseInputTrust(root, { release: true }).ok).toBe(false);
  });
  it("rejects mutable actions and trust-on-first-use", () => {
    const root = fixture(
      "steps:\n  - uses: actions/checkout@v4\n  - run: ssh-keyscan host\n",
    );
    expect(checkReleaseInputTrust(root).errors).toHaveLength(2);
  });

  it("admits only digest-pinned images with matching registry provenance", () => {
    const root = fixture(
      `steps:\n  - uses: actions/checkout@${"a".repeat(40)} # v4\n`,
    );
    pinFixture(root);

    expect(checkReleaseInputTrust(root, { release: true })).toEqual({
      ok: true,
      releaseReady: true,
      errors: [],
      warnings: [],
    });

    const evidencePath = path.join(
      root,
      "config",
      "release-trust-evidence.json",
    );
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    evidence.containerImages[0].manifestDigest = `sha256:${"f".repeat(64)}`;
    fs.writeFileSync(evidencePath, JSON.stringify(evidence));
    expect(
      checkReleaseInputTrust(root, { release: true }).errors,
    ).toContainEqual(
      expect.stringContaining("lacks matching verified registry provenance"),
    );
  });
});
