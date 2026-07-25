import { createHash } from "node:crypto";
import type { DatabasePosture } from "./db/pool";

export type StateDurability =
  "volatile" | "database-when-ready" | "filesystem-signed";

export interface StateScopeLedgerEntry {
  store: string;
  owner: string;
  capability: "postgres-optional" | "process-only" | "signed-filesystem";
  declaredScope: "process" | "worker-filesystem" | "postgres";
  durability: StateDurability;
  replication: "none" | "postgres-managed";
  retention: string;
  recovery: string;
  probeOwner: string;
  releaseCritical: boolean;
}

const STATE_SCOPE_LEDGER: readonly StateScopeLedgerEntry[] = [
  {
    store: "player-stats",
    owner: "PlayerStatsStore",
    capability: "postgres-optional",
    declaredScope: "postgres",
    durability: "database-when-ready",
    replication: "postgres-managed",
    retention: "database policy; process lifetime when database disabled",
    recovery: "database restore; none for process-local fallback",
    probeOwner: "database-readiness",
    releaseCritical: true,
  },
  {
    store: "certified-outcomes",
    owner: "CertifiedOutcomeStore",
    capability: "postgres-optional",
    declaredScope: "postgres",
    durability: "database-when-ready",
    replication: "postgres-managed",
    retention: "database policy; process lifetime when database disabled",
    recovery: "database restore; none for process-local fallback",
    probeOwner: "database-readiness",
    releaseCritical: true,
  },
  {
    store: "achievements",
    owner: "AchievementStore",
    capability: "postgres-optional",
    declaredScope: "postgres",
    durability: "database-when-ready",
    replication: "postgres-managed",
    retention: "database policy; process lifetime when database disabled",
    recovery: "database restore; none for process-local fallback",
    probeOwner: "database-readiness",
    releaseCritical: true,
  },
  {
    store: "clans",
    owner: "ClanStore",
    capability: "postgres-optional",
    declaredScope: "postgres",
    durability: "database-when-ready",
    replication: "postgres-managed",
    retention: "database policy; process lifetime when database disabled",
    recovery: "database restore; none for process-local fallback",
    probeOwner: "database-readiness",
    releaseCritical: true,
  },
  {
    store: "tournaments",
    owner: "TournamentStore",
    capability: "postgres-optional",
    declaredScope: "postgres",
    durability: "database-when-ready",
    replication: "postgres-managed",
    retention: "database policy; process lifetime when database disabled",
    recovery: "database restore; none for process-local fallback",
    probeOwner: "database-readiness",
    releaseCritical: true,
  },
  {
    store: "season-votes",
    owner: "VaultSeasonScheduler",
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
    store: "replays-and-highlights",
    owner: "ReplayStore",
    capability: "signed-filesystem",
    declaredScope: "worker-filesystem",
    durability: "filesystem-signed",
    replication: "none",
    retention: "worker filesystem policy",
    recovery: "signed file reload on the same worker volume",
    probeOwner: "replay-integrity-posture",
    releaseCritical: true,
  },
  {
    store: "playtest-pulse",
    owner: "PlaytestEvidenceStore",
    capability: "postgres-optional",
    declaredScope: "postgres",
    durability: "database-when-ready",
    replication: "postgres-managed",
    retention:
      "30-day PostgreSQL policy; process lifetime when database disabled",
    recovery: "database restore; none for process-local development fallback",
    probeOwner: "playtest-pulse-readiness",
    releaseCritical: true,
  },
  {
    store: "experiment-integrity-counters",
    owner: "ExperimentIntegrityGate",
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

export interface StateScopeLedgerIntegrity {
  ok: boolean;
  errors: string[];
}

/**
 * Executable consistency check for the handwritten ownership catalog. Runtime
 * readiness includes this result so an impossible owner/scope combination
 * blocks instead of becoming persuasive but false observability.
 */
export function inspectStateScopeLedgerIntegrity(
  entries: readonly StateScopeLedgerEntry[] = STATE_SCOPE_LEDGER,
): StateScopeLedgerIntegrity {
  const errors: string[] = [];
  const stores = new Set<string>();
  for (const entry of entries) {
    if (stores.has(entry.store)) errors.push(`duplicate store: ${entry.store}`);
    stores.add(entry.store);
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
    if (
      entry.capability === "signed-filesystem" &&
      (entry.declaredScope !== "worker-filesystem" ||
        entry.durability !== "filesystem-signed")
    ) {
      errors.push(`${entry.store}: filesystem capability contradicts scope`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function stateScopeCatalogDigest(
  entries: readonly StateScopeLedgerEntry[] = STATE_SCOPE_LEDGER,
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex")}`;
}

export function buildStateScopeLedger(database: DatabasePosture) {
  const integrity = inspectStateScopeLedgerIntegrity();
  const catalogDigest = stateScopeCatalogDigest();
  const entries = STATE_SCOPE_LEDGER.map((entry) => ({
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
    schemaVersion: "1.0" as const,
    observedAt: database.observedAt,
    database,
    catalogDigest,
    integrity,
    summary: {
      stores: entries.length,
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
