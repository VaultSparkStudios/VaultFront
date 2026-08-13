import { createHash } from "node:crypto";
import type { DatabasePosture } from "./db/pool";

export type StateDurability = "volatile" | "database-when-ready";
export type StateCapability = "postgres-optional" | "process-only";

export interface StateScopeLedgerEntry {
  store: string;
  owner: string;
  kind: "store" | "runtime-state";
  sourceFile: string;
  runtimeExport: string | null;
  capability: StateCapability;
  declaredScope: "process" | "postgres";
  durability: StateDurability;
  replication: "none" | "postgres-managed";
  retention: string;
  recovery: string;
  probeOwner: string;
  releaseCritical: boolean;
}

interface RegistryIdentity {
  store: string;
  owner: string;
  sourceFile: string;
  runtimeExport: string;
  releaseCritical: boolean;
  retention?: string;
  recovery?: string;
  probeOwner?: string;
}

function postgresStore(identity: RegistryIdentity): StateScopeLedgerEntry {
  return {
    ...identity,
    kind: "store",
    capability: "postgres-optional",
    declaredScope: "postgres",
    durability: "database-when-ready",
    replication: "postgres-managed",
    retention:
      identity.retention ??
      "database policy; process lifetime when database disabled",
    recovery:
      identity.recovery ?? "database restore; none for process-local fallback",
    probeOwner: identity.probeOwner ?? "database-readiness",
  };
}

function processStore(identity: RegistryIdentity): StateScopeLedgerEntry {
  return {
    ...identity,
    kind: "store",
    capability: "process-only",
    declaredScope: "process",
    durability: "volatile",
    replication: "none",
    retention: identity.retention ?? "process lifetime",
    recovery: identity.recovery ?? "none",
    probeOwner: identity.probeOwner ?? "runtime-integrity-passport",
  };
}

/**
 * Canonical runtime state-owner authority. Readiness, the ledger digest, and
 * the source-inventory completeness test all derive from this registry.
 */
