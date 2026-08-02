#!/usr/bin/env node
import { runControlPlaneTool } from "./lib/control-plane-tool.mjs";
process.exit(
  runControlPlaneTool("append-genome-snapshot.mjs", process.argv.slice(2)),
);
