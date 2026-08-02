#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const status = JSON.parse(
  fs.readFileSync(path.join(ROOT, "context", "PROJECT_STATUS.json"), "utf8"),
);
const observed = Date.parse(status.ignisLastComputed ?? "");
const ageDays = Number.isFinite(observed)
  ? Math.max(0, (Date.now() - observed) / 86_400_000)
  : Number.POSITIVE_INFINITY;
if (ageDays < 7) {
  console.log(
    `✓ IGNIS score is fresh (${ageDays.toFixed(1)}d) — no rescore needed`,
  );
  process.exit(0);
}
console.error(
  "IGNIS rescore is Studio-Ops-owned and stale; ship Ark cargo instead of writing the sibling tree.",
);
process.exit(2);
