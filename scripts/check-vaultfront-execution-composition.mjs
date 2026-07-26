#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Session 84 moved all gameplay tuning and mutator projection out of the
// simulation root, reducing it from 2,917 to 2,907 formatter-stable lines.
// This exact ceiling prevents either state or balance policy from accreting back.
export const EXECUTION_LINE_BUDGET = 2907;
const REQUIRED_KERNEL_CALLS = [
  "deliverToVaultPressure(",
  "expireVaultPressureWindow(",
  "projectVaultPressure(",
];
const FORBIDDEN_EMBEDDED_STATE = [
  "private vaultPressure =",
  "private breachWindowUntilTick =",
  "private readonly vaultPressureThreshold",
  "private readonly breachWindowDurationTicks",
];

export function inspectVaultFrontExecutionComposition(root = process.cwd()) {
  const source = fs.readFileSync(
    path.join(root, "src", "core", "execution", "VaultFrontExecution.ts"),
    "utf8",
  );
  const kernel = fs.readFileSync(
    path.join(root, "src", "core", "execution", "VaultPressureKernel.ts"),
    "utf8",
  );
  const lines = source.split(/\r?\n/).length;
  const errors = [];
  if (lines > EXECUTION_LINE_BUDGET) {
    errors.push(
      `VaultFrontExecution.ts line budget exceeded: ${lines}/${EXECUTION_LINE_BUDGET}`,
    );
  }
  for (const call of REQUIRED_KERNEL_CALLS) {
    if (!source.includes(call))
      errors.push(`missing pressure kernel composition call: ${call}`);
  }
  for (const token of FORBIDDEN_EMBEDDED_STATE) {
    if (source.includes(token))
      errors.push(`embedded pressure state returned: ${token}`);
  }
  if (!kernel.includes('type: "vault-breach-victory"')) {
    errors.push("pressure kernel does not own the victory event contract");
  }
  return {
    ok: errors.length === 0,
    execution: { lines, budget: EXECUTION_LINE_BUDGET },
    errors,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = inspectVaultFrontExecutionComposition();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
