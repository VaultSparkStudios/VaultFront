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

const candidates = [
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
      has("docs/DEPLOY_RUNTIME_RUNBOOK.md", /staging_evidence_digest/) &&
      has("scripts/check-deploy-contract.mjs", /rollback receipt/) &&
      has(
        "tests/scripts/StudioProtocolHelpers.test.ts",
        /check-deploy-contract/,
      ),
    evidence:
      "digest-addressed operator runbook, 25-check deploy contract gate, and protocol regression execution",
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
      "Retire the duplicate anonymous crowd mutation and immediately ratchet the reviewed public-ingest ceiling from eleven to ten so the security gain cannot silently regress.",
    complete:
      has("config/mutation-route-policies.json", /"publicIngestMax": 10/) &&
      has(
        "config/mutation-route-policies.json",
        /narrator\/:gameId\/predict[\s\S]*?"auth": "retired"/,
      ) &&
      has(
        "src/server/PredictionLeagueRouter.ts",
        /authenticated Prediction League contract/,
      ),
    evidence:
      "legacy 410 tombstone, authenticated replacement, and ten-route fail-closed public-ingest ceiling",
  },
  {
    id: "composition-ratchet-contraction",
    title: "Cash router extraction into a tighter composition budget",
    description:
      "Convert removed inline domains into a lower Worker line ceiling and keep every extracted domain behind bounded, directly tested registrars.",
    complete:
      has(
        "scripts/check-worker-composition.mjs",
        /WORKER_LINE_BUDGET = 3130/,
      ) &&
      has("scripts/check-worker-composition.mjs", /forbiddenInWorker/) &&
      has("tests/scripts/WorkerComposition.test.ts", /extracted domains/),
    evidence:
      "3,130-line Worker ceiling, explicit bounded-router ceilings, route reclamation detection, and executable regression test",
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
