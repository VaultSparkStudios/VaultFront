#!/usr/bin/env node
import { runControlPlaneTool } from "./lib/control-plane-tool.mjs";
process.exit(runControlPlaneTool("compute-entropy.mjs", process.argv.slice(2)));
