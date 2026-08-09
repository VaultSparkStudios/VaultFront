#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// S99 audit #188: Worker.ts and WinModal.ts both proved the line-budget-ratchet
// pattern stops god-object files from silently regrowing after being trimmed.
// ControlPanel.ts is mid-extraction (see the open #185 follow-up) and was the
// largest ungoverned client file with zero enforced budget; this registry closes
// that gap for it and its similarly-ungoverned siblings. Api.ts is intentionally
// excluded here -- it was under concurrent edit by a parallel #187 agent when
// this ratchet was written; add it in a follow-up once that work lands.
export const CLIENT_FILE_BUDGETS = [
  {
    file: "src/client/graphics/layers/ControlPanel.ts",
    lineBudget: 3560,
  },
  {
    file: "src/client/graphics/layers/GameRightSidebar.ts",
    lineBudget: 1600,
  },
  {
    file: "src/client/graphics/layers/RadialMenu.ts",
    lineBudget: 1545,
  },
  {
    file: "src/client/graphics/layers/VaultFrontLayer.ts",
    lineBudget: 2120,
  },
];

export function inspectClientComposition(root = process.cwd()) {
  const files = CLIENT_FILE_BUDGETS.map(({ file, lineBudget }) => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const lines = source.split(/\r?\n/).length;
    return { file, lines, lineBudget };
  });
  const errors = files
    .filter(({ lines, lineBudget }) => lines > lineBudget)
    .map(
      ({ file, lines, lineBudget }) =>
        `${path.basename(file)} line budget exceeded: ${lines}/${lineBudget}`,
    );
  return { ok: errors.length === 0, files, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = inspectClientComposition();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
