#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "./lib/safe-spawn.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/u;
const TYPE = /^(?<type>[a-z]+)(?:\([^\r\n()]+\))?(?<breaking>!)?:\s/u;
const PATCH_TYPES = new Set(["fix", "perf", "revert", "security"]);
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

export function parseSemanticTag(tag) {
  const match = String(tag ?? "")
    .trim()
    .match(SEMVER_TAG);
  if (!match) throw new Error(`invalid-semantic-tag:${tag}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function classifyConventionalCommit(message) {
  const body = String(message ?? "").trim();
  const subject = body.split(/\r?\n/u, 1)[0] ?? "";
  const match = subject.match(TYPE);
  if (
    match?.groups?.breaking === "!" ||
    /(?:^|\r?\n)BREAKING[ -]CHANGE:\s/u.test(body)
  ) {
    return "major";
  }
  if (match?.groups?.type === "feat") return "minor";
  if (PATCH_TYPES.has(match?.groups?.type ?? "")) return "patch";
  return "none";
}

function bump(version, level) {
  if (level === "major")
    return { major: version.major + 1, minor: 0, patch: 0 };
  if (level === "minor")
    return { major: version.major, minor: version.minor + 1, patch: 0 };
  return { ...version, patch: version.patch + 1 };
}

export function planGithubRelease({ latestTag = "", commits = [] }) {
  const base = latestTag
    ? parseSemanticTag(latestTag)
    : { major: 0, minor: 0, patch: 0 };
  const classifications = commits.map(classifyConventionalCommit);
  const level = classifications.reduce(
    (highest, current) => (RANK[current] > RANK[highest] ? current : highest),
    "none",
  );
  const shouldRelease = level !== "none";
  const next = shouldRelease ? bump(base, level) : base;
  const tag = `v${next.major}.${next.minor}.${next.patch}`;
  return {
    schemaVersion: 1,
    shouldRelease,
    level,
    baseTag: latestTag,
    tag,
    title: `VaultFront ${tag}`,
    commitCount: commits.length,
    releaseCommitCount: classifications.filter((item) => item !== "none")
      .length,
  };
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `git-${args[0]}-failed:${String(result.stderr ?? "").trim()}`,
    );
  }
  return String(result.stdout ?? "");
}

function liveInputs() {
  const latestTag =
    git(["tag", "--list", "v[0-9]*", "--sort=-v:refname"])
      .split(/\r?\n/u)
      .map((tag) => tag.trim())
      .find((tag) => SEMVER_TAG.test(tag)) ?? "";
  const range = latestTag ? `${latestTag}..HEAD` : "HEAD";
  const commits = git(["log", "--format=%B%x1e", range])
    .split("\x1e")
    .map((message) => message.trim())
    .filter(Boolean);
  return { latestTag, commits };
}

function githubOutput(plan) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  const entries = {
    should_release: String(plan.shouldRelease),
    level: plan.level,
    base_tag: plan.baseTag,
    tag: plan.tag,
    title: plan.title,
  };
  fs.appendFileSync(
    output,
    Object.entries(entries)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const plan = planGithubRelease(liveInputs());
  if (!/^v\d+\.\d+\.\d+$/u.test(plan.tag))
    throw new Error("unsafe-release-tag");
  if (!/^VaultFront v\d+\.\d+\.\d+$/u.test(plan.title))
    throw new Error("unsafe-release-title");
  githubOutput(plan);
  console.log(JSON.stringify(plan, null, 2));
}
