#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function inspectVaultFrontBalanceAuthority(projectRoot = root) {
  const errors = [];
  const config = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, "config/vaultfront-balance.v1.json"),
      "utf8",
    ),
  );
  const envelope = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, "public/balance-envelope.json"),
      "utf8",
    ),
  );
  const sources = {
    runtime: fs.readFileSync(
      path.join(projectRoot, "src/core/execution/VaultFrontRuntimeBalance.ts"),
      "utf8",
    ),
    execution: fs.readFileSync(
      path.join(projectRoot, "src/core/execution/VaultFrontExecution.ts"),
      "utf8",
    ),
    bot: fs.readFileSync(
      path.join(projectRoot, "src/core/execution/BotExecution.ts"),
      "utf8",
    ),
    nation: fs.readFileSync(
      path.join(projectRoot, "src/core/execution/NationExecution.ts"),
      "utf8",
    ),
    controlPanel: fs.readFileSync(
      path.join(projectRoot, "src/client/graphics/layers/ControlPanel.ts"),
      "utf8",
    ),
  };

  if (!config.gameplay || typeof config.gameplay !== "object") {
    errors.push("versioned authority has no gameplay projection");
  }
  const literalReadonly =
    /\bprivate readonly [A-Za-z0-9_]+\s*=\s*(?:\d[\d_]*(?:\.\d+)?n?)\s*;/g;
  const embedded = [...sources.execution.matchAll(literalReadonly)].map(
    (match) => match[0],
  );
  if (embedded.length > 0) {
    errors.push(
      `VaultFrontExecution has embedded readonly tuning: ${embedded.join(", ")}`,
    );
  }

  const consumers = Object.values(sources).join("\n");
  for (const section of Object.keys(config.gameplay ?? {})) {
    if (
      !consumers.includes(`DEFAULT_VAULT_GAMEPLAY_BALANCE.${section}`) &&
      !sources.execution.includes(`this.balance.${section}`) &&
      !sources.execution.includes(`this.tuning.gameplay.${section}`) &&
      !sources.runtime.includes(`gameplay.${section}`)
    ) {
      errors.push(`gameplay section has no executable consumer: ${section}`);
    }
  }
  for (const [name, source] of Object.entries(sources)) {
    if (/(?:115_000|115000)n?/.test(source)) {
      errors.push(`${name} duplicates the Jam Breaker gold cost`);
    }
  }
  if (
    envelope.authorityFingerprint !== envelope.tuningDigest ||
    !/^sha256:[0-9a-f]{64}$/.test(envelope.authorityFingerprint ?? "")
  ) {
    errors.push("public balance envelope fingerprint is absent or divergent");
  }
  if (
    JSON.stringify(envelope.gameplayRules) !== JSON.stringify(config.gameplay)
  ) {
    errors.push("public gameplay rules diverge from the versioned authority");
  }
  if (
    !fs
      .readFileSync(
        path.join(projectRoot, "scripts/generate-release-evidence.mjs"),
        "utf8",
      )
      .includes("config/vaultfront-balance.v1.json")
  ) {
    errors.push("release evidence does not bind the balance authority source");
  }
  return {
    ok: errors.length === 0,
    authority: config.authority,
    gameplaySections: Object.keys(config.gameplay ?? {}),
    authorityFingerprint: envelope.authorityFingerprint ?? null,
    errors,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = inspectVaultFrontBalanceAuthority();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
