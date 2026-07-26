#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Session 82 convergence floor: the root is 3,108 physical lines after the
// experiment and season-pass extractions. Twenty-two lines make growth explicit.
export const WORKER_LINE_BUDGET = 3130;
export const ROUTER_LINE_BUDGET = 180;

export const EXTRACTED_DOMAINS = [
  {
    router: "AchievementRouter.ts",
    registration: "registerAchievementRoutes",
    forbiddenInWorker: "/api/vaultfront/achievements/:persistentId",
  },
  {
    router: "SeasonContractRouter.ts",
    registration: "registerSeasonContractRoutes",
    forbiddenInWorker: "/api/vaultfront/contracts",
  },
  {
    router: "LoopEvidenceRouter.ts",
    registration: "registerLoopEvidenceRoutes",
    forbiddenInWorker: "/api/vaultfront/funnel",
  },
  {
    router: "PredictionLeagueRouter.ts",
    registration: "registerPredictionLeagueRoutes",
    forbiddenInWorker: "/api/vaultfront/prediction-league",
  },
  {
    router: "RematchRouter.ts",
    registration: "registerRematchRoutes",
    forbiddenInWorker: "/api/rematch/:gameId",
  },
  {
    router: "ExperimentRouter.ts",
    registration: "registerExperimentRoutes",
    forbiddenInWorker: "/api/vaultfront/ab/dock",
    lineBudget: 750,
  },
  {
    router: "SeasonPassRouter.ts",
    registration: "registerSeasonPassRoutes",
    forbiddenInWorker: "/api/vaultfront/season-progress",
    lineBudget: 130,
  },
  {
    router: "CertifiedOutcomeRouter.ts",
    registration: "registerCertifiedOutcomeRoutes",
    forbiddenInWorker: "/api/vaultfront/style-history",
    lineBudget: 100,
  },
  {
    router: "MatchFeedbackRouter.ts",
    registration: "registerMatchFeedbackRoutes",
    forbiddenInWorker: "/api/admin/match-ratings",
    lineBudget: 180,
  },
];

const lineCount = (source) => source.split(/\r?\n/).length;

export function inspectWorkerComposition(root = process.cwd()) {
  const serverDir = path.join(root, "src", "server");
  const worker = fs.readFileSync(path.join(serverDir, "Worker.ts"), "utf8");
  const errors = [];
  const workerLines = lineCount(worker);
  if (workerLines > WORKER_LINE_BUDGET) {
    errors.push(
      `Worker.ts line budget exceeded: ${workerLines}/${WORKER_LINE_BUDGET}`,
    );
  }
  const routers = EXTRACTED_DOMAINS.map((domain) => {
    const source = fs.readFileSync(path.join(serverDir, domain.router), "utf8");
    const lines = lineCount(source);
    const budget = domain.lineBudget ?? ROUTER_LINE_BUDGET;
    if (lines > budget) {
      errors.push(`${domain.router} line budget exceeded: ${lines}/${budget}`);
    }
    if (!worker.includes(domain.registration)) {
      errors.push(`Worker.ts does not compose ${domain.registration}`);
    }
    if (worker.includes(domain.forbiddenInWorker)) {
      errors.push(
        `Worker.ts reclaimed extracted route ${domain.forbiddenInWorker}`,
      );
    }
    return { file: domain.router, lines, budget };
  });
  return {
    ok: errors.length === 0,
    worker: { lines: workerLines, budget: WORKER_LINE_BUDGET },
    routers,
    routerBudget: ROUTER_LINE_BUDGET,
    errors,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = inspectWorkerComposition();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
