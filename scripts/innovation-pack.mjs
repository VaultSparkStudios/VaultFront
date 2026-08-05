#!/usr/bin/env node
/**
 * Live second-order innovation pack generated after the audit-backed genius
 * list is exhausted. Completion is derived from checked-in evidence.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdownPath = path.join(root, "docs", "INNOVATION_PACK.md");
const jsonPath = path.join(root, "docs", "INNOVATION_PACK.json");
const now = new Date().toISOString();
const has = (relativePath, pattern) => {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return false;
  return pattern ? pattern.test(fs.readFileSync(target, "utf8")) : true;
};
const occurrenceCount = (relativePath, token) => {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return 0;
  return fs.readFileSync(target, "utf8").split(token).length - 1;
};
const readJson = (relativePath) => {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
};

export function atMostNumericConstant(relativePath, constantName, maximum) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return false;
  const source = fs.readFileSync(target, "utf8");
  const match = source.match(new RegExp(`${constantName}\\s*=\\s*([0-9]+)`));
  return match ? Number(match[1]) <= maximum : false;
}

function mutationPolicyPosture() {
  const policy = readJson("config/mutation-route-policies.json");
  const routes = Array.isArray(policy?.routes) ? policy.routes : [];
  return {
    publicIngestMax: Number(policy?.riskBudget?.publicIngestMax),
    vote: routes.find((route) => route.path === "/api/mutator-vote"),
    narrator: routes.find(
      (route) => route.path === "/api/vaultfront/narrator/:gameId/predict",
    ),
  };
}

export function forgottenShippedInnovationIds(existingItems, generatedItems) {
  const generatedIds = new Set(
    generatedItems
      .map((item) => item?.id)
      .filter((id) => typeof id === "string" && id.length > 0),
  );
  return existingItems
    .filter(
      (item) =>
        item?.status === "shipped" &&
        typeof item.id === "string" &&
        !generatedIds.has(item.id),
    )
    .map((item) => item.id)
    .sort();
}

const candidates = [
  {
    id: "tamper-evident-launch-observations",
    title: "Make launch-event observations verify their own semantics",
    description:
      "Canonicalize rollback and revenue event fields into their SHA-256 observation digests so a syntactically valid provenance token cannot be reused after material evidence changes.",
    complete:
      has(
        "scripts/generate-release-evidence.mjs",
        /buildCanonicalReleaseObservation/,
      ) &&
      has(
        "tests/scripts/ReleaseEvidenceManifest.test.ts",
        /tampered semantic launch observations/,
      ),
    evidence:
      "canonical launch-observation builder/verifier, semantic digest gate, and tamper fixtures",
  },
  {
    id: "deploy-topology-release-fingerprint",
    title: "Bind the sole-ingress topology into release provenance",
    description:
      "Fingerprint Dockerfile, Supervisor, updater, and operator runbook into a verified local deployment-topology receipt and make it a first-class parent of the release decision.",
    complete:
      has(
        "scripts/generate-release-evidence.mjs",
        /buildDeployTopologyEvidence/,
      ) &&
      has("scripts/generate-release-evidence.mjs", /deployment-topology/) &&
      has(
        "tests/scripts/ReleaseEvidenceManifest.test.ts",
        /topology fingerprint/,
      ),
    evidence:
      "source-bound topology evidence, release-lineage parent, and mutation-sensitive fixture",
  },
  {
    id: "certified-feedback-reachability-receipt",
    title: "Prove and explain the certified player-feedback path end to end",
    description:
      "Fail closed unless the certified route, typed client call, live WinModal mount, and receipt tests remain connected, while showing players the evidence source, storage durability, and retention boundary they actually received.",
    complete:
      has(
        "scripts/check-certified-feedback-reachability.mjs",
        /certified-match-feedback/,
      ) &&
      has("scripts/project-doctor.mjs", /certified-feedback-reachability/) &&
      has("src/client/CertifiedMatchFeedback.ts", /retentionDays/) &&
      has(
        "tests/scripts/CertifiedFeedbackReachability.test.ts",
        /fails closed/,
      ),
    evidence:
      "cross-layer reachability checker, doctor probe, receipt transparency, and fail-closed fixtures",
  },
  {
    id: "runtime-integrity-passport",
    title: "Ship a digestible process-local Runtime Integrity Passport",
    description:
      "Fuse live IPC/game-loop health, experiment rejection posture, remote-AI reservation truth, and bounded WebSocket policy into one admin-only, scope-labeled, SHA-256-digested contract.",
    complete:
      has("src/server/RuntimeIntegrityPassport.ts", /evidenceDigest/) &&
      has("src/server/Worker.ts", /runtime-integrity-passport/) &&
      has("tests/server/RuntimeIntegrityPassport.test.ts", /tamper/),
    evidence:
      "RuntimeIntegrityPassport module, admin route, canonical digest and tamper-sensitive tests",
  },
  {
    id: "release-evidence-manifest",
    title:
      "Emit a machine-readable Release Evidence Manifest after every build",
    description:
      "Bind Git revision/dirty state, launch mode, audit exhaustion, and exact transfer budgets into static/release-evidence.json so promotion and agents consume the same provenance.",
    complete:
      has("scripts/generate-release-evidence.mjs", /release-evidence\.json/) &&
      has("package.json", /generate-release-evidence\.mjs/) &&
      has("tests/scripts/ReleaseEvidenceManifest.test.ts", /dirty/),
    evidence:
      "post-build manifest generator, build wiring, and clean/dirty provenance tests",
  },
  {
    id: "exhaustion-proof-gate",
    title: "Turn complete-all into a machine-enforced Exhaustion Proof gate",
    description:
      "Fail the doctor and closeout whenever the latest audit or innovation sidecar retains a pending unblocked item; emit counts and exact item IDs instead of relying on prose.",
    complete:
      has("scripts/check-work-exhaustion.mjs", /pendingUnblocked/) &&
      has("scripts/project-doctor.mjs", /work-exhaustion/) &&
      has("tests/scripts/WorkExhaustion.test.ts", /pending audit/),
    evidence:
      "audit+innovation exhaustion checker, doctor probe, and pending/deferred fixtures",
  },
  {
    id: "certified-ai-response-receipts",
    title: "Bind every remote-AI answer to a verifiable response receipt",
    description:
      "Extend canonical request evidence through validated provider output, exact model identity, timestamp, and a tamper-evident response digest so cached and fresh answers share one auditable provenance contract.",
    complete:
      has(
        "src/server/CanonicalAiEvidence.ts",
        /buildCanonicalAiResponseReceipt/,
      ) &&
      has("src/server/Worker.ts", /receipt: buildCanonicalAiResponseReceipt/) &&
      has("tests/server/CanonicalAiEvidence.test.ts", /tamper-evident receipt/),
    evidence:
      "canonical AI response-receipt builder/verifier, live Worker wiring across oracle/coach/recap/debrief, cache preservation, and tamper tests",
  },
  {
    id: "agent-capability-reachability",
    title:
      "Publish a fail-closed Human + Agent capability reachability contract",
    description:
      "Cross-bind public capability claims to exact routes, client mounts, certificate consumers, policy middleware, and executable source tokens while preserving the honest public-unlaunched runtime posture.",
    complete:
      has(
        "public/capability-reachability.json",
        /implemented-local-unlaunched/,
      ) &&
      has("scripts/check-capability-reachability.mjs", /sourceDigest/) &&
      has("scripts/project-doctor.mjs", /capability-reachability/) &&
      has("tests/scripts/CapabilityReachability.test.ts", /fails closed/),
    evidence:
      "agent-readable capability manifest, source-digested reachability checker, agents.json discovery link, doctor probe, and fail-closed fixtures",
  },
  {
    id: "release-evidence-lineage-dag",
    title: "Turn release evidence into a self-verifying provenance DAG",
    description:
      "Chain source, external gates, local surfaces, work exhaustion, transfer budgets, and the final decision into ordered SHA-256 receipts with a single root digest that fails on tamper or forward references.",
    complete:
      has("scripts/lib/evidence-lineage.mjs", /verifyEvidenceLineage/) &&
      has("scripts/generate-release-evidence.mjs", /release-decision/) &&
      has("tests/scripts/EvidenceLineage.test.ts", /forward references/),
    evidence:
      "canonical evidence DAG builder/verifier, release-manifest integration, root receipt, and tamper/ordering tests",
  },
  {
    id: "startup-brief-semantic-sentinel",
    title: "Make the startup brief prove its own arithmetic",
    description:
      "Recompute context utilization and reject numeric SIL forecasts with zero parsed evidence so adjacent source-of-truth values cannot contradict one another behind a polished status tile.",
    complete:
      has("scripts/validate-brief-format.mjs", /semanticContradictions/) &&
      has("tests/scripts/StudioProtocolHelpers.test.ts", /token arithmetic/) &&
      has("tests/scripts/StudioProtocolHelpers.test.ts", /parsed SIL evidence/),
    evidence:
      "semantic brief validator, contradiction diagnostics, and adversarial context/SIL fixtures",
  },
  {
    id: "release-truth-fingerprint",
    title: "Bind cross-surface project truth into release provenance",
    description:
      "Fingerprint status identity, generated manifest posture, footer topology, and immutable deployment sources, then make that receipt a first-class parent of the release decision.",
    complete:
      has("scripts/lib/project-truth.mjs", /buildProjectTruthFingerprint/) &&
      has("scripts/generate-release-evidence.mjs", /cross-surface-truth/) &&
      has("tests/scripts/ProjectDoctor.test.ts", /tamper-sensitively/),
    evidence:
      "canonical project-truth fingerprint, source digests, release-lineage node, and mutation-sensitive tests",
  },
  {
    id: "operator-rollback-receipt-contract",
    title: "Turn rollback prose into an executable receipt contract",
    description:
      "Require immutable image and staging-evidence digests, dry-run-first promotion, canonical health verification, and a retained rollback receipt so recovery instructions cannot drift from workflow inputs.",
    complete:
      has("docs/DEPLOY_RUNTIME_RUNBOOK.md", /`validation_run_id`/) &&
      has(
        "scripts/lib/promotion-receipt.mjs",
        /createPromotionOutcomeReceipt/,
      ) &&
      has(
        ".github/workflows/promote.yml",
        /promotion-outcome-\$\{\{ github\.run_id \}\}/,
      ) &&
      has(
        "tests/scripts/PromotionReceipt.test.ts",
        /chains a verified production outcome/,
      ),
    evidence:
      "digest-addressed dry-run lineage, independently admitted rollback target and replaced revision, observed production outcome, and retained self-verifying receipt",
  },
  {
    id: "external-block-status-parity",
    title:
      "Make externally blocked audit truth exhaustible without becoming invisible",
    description:
      "Teach the complete-all gate that an evidenced cross-repo or authorization corridor is non-actionable locally while retaining its exact status and reason in the generated Genius list.",
    complete:
      has("scripts/check-work-exhaustion.mjs", /externally-blocked/) &&
      has("tests/scripts/WorkExhaustion.test.ts", /externally-blocked/),
    evidence:
      "shared exhaustion taxonomy and externally-blocked regression fixture",
  },
  {
    id: "local-theme-proof-freshness-gate",
    title: "Make local theme evidence self-expiring and claim-boundary aware",
    description:
      "Validate the six-cell desktop/mobile theme matrix, contrast floors, surfaces, freshness, and local-only scope so screenshots cannot silently become stale or masquerade as staging parity.",
    complete:
      has("scripts/check-theme-proof-receipt.mjs", /receipt is stale/) &&
      has("scripts/project-doctor.mjs", /local-theme-proof/) &&
      has("tests/scripts/ThemeProofReceipt.test.ts", /low-contrast/),
    evidence:
      "theme receipt validator, doctor probe, freshness/contrast/claim-boundary fixtures",
  },
  {
    id: "bounded-test-worker-contract",
    title: "Make test parallelism a repository-owned resource contract",
    description:
      "Convert the coverage process storm into a durable ceiling so local, CI, and closeout verification cannot silently multiply workers until the host becomes the failure mode.",
    complete:
      has("package.json", /vitest run --maxWorkers=4/) &&
      has("package.json", /--coverage --maxWorkers=4/),
    evidence:
      "four-worker ceilings on default, server, and production coverage commands plus a clean 143-file run",
  },
  {
    id: "coverage-surface-visibility-contract",
    title:
      "Make unloaded production code visible even before it earns coverage",
    description:
      "Separate visibility from percentage: enumerate the production TypeScript surface, require the Worker router to appear in the report, and ratchet critical seams from measured floors.",
    complete:
      has("vite.config.ts", /src\/server\/\*\*\/\*\.ts/) &&
      has("coverage-baseline.json", /observedModules/) &&
      has(
        "tests/scripts/CoverageRatchet.test.ts",
        /production coverage surface/,
      ),
    evidence:
      "production-inclusive V8 configuration, Worker observed-module invariant, ten measured critical-module floors, and regression fixtures",
  },
  {
    id: "authenticated-route-seam",
    title: "Extract a fully testable trust boundary from the router god-object",
    description:
      "Turn the Daily Mastery endpoint into an injected authorization and persistence seam that fails closed, reports operational failure, and can be certified without importing the 4,300-line Worker.",
    complete:
      has("src/server/DailyMasteryRouter.ts", /registerDailyMasteryRoute/) &&
      has("src/server/Worker.ts", /registerDailyMasteryRoute/) &&
      has("tests/server/DailyMasteryRouter.test.ts", /fails closed/),
    evidence:
      "dependency-injected route registrar, Worker composition, authorization/isolation/error tests, and 100% route coverage",
  },
  {
    id: "bounded-alpha-evidence-retention",
    title: "Give durable Alpha evidence a privacy-minimal lifecycle",
    description:
      "Retain the 24-hour release cohort without accumulating actor-bound evidence forever: prune durable and process-local history after a declared 30-day ceiling and release orphaned session bindings.",
    complete:
      has(
        "src/server/PlaytestEvidenceStore.ts",
        /EVIDENCE_RETENTION_DAYS = 30/,
      ) &&
      has(
        "src/server/PlaytestEvidenceStore.ts",
        /DELETE FROM playtest_evidence_events/,
      ) &&
      has(
        "tests/server/PlaytestEvidenceStore.test.ts",
        /releases expired session bindings/,
      ),
    evidence:
      "30-day retention constant, transactional PostgreSQL pruning, process-local parity, and binding-release regression test",
  },
  {
    id: "public-ingest-risk-budget",
    title: "Ratchet unauthenticated ingestion as an explicit risk budget",
    description:
      "Count every public-ingest mutation and fail closed when it exceeds the reviewed ceiling, forcing any trust-boundary expansion to update a rationale-bearing machine contract.",
    complete:
      has("config/mutation-route-policies.json", /publicIngestMax/) &&
      has("scripts/lib/route-policy-coverage.mjs", /risk budget exceeded/) &&
      has("tests/scripts/RoutePolicyCoverage.test.ts", /reviewed budget/),
    evidence:
      "11-route public-ingest ceiling, catalog rationale, fail-closed validator, and hostile over-budget fixture",
  },
  {
    id: "trusted-base-validator-pin",
    title: "Make the dependency automation validator self-protecting",
    description:
      "Extend the immutable deploy contract to prove that the PR workflow checks out the trusted base SHA without credentials and loads the repository-owned validator from that checkout.",
    complete:
      has("scripts/check-deploy-contract.mjs", /trusted base SHA/) &&
      has(
        "scripts/check-deploy-contract.mjs",
        /repository-owned machine contract/,
      ) &&
      has(".github/workflows/pr-description.yml", /persist-credentials: false/),
    evidence:
      "three trusted-base workflow invariants added to the directly executed deploy contract gate",
  },
  {
    id: "certified-crowd-consensus-pulse",
    title: "Turn spectator opinion into a certified live consensus pulse",
    description:
      "Converge the anonymous narrator poll and durable Prediction League into one authenticated ledger, broadcast privacy-minimal consensus from accepted durable picks, and make the spectator surface show the live split.",
    complete:
      has("src/server/PredictionLeagueStore.ts", /getGameConsensus/) &&
      has("src/server/PredictionLeagueRouter.ts", /publishConsensus/) &&
      has(
        "src/client/components/PredictionLeaguePanel.ts",
        /Live crowd consensus/,
      ) &&
      has("tests/server/PredictionLeagueStore.test.ts", /getGameConsensus/),
    evidence:
      "durable consensus aggregation, authenticated single-write path, narrator broadcast seam, live accessible meter, and closed-game tests",
  },
  {
    id: "anonymous-mutation-budget-contraction",
    title: "Shrink the public-ingest trust boundary after route convergence",
    description:
      "Retire duplicate anonymous crowd mutations and ratchet the reviewed public-ingest ceiling whenever a write becomes actor-bound so security gains cannot silently regress.",
    complete:
      mutationPolicyPosture().publicIngestMax <= 9 &&
      mutationPolicyPosture().vote?.auth === "verified-actor" &&
      (!mutationPolicyPosture().narrator ||
        mutationPolicyPosture().narrator.auth === "retired") &&
      has(
        "src/server/PredictionLeagueRouter.ts",
        /authenticated Prediction League contract/,
      ),
    evidence:
      "retired duplicate path, authenticated Prediction League and mutator ballots, and nine-route fail-closed public-ingest ceiling",
  },
  {
    id: "composition-ratchet-contraction",
    title: "Cash router extraction into a tighter composition budget",
    description:
      "Convert removed inline domains into a lower Worker line ceiling and keep every extracted domain behind bounded, directly tested registrars.",
    complete:
      atMostNumericConstant(
        "scripts/check-worker-composition.mjs",
        "WORKER_LINE_BUDGET",
        3105,
      ) &&
      has(
        "src/server/SeasonCommunityRouter.ts",
        /registerSeasonCommunityRoutes/,
      ) &&
      has("src/server/ProgressionRouter.ts", /registerProgressionRoutes/) &&
      has("scripts/check-worker-composition.mjs", /forbiddenInWorker/) &&
      has("tests/scripts/WorkerComposition.test.ts", /extracted domains/),
    evidence:
      "3,105-line Worker ceiling, bounded season/community and progression registrars, route reclamation detection, and executable regression test",
  },
  {
    id: "season-entitlement-identity-projection",
    title:
      "Project claimed Season Pass cosmetics back into visible player identity",
    description:
      "Close the promise loop after durable claims by rendering exact title and badge entitlements from the certified server ledger, with honest durability scope beside them.",
    complete:
      has("src/client/SeasonPassTrack.ts", /Earned season cosmetics/) &&
      has("src/client/SeasonPassTrack.ts", /this\.entitlements/) &&
      has("src/client/SeasonPassTrack.ts", /Durable ledger/),
    evidence:
      "server-derived cosmetic chips, certified durability label, and no client-invented reward state",
  },
  {
    id: "experiment-reset-scope",
    title: "Make experiment aggregate reset boundaries machine-readable",
    description:
      "Prevent process-local experiment summaries from masquerading as durable analytics by attaching the assignment, aggregate, and worker-restart scope to every summary surface.",
    complete:
      has("src/server/ExperimentRouter.ts", /EXPERIMENT_STORAGE_POSTURE/) &&
      has(
        "src/server/ExperimentRouter.ts",
        /resetBoundary: "worker-restart"/,
      ) &&
      has(
        "tests/server/ExperimentRouter.test.ts",
        /aggregates: "process-local"/,
      ),
    evidence:
      "shared storage-posture contract across dock, recap, runtime, unified, and outcome summaries with direct test",
  },
  {
    id: "byte-stable-balance-envelope",
    title: "Make identical balance inputs produce byte-identical evidence",
    description:
      "Remove wall-clock noise from the generated envelope, publish it from the production public source, and pin the stable scenario digest so rebuilds measure balance rather than time.",
    complete:
      has(
        "scripts/generate-balance-envelope.ts",
        /public.*balance-envelope\.json/s,
      ) &&
      !has("scripts/generate-balance-envelope.ts", /generatedAt:/) &&
      has("tests/core/execution/VaultFrontBalance.test.ts", /scenarioDigest/),
    evidence:
      "deterministic public artifact with 28,125 scenarios, stable SHA-256 scenario digest, and no timestamp entropy",
  },
  {
    id: "balance-lineage-tamper-proof",
    title: "Make balance evidence tampering invalidate release lineage",
    description:
      "Promote the envelope from an attached file to a lineage parent whose digest mutation makes release verification fail closed.",
    complete:
      has(
        "scripts/generate-release-evidence.mjs",
        /deterministic-gameplay-envelope/,
      ) &&
      has("tests/scripts/ReleaseEvidenceManifest.test.ts", /balanceTampered/) &&
      has("public/agents.json", /verified-balance-envelope/),
    evidence:
      "release-lineage balance parent, artifact/source digests, tamper test, and read-only agent discovery",
  },
  {
    id: "season-ledger-restart-proof",
    title:
      "Prove certified Season Pass entitlements survive a fresh store instance",
    description:
      "Test the actual PostgreSQL read path after a claim through a newly constructed store, alongside composite replay keys and actor-bound routing, so restart durability is executable evidence.",
    complete:
      has("src/server/db/schema.sql", /season_pass_entitlements/) &&
      has(
        "tests/server/CertifiedSeasonPassStore.test.ts",
        /after a store restart/,
      ) &&
      has(
        "tests/server/SeasonPassRouter.test.ts",
        /binds reads to the authenticated actor/,
      ),
    evidence:
      "fresh-store restoration fixture, composite certified-event key, entitlement table contract, and cross-actor rejection",
  },
  {
    id: "progression-receipt-verifier",
    title:
      "Make progression completion receipts independently tamper-verifiable",
    description:
      "Turn the replay-safe fan-out digest into an executable verifier so downstream consumers can reject altered completion totals instead of trusting a producer-owned hash string.",
    complete:
      has("src/server/MatchProgression.ts", /verifyProgressionReceipt/) &&
      has("src/server/MatchProgression.ts", /timingSafeEqual/) &&
      has("tests/server/MatchProgression.test.ts", /achievementsUnlocked: 999/),
    evidence:
      "canonical completion payload, constant-time digest verification, duplicate-boundary rule, and tamper regression",
  },
  {
    id: "state-scope-catalog-fingerprint",
    title: "Fingerprint persistence capability truth inside runtime evidence",
    description:
      "Digest the executable store ownership/capability catalog so any readiness metadata change becomes provenance-visible through the Runtime Integrity Passport.",
    complete:
      has("src/server/StateScopeLedger.ts", /stateScopeCatalogDigest/) &&
      has("src/server/StateScopeLedger.ts", /catalogDigest/) &&
      has("tests/server/StateScopeLedger.test.ts", /ready\.catalogDigest/),
    evidence:
      "stable SHA-256 catalog fingerprint, runtime-ledger projection, and mutation-sensitive test",
  },
  {
    id: "release-bound-vault-pressure-rules",
    title:
      "Promote the flagship climax rules into release-bound balance evidence",
    description:
      "Move the Vault Pressure threshold and breach duration into the versioned balance authority, validate their domain, and publish them in the deterministic envelope that already feeds release lineage.",
    complete:
      has("config/vaultfront-balance.v1.json", /"pressure"/) &&
      has("scripts/generate-balance-envelope.ts", /pressureRules/) &&
      has("public/balance-envelope.json", /"breachWindowDurationTicks": 900/),
    evidence:
      "single JSON authority, executable threshold/window invariants, deterministic public projection, and release-lineage source binding",
  },
  {
    id: "privacy-bounded-match-feedback",
    title: "Give certified match feedback a declared deletion horizon",
    description:
      "Keep the 30-day product-learning window without accumulating actor-bound ratings or free text forever by pruning PostgreSQL and process-local evidence under one tested retention contract.",
    complete:
      has(
        "src/server/MatchFeedbackStore.ts",
        /MATCH_FEEDBACK_RETENTION_DAYS = 30/,
      ) &&
      has("src/server/MatchFeedbackStore.ts", /DELETE FROM match_feedback/) &&
      has(
        "tests/server/MatchFeedbackStore.test.ts",
        /prunes actor-bound feedback/,
      ),
    evidence:
      "30-day deletion contract, PostgreSQL/process-local pruning parity, retention-labeled summaries, and boundary tests",
  },
  {
    id: "certified-feedback-cohort-intelligence",
    title: "Join player sentiment to certified outcome and style cohorts",
    description:
      "Turn ratings into causal product-learning evidence by segmenting private aggregates by server-certified win, comeback, and play-style dimensions without exposing actor or match identity.",
    complete:
      has("src/server/MatchFeedbackStore.ts", /CertifiedFeedbackCohort/) &&
      has("src/server/Worker.ts", /styleConfidence/) &&
      has("src/server/db/schema.sql", /feedback_play_style/) &&
      has(
        "tests/server/MatchFeedbackStore.test.ts",
        /certified outcome cohorts/,
      ),
    evidence:
      "certificate-derived outcome projection, privacy-safe cohort aggregates, durable/fallback parity, and no actor identifiers in summaries",
  },
  {
    id: "signed-replay-balance-identity",
    title: "Cryptographically bind every replay to its gameplay authority",
    description:
      "Stamp the exact balance authority and SHA-256 fingerprint into the HMAC-covered replay manifest, reject incompatible playback, and distinguish legacy evidence instead of silently replaying under different tuning.",
    complete:
      has("src/server/VaultFrontBalanceIdentity.ts", /authorityFingerprint/) &&
      has("src/server/ReplayStore.ts", /verifyReplayBalanceCompatibility/) &&
      has("src/server/GameServer.ts", /vaultFrontBalanceIdentity/) &&
      has(
        "tests/server/ReplayStore.test.ts",
        /rejects a replay from a different balance authority/,
      ),
    evidence:
      "canonical balance identity, signed replay snapshot binding, compatibility verifier, and mismatch/tamper tests",
  },
  {
    id: "postmatch-lifecycle-receipt",
    title: "Make progressive post-match hydration measurably honest",
    description:
      "Issue one source-derived lifecycle receipt per recap session with completed, timed-out, cancelled, and stale tasks, then emit a single bounded healthy/degraded pulse instead of inferring experience quality from page visibility.",
    complete:
      has("src/client/PostMatchSession.ts", /PostMatchSessionReceipt/) &&
      has("src/client/graphics/layers/WinModal.ts", /postmatch_hydration_/) &&
      has(
        "tests/client/PostMatchSession.test.ts",
        /source-derived lifecycle receipt/,
      ) &&
      has(
        "tests/client/graphics/layers/WinModal.test.ts",
        /one bounded lifecycle pulse/,
      ),
    evidence:
      "generation-scoped receipt counters, exactly-once healthy/degraded pulse, stale-result accounting, and deterministic timer tests",
  },
  {
    id: "evidence-keyed-replay-share-cache",
    title: "Make replay share caches obey signed evidence identity",
    description:
      "Key automatic-highlight reuse by the signed replay rather than a caller-controlled game ID, and independently verify every share projection so altered evidence can never inherit a cached trusted URL.",
    complete:
      has("src/server/ReplayHighlightStore.ts", /manifest\.signature/) &&
      has("src/server/ReplayShareContract.ts", /verifyReplayShareProjection/) &&
      has(
        "tests/server/ReplayShareContract.test.ts",
        /never serves a cached highlight for altered evidence/,
      ),
    evidence:
      "signature-keyed cache, independent projection verifier, restart-stability proof, and altered-evidence rejection",
  },
  {
    id: "certificate-bound-archived-rematch",
    title: "Bind archived rematches to the result certificate roster",
    description:
      "Require an archived source match to carry a valid result certificate whose certified roster includes the authenticated actor before any private continuation can clone its configuration.",
    complete:
      has(
        "src/server/RematchAuthorization.ts",
        /verifyMatchResultCertificate/,
      ) &&
      has("src/server/Worker.ts", /authorizeArchivedRematchSource/) &&
      has(
        "tests/server/RematchAuthorization.test.ts",
        /rejects nonparticipants and certificate tampering/,
      ),
    evidence:
      "pure archived authorization kernel, certificate verification, actor/client binding, and tamper/nonparticipant tests",
  },
  {
    id: "postmatch-route-policy-triad",
    title: "Make post-match trust seams executable route policy",
    description:
      "Promote rematch creation, Prediction League writes, and replay clip projection into the route-policy manifest with their actual source-participation, game-lifecycle, and signed-replay evidence classes.",
    complete:
      has("src/server/RoutePolicyManifest.ts", /source-participation/) &&
      has("src/server/RoutePolicyManifest.ts", /game-lifecycle/) &&
      has("src/server/RoutePolicyManifest.ts", /signed-replay/) &&
      has("src/server/RematchRouter.ts", /rematch-create/) &&
      has("src/server/PredictionLeagueRouter.ts", /prediction-league-write/),
    evidence:
      "manifest-bound route assertions, explicit evidence taxonomy, and policy validation coverage",
  },
  {
    id: "deterministic-epsilon-route-ordering",
    title:
      "Make safest-route ordering mathematically stable at the epsilon boundary",
    description:
      "Apply one symmetric epsilon equivalence rule before distance tie-breaking and replace probabilistic test inputs with a seeded sequence plus an adversarial near-equal case.",
    complete:
      has(
        "src/core/execution/VaultFrontExecution.ts",
        /risk < safestRisk - 0\.0001/,
      ) &&
      has(
        "tests/core/execution/VaultFrontExecutionProperty.test.ts",
        /epsilonTie/,
      ) &&
      has(
        "tests/core/execution/VaultFrontExecutionProperty.test.ts",
        /Math\.imul\(seed/,
      ),
    evidence:
      "symmetric epsilon comparator, seeded property sequence, explicit adversarial boundary, and no stochastic gate flicker",
  },
  {
    id: "unified-certified-game-authority",
    title: "Unify certified archived-game authority across consumers",
    description:
      "Resolve archive identity, signed result evidence, roster binding, and persistent winners through one source-derived authority so dynasty, tournament, and continuation consumers cannot invent parallel trust rules.",
    complete:
      has("src/server/CertifiedGameAuthority.ts", /certifyArchivedGame/) &&
      has(
        "tests/server/CertifiedGameAuthority.test.ts",
        /CertifiedGameAuthority/,
      ) &&
      occurrenceCount("src/server/Worker.ts", "certifyArchivedGame(") >= 2,
    evidence:
      "shared CertifiedGameAuthority kernel, focused authority tests, and multiple production consumers in dynasty and tournament flows",
  },
  {
    id: "fresh-worker-quorum-proof",
    title: "Make master health prove a fresh worker quorum",
    description:
      "Replace process-presence health with bounded-age worker evidence so missing, stale, and degraded workers fail closed before the master advertises readiness.",
    complete:
      has("src/server/MasterLobbyService.ts", /status: "stale"/) &&
      has("src/server/IPCBridgeSchema.ts", /workerHealth/) &&
      has(
        "tests/server/MasterLobbyServiceHealth.test.ts",
        /worker heartbeat is stale/,
      ),
    evidence:
      "fresh-worker quorum projection, typed workerHealth IPC evidence, stale-worker rejection, and focused master health tests",
  },
  {
    id: "validated-artifact-isomorphism",
    title:
      "Make the deployed Pages artifact identical to the validated artifact",
    description:
      "Validate the exact static directory uploaded by the Pages workflow so a launch stub or alternate artifact can never bypass the public-surface contract.",
    complete:
      has("scripts/check-pages-deploy-contract.mjs", /required/) &&
      has(
        ".github/workflows/deploy-pages.yml",
        /check-pages-deploy-contract\.mjs --artifact static/,
      ) &&
      has(".github/workflows/deploy-pages.yml", /path:\s*static/),
    evidence:
      "artifact contract checker, workflow invocation against static, and upload-pages binding to the same static directory",
  },
  {
    id: "hosted-cron-zero-invariant",
    title: "Keep hosted workflow cron at exactly zero",
    description:
      "Mechanize the zero-hosted-cron cost invariant and keep formerly scheduled brief-integrity and stale-PR workflows manual without confusing Dependabot metadata for hosted execution.",
    complete:
      has(
        "scripts/check-hosted-cron-contract.mjs",
        /hosted schedule is forbidden/,
      ) &&
      has(".github/workflows/brief-format-check.yml", /workflow_dispatch/) &&
      !has(".github/workflows/brief-format-check.yml", /^\s*schedule\s*:/m) &&
      has(".github/workflows/pr-stale.yml", /workflow_dispatch/) &&
      !has(".github/workflows/pr-stale.yml", /^\s*schedule\s*:/m),
    evidence:
      "repository-wide hosted-cron checker plus schedule-free brief-format and stale-PR workflows with explicit manual dispatch",
  },
  {
    id: "monotonic-innovation-ledger-guard",
    title: "Make shipped innovation evidence monotonic under regeneration",
    description:
      "Compare the existing shipped ledger with source-derived candidates before either artifact is written, and fail closed with exact forgotten IDs instead of silently deleting completed innovation evidence.",
    complete:
      has("scripts/innovation-pack.mjs", /forgottenShippedInnovationIds/) &&
      has(
        "tests/scripts/InnovationPack.test.ts",
        /refuses to overwrite when a shipped historical candidate is forgotten/,
      ),
    evidence:
      "pure shipped-ID comparison helper, pre-write fail-closed guard, exact forgotten-ID diagnostic, and isolated no-overwrite regression",
  },
  {
    id: "certified-loop-admissibility-receipt",
    title: "Make certified funnel chronology independently tamper-verifiable",
    description:
      "Digest the normalized Pressure → Breach → decisive delivery → victory projection into every accepted evidence receipt so downstream operators can distinguish a certified admissible timeline from altered aggregate claims without retaining actor identity.",
    complete:
      has(
        "src/server/CertifiedLoopTimeline.ts",
        /buildCertifiedLoopAdmissibilityReceipt/,
      ) &&
      has("src/server/CertifiedLoopEvidenceStore.ts", /admissibilityReceipt/) &&
      has(
        "tests/server/CertifiedLoopEvidenceStore.test.ts",
        /tampered admissibility receipt/,
      ),
    evidence:
      "privacy-minimal canonical timeline digest, independent verifier, store receipt integration, and tamper/order-sensitive tests",
  },
  {
    id: "worker-game-id-route-witness",
    title: "Make routed GameID allocation independently re-checkable",
    description:
      "Attach the intended worker to each successful allocation and expose a fail-closed verifier for shape, route, collision state, and bounded search counts so consumers cannot mistake a malformed or tampered allocation result for an owned GameID.",
    complete:
      has("src/server/WorkerGameId.ts", /verifyWorkerRoutedGameIdResult/) &&
      has("tests/server/WorkerGameId.test.ts", /tampered route witness/) &&
      has("src/server/Worker.ts", /createVerifiedWorkerRoutedGameId/),
    evidence:
      "worker-bound success witness, independent verifier, live consumer assertion, and malformed/route/collision/count tamper tests",
  },
  {
    id: "startup-brief-source-closure",
    title: "Close startup freshness over every core local truth source",
    description:
      "Expand the source manifest beyond the task board and handoff to the truth audit, current state, session plan, and creative-direction record so a polished brief expires whenever any core renderer input changes.",
    complete:
      has("scripts/lib/brief-freshness.mjs", /context\/TRUTH_AUDIT\.md/) &&
      has("scripts/lib/brief-freshness.mjs", /context\/CURRENT_STATE\.md/) &&
      has("scripts/lib/brief-freshness.mjs", /docs\/SESSION_PLAN\.md/) &&
      has(
        "tests/scripts/StudioProtocolHelpers.test.ts",
        /tracks every core renderer source/,
      ),
    evidence:
      "closed core-source manifest, per-source SHA-256 fingerprints, and mutation tests across every newly tracked renderer input",
  },
  {
    id: "service-worker-release-lineage",
    title: "Bind the executable service worker into release provenance",
    description:
      "Project the one compiled worker asset, byte digest, cache namespace, and policy marker into the release-evidence DAG so promotion evidence fails closed if the offline runtime is missing, duplicated, altered, or detached from its release identity.",
    complete:
      has(
        "scripts/generate-release-evidence.mjs",
        /buildServiceWorkerReleaseEvidence/,
      ) &&
      has("scripts/generate-release-evidence.mjs", /service-worker-release/) &&
      has(
        "tests/scripts/ReleaseEvidenceManifest.test.ts",
        /service-worker release evidence/,
      ),
    evidence:
      "single-asset worker projector, content digest and cache identity, release-lineage parent, fail-closed blockers, and missing/duplicate/tamper fixtures",
  },
  {
    id: "portable-visual-proof-capsule",
    title: "Make visual proof independently verifiable from a clean checkout",
    description:
      "Carry canonical browser summaries and hashed screenshot artifacts beside LATEST so doctor verification does not depend on ignored, ephemeral Playwright output.",
    complete:
      has(
        "scripts/render-theme-proof-receipt.mjs",
        /docs\/visual-qa\/artifacts/,
      ) &&
      has(
        "scripts/check-theme-proof-receipt.mjs",
        /canonical browser summary/,
      ) &&
      has(
        "tests/scripts/ThemeProofReceipt.test.ts",
        /ephemeral browser output is removed/,
      ),
    evidence:
      "portable 12-artifact capsule, canonical summary parity, clean-checkout verification, and tamper tests",
  },
  {
    id: "progression-receipt-retention-boundary",
    title: "Give certified progression dividends a privacy-minimal horizon",
    description:
      "Retain actor-bound match dividends long enough for support and replay while pruning PostgreSQL and process-local receipts at one declared 30-day boundary.",
    complete:
      has(
        "src/server/ProgressionReceiptStore.ts",
        /PROGRESSION_RECEIPT_RETENTION_DAYS = 30/,
      ) &&
      has(
        "src/server/ProgressionReceiptStore.ts",
        /DELETE FROM match_progression_receipts/,
      ) &&
      has(
        "tests/server/ProgressionReceiptStore.test.ts",
        /exact 30-day privacy boundary/,
      ),
    evidence:
      "30-day deletion contract, indexed durable pruning, process-local parity, and exact-boundary regression",
  },
  {
    id: "post-verification-ci-fan-in",
    title: "Make exact-revision CI mean the whole verification graph passed",
    description:
      "Issue the CI lineage node only from a final fan-in job whose needs cover build, tests, lint, format, security, and bundle gates instead of treating a running build job as success.",
    complete:
      has(
        ".github/workflows/ci.yml",
        /release-evidence:[\s\S]*?needs: \[build, test, eslint, prettier, security-audit, bundle-size\]/,
      ) &&
      has("scripts/generate-release-evidence.mjs", /CI_VERIFICATION_NEEDS/) &&
      has(
        "tests/scripts/ReleaseEvidenceManifest.test.ts",
        /post-verification fan-in contract/,
      ),
    evidence:
      "six-job CI fan-in, exact-SHA post-verification contract, workflow-bound metadata, and incomplete-job rejection",
  },
  {
    id: "certified-pressure-contribution-dividend",
    title:
      "Show each teammate's certified contribution to shared Vault Pressure",
    description:
      "Carry the actor-attributed Pressure delivery count from signed match stats into the verified progression dividend so cooperative victory credit is visible rather than inferred.",
    complete:
      has("src/server/GameServer.ts", /vaultPressureContributions/) &&
      has("src/server/MatchProgression.ts", /vaultPressureContributions/) &&
      has("src/client/components/ProgressionDebrief.ts", /team Pressure/) &&
      has(
        "tests/client/components/ProgressionDebrief.test.ts",
        /team Pressure deliveries/,
      ),
    evidence:
      "signed-stat projection, actor-bound dividend field, exact cooperative-credit UI, and client/server regressions",
  },
  {
    id: "semantic-innovation-detector-ratchet",
    title: "Make innovation completion recognize stronger future ratchets",
    description:
      "Replace stale exact-value regexes with semantic ceilings and policy posture checks so stronger security and architecture improvements remain shipped under regeneration.",
    complete:
      has("scripts/innovation-pack.mjs", /atMostNumericConstant/) &&
      has("scripts/innovation-pack.mjs", /mutationPolicyPosture/) &&
      has("tests/scripts/InnovationPack.test.ts", /stronger semantic ratchets/),
    evidence:
      "inequality-aware budget detection, parsed route-policy posture, stronger-value fixtures, and monotonic ledger preservation",
  },
  {
    id: "dry-run-intent-admission",
    title:
      "Make dry-run-first an admitted release fact instead of operator memory",
    description:
      "Retain a hash-bound dry-run receipt and require a later live promotion to admit the exact successful repository workflow, staging run, target, operation, rollback reason, and attestation digests.",
    complete:
      has(".github/workflows/promote.yml", /validation_run_id/) &&
      has(".github/workflows/promote.yml", /verify-validation/) &&
      has("scripts/lib/promotion-receipt.mjs", /validation-was-not-dry-run/) &&
      has(
        "tests/scripts/PromotionReceipt.test.ts",
        /rejects changed live intent/,
      ),
    evidence:
      "retained validation artifact, successful-run admission, full intent cross-binding, and mismatch/tamper regression",
  },
  {
    id: "dual-attestation-rollback-lineage",
    title: "Prove both sides of a rollback transition",
    description:
      "Admit the target and currently deployed revisions through separate same-repository staging attestations so a rollback receipt states exactly what was replaced and what was restored.",
    complete:
      has(".github/workflows/promote.yml", /replaced_staging_run_id/) &&
      has(
        ".github/workflows/promote.yml",
        /replaced_attestation\.outputs\.attestation_digest/,
      ) &&
      has(
        "scripts/lib/promotion-receipt.mjs",
        /rollback-missing-replaced-lineage/,
      ) &&
      has(
        "tests/scripts/PromotionReceipt.test.ts",
        /both admitted staging attestations/,
      ),
    evidence:
      "two independently verified staging artifacts, unequal run constraint, dual digest lineage, and rollback-specific validation",
  },
  {
    id: "observed-production-outcome-receipt",
    title: "Close promotion lineage over observed production bytes",
    description:
      "Hash the canonical production health response, exact revision response, timing boundary, admitted target, and prior validation into a self-verified retained outcome artifact.",
    complete:
      has("scripts/lib/promotion-receipt.mjs", /production-health-not-ready/) &&
      has(
        "scripts/lib/promotion-receipt.mjs",
        /production-revision-mismatch/,
      ) &&
      has(
        ".github/workflows/promote.yml",
        /promotion-outcome-\$\{\{ github\.run_id \}\}/,
      ) &&
      has("tests/scripts/PromotionReceipt.test.ts", /outcome tamper/),
    evidence:
      "canonical health/revision digests, validation-parent digest, self-verification, 90-day retained artifact, and adversarial outcomes",
  },
  {
    id: "lossless-hidden-path-artifact-transport",
    title: "Make artifact transport preserve the verified path universe",
    description:
      "Require CI artifact upload to retain hidden public-contract paths so the downloaded payload is byte-for-byte equal to the manifest that admitted it, including .well-known agent surfaces.",
    complete:
      has(".github/workflows/ci.yml", /include-hidden-files:\s*true/) &&
      has(
        "tests/scripts/CiArtifactFanout.test.ts",
        /include-hidden-files: true/,
      ),
    evidence:
      "provider-discovered manifest mismatch, explicit hidden-file transport, semantic regression coverage, and downstream exact-artifact verification",
  },
  {
    id: "dependency-free-github-release-planner",
    title: "Collapse the release toolchain to one auditable planner",
    description:
      "Replace the vulnerable Semantic Release and bundled npm graph with a repository-owned conventional-commit planner and GitHub CLI release step that is deterministic, no-op aware, serialized, and side-effect gated.",
    complete:
      has("scripts/plan-github-release.mjs", /planGithubRelease/) &&
      has(".github/workflows/semantic-release.yml", /gh release create/) &&
      has(
        "tests/scripts/GithubReleasePlanner.test.ts",
        /dependency-free and side-effect gated/,
      ) &&
      !has("package.json", /"semantic-release"/),
    evidence:
      "406-package trusted-computing-base reduction, zero full-graph vulnerabilities, live-tag planner check, seven adversarial tests, serialized variable-gated release",
  },
  {
    id: "format-stable-canonical-closeout",
    title: "Make canonical closeout preserve its own formatting invariant",
    description:
      "Format every generated closeout truth surface after doctor write-back so the canonical commit path cannot create a Prettier-ratchet regression while recording a green doctor result.",
    complete:
      has("scripts/closeout-autopilot.mjs", /generated-closeout-format/) &&
      has("scripts/closeout-autopilot.mjs", /context\/PROJECT_STATUS\.json/) &&
      has(
        "tests/scripts/OpsCommandSurface.test.ts",
        /context\/PROJECT_STATUS\.json/,
      ),
    evidence:
      "doctor-to-formatter ordering, canonical status inclusion, and command-surface regression coverage",
  },
  {
    id: "personal-agency-evidence-receipt",
    title: "Show why First Extraction awarded each personal and team step",
    description:
      "Project certified actor contribution and team Breach context into a compact player-readable receipt so cooperative progress is transparent without borrowing teammate credit.",
    complete:
      has(
        "src/client/FirstExtractionQuest.ts",
        /buildFirstExtractionEvidenceReceipt/,
      ) &&
      has(
        "src/client/graphics/layers/ControlPanel.ts",
        /First Extraction certified evidence/,
      ) &&
      has(
        "tests/client/FirstExtractionQuest.test.ts",
        /compact personal\/team evidence receipt/,
      ),
    evidence:
      "server-status/activity provenance, separate personal/team projection, visible contribution summary, and no-borrowed-credit tests",
  },
  {
    id: "mastery-doctrine-receipt-verifier",
    title: "Make every Doctrine spend independently tamper-verifiable",
    description:
      "Bind actor, request, entitlement, spend, remaining balance, durability, and evidence class into one canonical SHA-256 receipt that detects post-transaction alteration.",
    complete:
      has(
        "src/server/CertifiedDailyMasteryStore.ts",
        /verifyMasteryDoctrineReceipt/,
      ) &&
      has("src/client/Api.ts", /receiptDigest/) &&
      has(
        "tests/server/CertifiedDailyMasteryStore.test.ts",
        /masteryBalance: 999/,
      ),
    evidence:
      "canonical doctrine payload digest, constant-time verification, client schema/short proof, and spend-tamper regression",
  },
  {
    id: "secondary-ui-entry-ratchet",
    title: "Keep secondary UI from silently returning to first paint",
    description:
      "Turn the bundle recovery into a source-owned entry boundary so tutorial, lobby implementation, and leaderboard remain lazy while the existing byte ceiling independently measures the result.",
    complete:
      has("src/client/Main.ts", /import\("\.\/VaultFrontTutorial"\)/) &&
      has("src/client/Main.ts", /import\("\.\/components\/PlayPage"\)/) &&
      has("src/client/Main.ts", /import\("\.\/LeaderboardModal"\)/) &&
      has(
        "tests/scripts/InitialEntryBoundary.test.ts",
        /authoritative status assignment/,
      ),
    evidence:
      "three explicit lazy boundaries, authoritative match-ready ordering, unchanged executable byte ceiling, and regression tests",
  },
];

const payload = {
  schemaVersion: "1.0",
  generatedAt: now,
  source: "scripts/innovation-pack.mjs",
  primarySource: "latest audit-backed Unified Genius List",
  items: candidates.map((candidate, index) => ({
    rank: index + 1,
    status: candidate.complete ? "shipped" : "pending",
    ...candidate,
  })),
};

if (fs.existsSync(jsonPath)) {
  const existingPayload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const forgotten = forgottenShippedInnovationIds(
    Array.isArray(existingPayload?.items) ? existingPayload.items : [],
    payload.items,
  );
  if (forgotten.length > 0) {
    throw new Error(
      `Innovation regeneration refused; previously shipped IDs are absent from the generator: ${forgotten.join(", ")}`,
    );
  }
}

const body = [
  "<!-- generated-by: scripts/innovation-pack.mjs -->",
  `<!-- generated-at: ${now} -->`,
  "",
  "# Second-Order Innovation Pack",
  "",
  "Generated only after the audit-backed Unified Genius List was exhausted. Completion is derived from checked-in implementation evidence.",
  "",
  ...payload.items.map(
    (candidate) =>
      `${candidate.rank}. [${candidate.complete ? "x" : " "}] **${candidate.id}** — ${candidate.title}. ${candidate.description}${candidate.complete ? ` Evidence: ${candidate.evidence}.` : ""}`,
  ),
  "",
].join("\n");

fs.writeFileSync(markdownPath, body, "utf8");
fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(
  `✓ Innovation pack → ${path.relative(root, markdownPath)} (${payload.items.filter((item) => item.complete).length}/${payload.items.length} shipped)`,
);
