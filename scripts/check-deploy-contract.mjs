#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "./lib/safe-spawn.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASH =
  process.platform === "win32" &&
  fs.existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
    ? "C:\\Program Files\\Git\\bin\\bash.exe"
    : "bash";
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const failures = [];
let checks = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) failures.push(message);
};
const requireText = (body, pattern, message) =>
  check(pattern.test(body), message);

const deploy = read("deploy.sh");
const update = read("update.sh");
const buildDeploy = read("build-deploy.sh");
const deployWorkflow = read(".github/workflows/deploy.yml");
const e2eWorkflow = read(".github/workflows/e2e.yml");
const promoteWorkflow = read(".github/workflows/promote.yml");
const prWorkflow = read(".github/workflows/pr-description.yml");
const runbook = read("docs/DEPLOY_RUNTIME_RUNBOOK.md");
const dockerfile = read("Dockerfile");
const dockerignore = read(".dockerignore");
const supervisor = read("supervisord.conf");
const serverEntrypoint = read("src/server/Server.ts");
const worker = read("src/server/Worker.ts");
const releaseEvidenceContract = read("src/server/ReleaseEvidenceContract.ts");
const releaseGateWrapper = read("src/shared/ReleaseGateCatalog.ts");
const releaseGateAuthority = read("src/shared/release-gate-catalog.mjs");
const releaseEvidenceGenerator = read("scripts/generate-release-evidence.mjs");
const promotionReceipt = read("scripts/lib/promotion-receipt.mjs");
const promotionReceiptCli = read("scripts/promotion-receipt.mjs");

