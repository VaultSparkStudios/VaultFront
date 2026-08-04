import {
  buildCanonicalReleaseObservation,
  canonicalReleaseGateFingerprint,
  evaluateReleaseGateCatalog,
  canonicalReleaseGateCatalog as runtimeCatalog,
  canonicalReleaseGateDefinitions as runtimeDefinitions,
  canonicalReleaseGateNames as runtimeNames,
  validateReleaseGateCatalog,
  verifyCanonicalReleaseObservation,
} from "./release-gate-catalog.mjs";
import releaseGateData from "./release-gates.json";

export type CanonicalReleaseGateName = keyof typeof releaseGateData;
export type ReleaseGateSemantic =
  | "staging-origin"
  | "provenance"
  | "health"
  | "rollback"
  | "revenue"
  | "alpha-human";

export interface CanonicalReleaseGateDefinition {
  readonly id: CanonicalReleaseGateName;
  readonly label: string;
  readonly semantic: ReleaseGateSemantic;
}

export const canonicalReleaseGateCatalog =
  runtimeCatalog as readonly CanonicalReleaseGateDefinition[];
export const canonicalReleaseGateNames =
  runtimeNames as readonly CanonicalReleaseGateName[];
export const canonicalReleaseGateDefinitions =
  runtimeDefinitions as readonly (readonly [
    CanonicalReleaseGateName,
    string,
  ])[];

export {
  buildCanonicalReleaseObservation,
  canonicalReleaseGateFingerprint,
  evaluateReleaseGateCatalog,
  validateReleaseGateCatalog,
  verifyCanonicalReleaseObservation,
};
