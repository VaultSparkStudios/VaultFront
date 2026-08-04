import {
  evaluateReleaseGateCatalog,
  canonicalReleaseGateNames as sharedReleaseGateNames,
  type CanonicalReleaseGateName as SharedReleaseGateName,
} from "../shared/ReleaseGateCatalog";

export type ReleaseObservationStatus = "verified" | "failed" | "missing";

export interface ReleaseGateObservation {
  status: ReleaseObservationStatus;
  observedAt?: string;
  source?: string;
  digest?: string;
  detail?: string;
  httpStatus?: number;
  healthy?: boolean;
  drillCompleted?: boolean;
  imageDigest?: string;
  restoredHealth?: boolean;
  live?: boolean;
  eventType?: "checkout" | "supporter";
  amountCents?: number;
}

export const canonicalReleaseGateNames = sharedReleaseGateNames;
export type CanonicalReleaseGateName = SharedReleaseGateName;

export interface CanonicalReleaseEvidenceInput {
  alphaGateStatus?: "not-started" | "warming" | "blocked" | "ready";
  observations?: Partial<
    Record<CanonicalReleaseGateName, ReleaseGateObservation>
  >;
  now?: number;
  maxAgeMs?: number;
}

export interface EvaluatedReleaseGate {
  gate: CanonicalReleaseGateName;
  label: string;
  status: "pass" | "block";
  evidenceStatus: ReleaseObservationStatus;
  source: string | null;
  observedAt: string | null;
  digest: string | null;
  freshness: {
    state: string;
    ageMs: number | null;
    maxAgeMs: number;
  };
  detail: string;
}

export interface CanonicalReleaseEvidence {
  schemaVersion: 1;
  status: "ready" | "blocked";
  evaluatedAt: string;
  maxAgeMs: number;
  catalogFingerprint: string;
  gates: EvaluatedReleaseGate[];
  blockers: string[];
}

export function evaluateCanonicalReleaseEvidence(
  input: CanonicalReleaseEvidenceInput = {},
): CanonicalReleaseEvidence {
  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? 24 * 60 * 60 * 1_000;
  return evaluateReleaseGateCatalog(input.observations, {
    now,
    maxAgeMs,
    alphaGateStatus: input.alphaGateStatus,
  }) as CanonicalReleaseEvidence;
}
