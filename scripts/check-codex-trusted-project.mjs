#!/usr/bin/env node
/**
 * check-codex-trusted-project.mjs
 *
 * Verifies that Codex will load project-local config, hooks, and exec policies
 * for this repo. Codex's warning names the exact trusted-project key it needs,
 * so this probe checks that path shape directly instead of assuming equivalent
 * parent or extended-length Windows paths are accepted.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function stripExtendedWindowsPrefix(value) {
  return value.replace(/^\\\\\?\\/, "");
}

export function codexTrustedProjectKey(projectRoot = ROOT) {
  const resolved = stripExtendedWindowsPrefix(path.resolve(projectRoot));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function trustedProjectBlock(projectKey) {
  return `[projects.'${projectKey}']\ntrust_level = "trusted"\n`;
}

export function findProjectSection(configText, projectKey) {
  const sectionRe = new RegExp(
    `^\\[projects\\.'${escapeRegExp(projectKey)}'\\]\\s*$`,
    "mi",
  );
  const match = sectionRe.exec(configText);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = configText.slice(start);
  const next = rest.search(/^\[/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  return {
    headerStart: match.index,
    bodyStart: start,
    bodyEnd: next === -1 ? configText.length : start + next,
    body,
  };
}

export function isTrustedProject(configText, projectKey) {
  const section = findProjectSection(configText, projectKey);
  if (section === null) return false;
  return /^[ \t]*trust_level\s*=\s*"trusted"\s*$/im.test(section.body);
}

export function ensureTrustedProjectText(configText, projectKey) {
  if (isTrustedProject(configText, projectKey))
    return { changed: false, text: configText };
  const section = findProjectSection(configText, projectKey);
  if (!section) {
    const prefix = configText.trimEnd();
    const text = `${prefix}${prefix ? "\n\n" : ""}${trustedProjectBlock(projectKey)}`;
    return { changed: true, text };
  }

  const body = section.body;
  const trustLine = /^[ \t]*trust_level\s*=\s*"[^"]*"\s*$/im.exec(body);
  if (trustLine) {
    const bodyNext = `${body.slice(0, trustLine.index)}trust_level = "trusted"${body.slice(trustLine.index + trustLine[0].length)}`;
    return {
      changed: true,
      text: `${configText.slice(0, section.bodyStart)}${bodyNext}${configText.slice(section.bodyEnd)}`,
    };
  }
  const insertion = section.body.endsWith("\n")
    ? 'trust_level = "trusted"\n'
    : '\ntrust_level = "trusted"\n';
  return {
    changed: true,
    text: `${configText.slice(0, section.bodyEnd)}${insertion}${configText.slice(section.bodyEnd)}`,
  };
}

export function ensureTrustedProjectFile(projectRoot = ROOT, opts = {}) {
  const configPath =
    opts.configPath || path.join(os.homedir(), ".codex", "config.toml");
  const requiredKey = codexTrustedProjectKey(projectRoot);
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch {
    text = "";
  }
  const next = ensureTrustedProjectText(text, requiredKey);
  if (next.changed) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, next.text, "utf8");
  }
  return {
    ok: true,
    changed: next.changed,
    configPath,
    requiredKey,
    reason: next.changed
      ? `trusted project written: ${requiredKey}`
      : `trusted project already present: ${requiredKey}`,
  };
}

export function run(projectRoot = ROOT, opts = {}) {
  const configPath =
    opts.configPath || path.join(os.homedir(), ".codex", "config.toml");
  const requiredKey = codexTrustedProjectKey(projectRoot);
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch {
    return {
      ok: false,
      configPath,
      requiredKey,
      reason: `missing Codex config: ${configPath}`,
      remediation: `node scripts/check-codex-trusted-project.mjs --fix`,
    };
  }

  const ok = isTrustedProject(text, requiredKey);
  return {
    ok,
    configPath,
    requiredKey,
    reason: ok
      ? `trusted project present: ${requiredKey}`
      : `missing [projects.'${requiredKey}'] trust_level = "trusted" in ${configPath}`,
    remediation: ok
      ? null
      : `node scripts/check-codex-trusted-project.mjs --fix`,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const json = process.argv.includes("--json");
  const fix = process.argv.includes("--fix");
  const result = fix ? ensureTrustedProjectFile(ROOT) : run(ROOT);
  if (json) console.log(JSON.stringify(result, null, 2));
  else
    console.log(
      `${result.ok ? "OK" : "WARN"} codex-trusted-project · ${result.reason}`,
    );
  process.exit(result.ok ? 0 : 1);
}