export const STATE_SCOPE_REGISTRY: readonly StateScopeLedgerEntry[] = [
  postgresStore({
    store: "achievements",
    owner: "AchievementStore",
    sourceFile: "src/server/AchievementStore.ts",
    runtimeExport: "achievementStore",
    releaseCritical: true,
  }),
  postgresStore({
    store: "certified-daily-mastery",
    owner: "CertifiedDailyMasteryStore",
    sourceFile: "src/server/CertifiedDailyMasteryStore.ts",
    runtimeExport: "certifiedDailyMasteryStore",
    releaseCritical: true,
  }),
  postgresStore({
    store: "certified-loop-evidence",
    owner: "CertifiedLoopEvidenceStore",
    sourceFile: "src/server/CertifiedLoopEvidenceStore.ts",
    runtimeExport: "certifiedLoopEvidenceStore",
    releaseCritical: true,
  }),
  postgresStore({
    store: "certified-outcomes",
    owner: "CertifiedOutcomeStore",
    sourceFile: "src/server/CertifiedOutcomeStore.ts",
    runtimeExport: "certifiedOutcomeStore",
    releaseCritical: true,
  }),
  postgresStore({
    store: "certified-season-contracts",
    owner: "CertifiedSeasonContractStore",
    sourceFile: "src/server/CertifiedSeasonContractStore.ts",
    runtimeExport: "certifiedSeasonContractStore",
    releaseCritical: true,
  }),
  postgresStore({
    store: "clans",
    owner: "ClanStore",
    sourceFile: "src/server/ClanStore.ts",
    runtimeExport: "clanStore",
    releaseCritical: true,
  }),
  processStore({
    store: "client-crash-telemetry",
    owner: "ClientCrashStore",
    sourceFile: "src/server/ClientCrashStore.ts",
    runtimeExport: "clientCrashStore",
    releaseCritical: false,
    retention: "newest 500 events in the owning process",
    recovery: "diagnostic-only; a lost event is not a gameplay regression",
  }),
  processStore({
    store: "server-crash-telemetry",
    owner: "ServerCrashStore",
    sourceFile: "src/server/ServerCrashStore.ts",
    runtimeExport: "serverCrashStore",
    releaseCritical: false,
    retention: "newest 500 events in the owning process",
    recovery: "diagnostic-only; a lost event is not a gameplay regression",
  }),
  postgresStore({
    store: "match-feedback",
    owner: "MatchFeedbackStore",
    sourceFile: "src/server/MatchFeedbackStore.ts",
    runtimeExport: "matchFeedbackStore",
    releaseCritical: false,
    retention: "30 days in PostgreSQL and process-local fallback",
    recovery:
      "database restore within retention horizon; none for process-local fallback",
  }),
  postgresStore({
    store: "player-stats",
    owner: "PlayerStatsStore",
    sourceFile: "src/server/PlayerStatsStore.ts",
    runtimeExport: "playerStatsStore",
    releaseCritical: true,
  }),
  postgresStore({
    store: "playtest-pulse",
    owner: "PlaytestEvidenceStore",
    sourceFile: "src/server/PlaytestEvidenceStore.ts",
    runtimeExport: "playtestEvidenceStore",
    releaseCritical: true,
    retention:
      "30-day PostgreSQL policy; process lifetime when database disabled",
    recovery: "database restore; none for process-local development fallback",
    probeOwner: "playtest-pulse-readiness",
  }),
  postgresStore({
    store: "prediction-league",
    owner: "PredictionLeagueStore",
    sourceFile: "src/server/PredictionLeagueStore.ts",
    runtimeExport: "predictionLeagueStore",
    releaseCritical: true,
  }),
  postgresStore({
    store: "progression-receipts",
    owner: "ProgressionReceiptStore",
    sourceFile: "src/server/ProgressionReceiptStore.ts",
    runtimeExport: "progressionReceiptStore",
    releaseCritical: true,
  }),
  processStore({
    store: "rematches",
    owner: "RematchStore",
    sourceFile: "src/server/RematchStore.ts",
    runtimeExport: "rematchStore",
    releaseCritical: false,
    retention: "bounded process cache",
    recovery: "client creates a new rematch",
  }),
  processStore({
    store: "replay-highlights",
    owner: "ReplayHighlightStore",
    sourceFile: "src/server/ReplayHighlightStore.ts",
    runtimeExport: "replayHighlightStore",
    releaseCritical: false,
    retention: "bounded process cache",
    recovery: "recompute from a retained replay",
  }),
  postgresStore({
    store: "replays",
    owner: "ReplayStore",
    sourceFile: "src/server/ReplayStore.ts",
    runtimeExport: "replayStore",
    releaseCritical: true,
    retention: "database policy; newest 500 manifests in local development",
    recovery: "database restore; none for process-local development fallback",
    probeOwner: "replay-integrity-posture",
  }),
  postgresStore({
    store: "remote-ai-hourly-budget",
    owner: "RemoteAiPolicy",
    sourceFile: "src/server/RemoteAiPolicy.ts",
    runtimeExport: "reserveRemoteAiCall",
    releaseCritical: true,
    retention: "hourly PostgreSQL reservation rows",
    recovery: "database restore; process-local development resets each process",
    probeOwner: "vaultfront-readiness",
  }),
  postgresStore({
    store: "season-pass",
    owner: "CertifiedSeasonPassStore",
    sourceFile: "src/server/SeasonMilestoneStore.ts",
    runtimeExport: "certifiedSeasonPassStore",
    releaseCritical: true,
  }),
  postgresStore({
    store: "tournaments",
    owner: "TournamentStore",
    sourceFile: "src/server/TournamentStore.ts",
    runtimeExport: "tournamentStore",
    releaseCritical: true,
  }),
  postgresStore({
    store: "game-archive-outbox",
    owner: "ArchiveDeliveryManager",
    sourceFile: "src/server/Archive.ts",
    runtimeExport: "archiveDeliveryManager",
    releaseCritical: true,
    recovery:
      "PostgreSQL retry replay; process-local retries are not restart-safe",
    retention: "database outbox policy; bounded process fallback",
  }),
  {
    store: "season-votes",
    owner: "VaultSeasonScheduler",
    kind: "runtime-state",
    sourceFile: "src/server/VaultSeasonScheduler.ts",
    runtimeExport: "vaultSeasonScheduler",
    capability: "postgres-optional",
    declaredScope: "postgres",
    durability: "database-when-ready",
    replication: "postgres-managed",
    retention: "database policy; active vote in process memory",
    recovery: "database aggregation; active process vote is not recoverable",
    probeOwner: "database-readiness",
    releaseCritical: false,
  },
  {
    store: "experiment-integrity-counters",
    owner: "ExperimentIntegrityGate",
    kind: "runtime-state",
    sourceFile: "src/server/ExperimentIntegrity.ts",
    runtimeExport: null,
    capability: "process-only",
    declaredScope: "process",
    durability: "volatile",
    replication: "none",
    retention: "process lifetime",
    recovery: "none",
    probeOwner: "runtime-integrity-passport",
    releaseCritical: false,
  },
  {
    store: "narrator-and-stream-subscribers",
    owner: "BoundedSseTransport",
    kind: "runtime-state",
    sourceFile: "src/server/BoundedSseTransport.ts",
    runtimeExport: null,
    capability: "process-only",
    declaredScope: "process",
    durability: "volatile",
    replication: "none",
    retention: "connection lifetime",
    recovery: "client reconnect",
    probeOwner: "runtime-integrity-passport",
    releaseCritical: false,
  },
] as const;