check(
  !fs.existsSync(path.join(ROOT, ".github/workflows/release.yml")),
  "dormant legacy release.yml still exists",
);
for (const [name, body] of [
  ["deploy workflow", deployWorkflow],
  ["promote workflow", promoteWorkflow],
]) {
  check(
    !/openfront|falk2|deploy-alpha|deploy-beta/iu.test(body),
    `${name} retains an upstream infrastructure target`,
  );
}
requireText(deploy, /DEPLOY_DRY_RUN/u, "deploy.sh has no dry-run path");
requireText(
  deploy,
  /\^sha256:\[0-9a-f\]\{64\}\$/u,
  "deploy.sh does not validate immutable digests",
);
for (const [name, body] of [
  ["deploy workflow", deployWorkflow],
  ["promote workflow", promoteWorkflow],
]) {
  requireText(
    body,
    /DEPLOY_HEALTH_URL:.*FQDN.*\/_health/u,
    name + " does not probe the canonical /_health route",
  );
  check(
    !body.includes("/api/health"),
    name + " retains the obsolete /api/health route",
  );
}
requireText(
  e2eWorkflow,
  /node-version:\s*["']22["']/u,
  "E2E does not pin the supported Node 22 runtime",
);
for (const prerequisite of [
  "pkg-config",
  "libcairo2-dev",
  "libpango1.0-dev",
  "libjpeg-dev",
  "libgif-dev",
  "librsvg2-dev",
  "libpixman-1-dev",
]) {
  check(
    e2eWorkflow.includes(prerequisite),
    "E2E bootstrap omits native prerequisite " + prerequisite,
  );
}
check(
  e2eWorkflow.indexOf("Provision native canvas build prerequisites") <
    e2eWorkflow.indexOf("- run: npm ci"),
  "E2E installs dependencies before native build prerequisites",
);

requireText(
  deploy,
  /DEPLOY_STAGING_ATTESTATION/u,
  "production has no staging attestation gate",
);
requireText(
  buildDeploy,
  /containerimage\.digest/u,
  "build wrapper does not consume the build digest",
);
requireText(
  update,
  /DEPLOY_IMAGE_RETENTION/u,
  "remote updater has no bounded retention input",
);
check(
  !/docker\s+image\s+prune\s+-a/u.test(update),
  "remote updater still prunes every unused image",
);
requireText(
  prWorkflow,
  /dependabot\[bot\]/u,
  "PR workflow lacks a trusted automation identity contract",
);
requireText(
  prWorkflow,
  /pulls\.listFiles/u,
  "automation PRs are not restricted by changed-file scope",
);
requireText(
  prWorkflow,
  /ref:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/u,
  "PR validator is not checked out from the trusted base SHA",
);
requireText(
  prWorkflow,
  /persist-credentials:\s*false/u,
  "trusted-base checkout retains write credentials",
);
requireText(
  prWorkflow,
  /scripts\/lib\/dependabot-pr-contract\.cjs/u,
  "PR workflow does not load the repository-owned machine contract",
);
requireText(
  promoteWorkflow,
  /staging_run_id/u,
  "promotion lacks run-bound staging evidence",
);
requireText(
  promoteWorkflow,
  /staging-attestation\.mjs verify/u,
  "promotion does not verify the staging attestation",
);
for (const [pattern, failure] of [
  [/validation_run_id/u, "live promotion has no prior dry-run receipt input"],
  [
    /promotion-validation-\$\{\{ github\.run_id \}\}/u,
    "dry-run receipt is not retained by run ID",
  ],
  [/verify-validation/u, "live promotion does not verify dry-run intent"],
  [/replaced_staging_run_id/u, "rollback does not admit the replaced revision"],
  [
    /steps\.replaced_attestation\.outputs\.attestation_digest/u,
    "rollback receipt omits replaced attestation lineage",
  ],
  [
    /promotion-outcome-\$\{\{ github\.run_id \}\}/u,
    "production outcome receipt is not retained by run ID",
  ],
  [/verify-outcome/u, "production outcome receipt is not self-verified"],
  [/retention-days:\s*90/u, "operator receipts lack bounded 90-day retention"],
]) {
  requireText(promoteWorkflow, pattern, failure);
}
requireText(
  promotionReceipt,
  /timingSafeEqual/u,
  "promotion receipt digest comparison is not constant-time",
);
requireText(
  promotionReceipt,
  /production-revision-mismatch/u,
  "promotion receipt does not bind the observed production revision",
);
requireText(
  promotionReceiptCli,
  /create-validation\|verify-validation\|create-outcome\|verify-outcome/u,
  "promotion receipt CLI does not expose the complete lifecycle",
);
check(
  !/inputs\.image_digest|inputs\.staging_evidence_digest/u.test(
    promoteWorkflow,
  ),
  "promotion still accepts caller-authored digests",
);
for (const [name, body] of [
  ["deploy workflow", deployWorkflow],
  ["promote workflow", promoteWorkflow],
]) {
  requireText(
    body,
    /DEPLOY_KNOWN_HOSTS/u,
    `${name} lacks protected SSH host evidence`,
  );
  check(
    !/ssh-keyscan/u.test(body),
    `${name} retains trust-on-first-use ssh-keyscan`,
  );
  requireText(
    body,
    /DATABASE_URL/u,
    `${name} does not transport durable persistence`,
  );
}
requireText(
  deploy,
  /DATABASE_URL:\?DATABASE_URL is required/u,
  "deploy transport does not require DATABASE_URL",
);
requireText(
  update,
  /apply-schema\.ts/u,
  "remote updater does not migrate before traffic",
);
check(
  update.includes("traefik.http.routers.${CONTAINER_NAME}.rule"),
  "remote updater does not declare Traefik as the container ingress authority",
);
requireText(
  dockerfile,
  /ENTRYPOINT ["\/usr\/bin\/supervisord", "-c", "\/etc\/supervisor\/conf.d\/supervisord.conf"]/u,
  "production image does not start Supervisor directly",
);
requireText(
  dockerfile,
  /HEALTHCHECK[^\n]*127.0.0.1\/_health/u,
  "production image has no local canonical healthcheck",
);
check(
  (dockerfile.match(/COPY src \.\/src/gu) ?? []).length >= 2,
  "build and production images do not both package the src runtime tree",
);
requireText(
  dockerfile,
  /COPY scripts\/? \.\/scripts\/?/u,
  "build image does not package release-evidence generator scripts",
);
for (const source of [
  ".bundlewatch.json",
  "Dockerfile supervisord.conf update.sh",
  ".github",
  "config",
  "context",
  "docs",
]) {
  check(
    dockerfile.includes("COPY " + source),
    "build image does not package release-evidence input: " + source,
  );
}
requireText(
  dockerignore,
  /^!Dockerfile$/mu,
  "Dockerfile remains unavailable to the release-evidence build stage",
);
check(
  !fs.existsSync(path.join(ROOT, "scripts/lib/release-gate-catalog.mjs")),
  "duplicate scripts/lib release-gate authority still exists",
);
for (const relativePath of [
  "src/shared/release-gates.json",
  "src/shared/release-gate-catalog.mjs",
  "src/shared/ReleaseGateCatalog.ts",
]) {
  check(
    fs.existsSync(path.join(ROOT, relativePath)),
    `packaged release-gate authority is missing ${relativePath}`,
  );
}
requireText(
  releaseGateAuthority,
  /require\("\.\/release-gates\.json"\)/u,
  "executable release-gate authority does not consume its colocated data catalog",
);
requireText(
  releaseGateWrapper,
  /from "\.\/release-gate-catalog\.mjs"/u,
  "typed release-gate wrapper does not consume the packaged executable authority",
);
requireText(
  releaseEvidenceGenerator,
  /from "\.\.\/src\/shared\/release-gate-catalog\.mjs"/u,
  "release evidence generator does not consume the packaged executable authority",
);
requireText(
  serverEntrypoint,
  /from "\.\/Worker"/u,
  "server entrypoint does not retain the worker runtime import",
);
requireText(
  worker,
  /from "\.\/VaultFrontReadiness"/u,
  "worker runtime does not retain release-readiness reachability",
);
requireText(
  releaseEvidenceContract,
  /from "\.\.\/shared\/ReleaseGateCatalog"/u,
  "server release contract does not consume the packaged typed authority",
);
check(
  !fs.existsSync(path.join(ROOT, "startup.sh")),
  "legacy runtime tunnel/DNS mutation entrypoint still exists",
);
for (const [name, body] of [
  ["Dockerfile", dockerfile],
  ["Supervisor config", supervisor],
]) {
  check(
    !/cloudflared|CF_API_TOKEN|CF_ACCOUNT_ID|CLOUDFLARE_TUNNEL_TOKEN/u.test(
      body,
    ),
    `${name} still owns Cloudflare tunnel or DNS credentials`,
  );
}
requireText(
  supervisor,
  /[program:nginx][sS]*[program:node]/u,
  "Supervisor does not own the bounded Nginx + Node process set",
);

requireText(
  runbook,
  /Deploy staging\*\* workflow is staging-only/iu,
  "runbook does not state that deploy.yml is staging-only",
);
requireText(
  runbook,
  /`staging_run_id`/u,
  "runbook omits the admitted staging run input",
);
requireText(
  runbook,
  /`dry_run`: `true`/u,
  "runbook does not require dry-run-first promotion",
);
check(
  !/`image_tag`/u.test(runbook),
  "runbook still documents the obsolete mutable image_tag input",
);
requireText(
  runbook,
  /\/_health/u,
  "runbook omits canonical health verification",
);
requireText(
  runbook,
  /### Rollback receipt/u,
  "runbook has no auditable rollback receipt contract",
);
requireText(
  runbook,
  /`validation_run_id`/u,
  "runbook does not require the exact successful dry-run receipt",
);
requireText(
  runbook,
  /promotion-outcome-<run-id>/u,
  "runbook does not name the retained outcome receipt",
);
requireText(
  runbook,
  /Traefik is the sole runtime ingress authority/u,
  "runbook does not declare the single ingress authority",
);
check(
  !/Configure Caddy|cloudflared tunnel create/u.test(runbook),
  "runbook still instructs a second ingress authority",
);

for (const script of ["build-deploy.sh", "deploy.sh", "update.sh"]) {
  const syntax = spawnSync(BASH, ["-n", script], {
    cwd: ROOT,
    encoding: "utf8",
  });
  check(
    syntax.status === 0,
    `${script} failed bash -n: ${String(syntax.stderr).trim()}`,
  );
}

const digest = `sha256:${"0".repeat(64)}`;
const baseEnv = {
  ...process.env,
  DEPLOY_DRY_RUN: "1",
  DEPLOY_HEALTH_URL: "https://staging.example.test/_health",
  GHCR_REPO: "vaultfront",
  GHCR_USERNAME: "vaultsparkstudios",
};
const dryRun = spawnSync(
  BASH,
  ["deploy.sh", "staging", "staging", digest, "staging"],
  { cwd: ROOT, encoding: "utf8", env: baseEnv },
);
check(
  dryRun.status === 0 && /deploy-contract ok/u.test(String(dryRun.stdout)),
  `staging dry-run failed: ${String(dryRun.stderr).trim()}`,
);
const mutable = spawnSync(
  BASH,
  ["deploy.sh", "staging", "staging", "latest", "staging"],
  { cwd: ROOT, encoding: "utf8", env: baseEnv },
);
check(mutable.status !== 0, "mutable image tag passed deploy validation");
const mismatch = spawnSync(
  BASH,
  ["deploy.sh", "prod", "primary", digest, "main"],
  {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...baseEnv,
      DEPLOY_STAGING_ATTESTATION: `sha256:${"1".repeat(64)}`,
    },
  },
);
check(mismatch.status !== 0, "production accepted mismatched staging evidence");

const report = {
  ok: failures.length === 0,
  source: "scripts/check-deploy-contract.mjs",
  checks,
  failures,
};
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else if (report.ok) {
  console.log(
    `PASS immutable deploy/workflow/runbook contract (${checks} checks)`,
  );
} else {
  failures.forEach((failure) => console.error(`FAIL ${failure}`));
}
process.exit(report.ok ? 0 : 1);
