#!/usr/bin/env node
import { runControlPlaneTool } from "./lib/control-plane-tool.mjs";
process.exit(
  runControlPlaneTool("render-state-vector.mjs", process.argv.slice(2)),
);
