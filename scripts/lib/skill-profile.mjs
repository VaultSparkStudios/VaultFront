#!/usr/bin/env node
import { runControlPlaneTool } from "./control-plane-tool.mjs";

process.exit(
  runControlPlaneTool("lib/skill-profile.mjs", process.argv.slice(2)),
);
