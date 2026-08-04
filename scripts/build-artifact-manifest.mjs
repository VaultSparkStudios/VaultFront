#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  buildArtifactManifest,
  verifyArtifactManifest,
} from "./lib/build-artifact-manifest.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const root = path.resolve(value("--root", "static"));
const output = path.resolve(value("--output", "build-artifact-manifest.json"));
const verify = args.includes("--verify");

if (verify) {
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  const result = verifyArtifactManifest(root, manifest);
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(
      `PASS artifact ${manifest.digest} (${manifest.files.length} files)`,
    );
  }
} else {
  const revision = value(
    "--revision",
    process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "unknown",
  );
  const manifest = buildArtifactManifest(root, revision);
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `WROTE ${path.relative(process.cwd(), output)} ${manifest.digest}`,
  );
}