export const STATE_STORE_SOURCE_INVENTORY = STATE_SCOPE_REGISTRY.filter(
  (entry) => entry.kind === "store",
).map(({ owner, sourceFile, runtimeExport }) => ({
  owner,
  sourceFile,
  runtimeExport: runtimeExport!,
}));

export interface StateScopeLedgerIntegrity {
  ok: boolean;
  errors: string[];
}

export function inspectStateScopeLedgerIntegrity(
  entries: readonly StateScopeLedgerEntry[] = STATE_SCOPE_REGISTRY,
): StateScopeLedgerIntegrity {
  const errors: string[] = [];
  const stores = new Set<string>();
  const owners = new Set<string>();
  const exports = new Set<string>();
  for (const entry of entries) {
    if (stores.has(entry.store)) errors.push(`duplicate store: ${entry.store}`);
    stores.add(entry.store);
    if (entry.kind === "store") {
      if (owners.has(entry.owner))
        errors.push(`duplicate owner: ${entry.owner}`);
      owners.add(entry.owner);
      if (!entry.runtimeExport) {
        errors.push(`${entry.store}: store owner has no runtime export`);
      } else if (exports.has(entry.runtimeExport)) {
        errors.push(`duplicate runtime export: ${entry.runtimeExport}`);
      } else {
        exports.add(entry.runtimeExport);
      }
      if (!entry.sourceFile.endsWith(".ts")) {
        errors.push(`${entry.store}: store owner has no TypeScript source`);
      }
    }
    if (
      entry.capability === "postgres-optional" &&
      (entry.declaredScope !== "postgres" ||
        entry.durability !== "database-when-ready" ||
        entry.replication !== "postgres-managed")
    ) {
      errors.push(`${entry.store}: postgres capability contradicts scope`);
    }
    if (
      entry.capability === "process-only" &&
      (entry.declaredScope !== "process" ||
        entry.durability !== "volatile" ||
        entry.replication !== "none")
    ) {
      errors.push(`${entry.store}: process capability contradicts scope`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function stateScopeCatalogDigest(
  entries: readonly StateScopeLedgerEntry[] = STATE_SCOPE_REGISTRY,
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex")}`;
}

export function buildStateScopeLedger(database: DatabasePosture) {
  const integrity = inspectStateScopeLedgerIntegrity();
  const catalogDigest = stateScopeCatalogDigest();
  const entries = STATE_SCOPE_REGISTRY.map((entry) => ({
    ...entry,
    effectiveScope:
      entry.capability === "postgres-optional"
        ? database.state === "ready"
          ? ("postgres" as const)
          : ("process" as const)
        : entry.declaredScope,
  }));
  const volatileReleaseCritical = entries.filter(
    (entry) => entry.releaseCritical && entry.effectiveScope === "process",
  );
  return {
    schemaVersion: "2.0" as const,
    observedAt: database.observedAt,
    database,
    catalogDigest,
    integrity,
    summary: {
      stores: entries.length,
      registeredStoreOwners: STATE_STORE_SOURCE_INVENTORY.length,
      volatileStores: entries.filter(
        (entry) => entry.effectiveScope === "process",
      ).length,
      volatileReleaseCriticalStores: volatileReleaseCritical.map(
        (entry) => entry.store,
      ),
      configuredDatabaseFailure:
        database.configured && database.state === "failed",
      releasePersistenceStatus:
        !integrity.ok || (database.configured && database.state === "failed")
          ? ("block" as const)
          : volatileReleaseCritical.length > 0
            ? ("warn" as const)
            : ("pass" as const),
    },
    entries,
  };
}

export type StateScopeLedgerSnapshot = ReturnType<typeof buildStateScopeLedger>;
