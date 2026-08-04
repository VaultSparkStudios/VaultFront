import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const releaseGateData = require("./release-gates.json");
const ALLOWED_SEMANTICS = new Set([
  "staging-origin",
  "provenance",
  "health",
  "rollback",
  "revenue",
  "alpha-human",
]);
const SPECIALIZED_SEMANTICS = [
  "staging-origin",
  "health",
  "rollback",
  "revenue",
  "alpha-human",
];

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function catalogPayload(catalog) {
  return catalog.map(({ id, label, semantic }) => ({ id, label, semantic }));
}

export function validateReleaseGateCatalog(catalog) {
  const errors = [];
  const ids = new Set();
  for (const [index, definition] of catalog.entries()) {
    if (!definition || typeof definition !== "object") {
      errors.push(`entry ${index} is not an object`);
      continue;
    }
    if (!/^[a-z][A-Za-z0-9]*$/.test(definition.id ?? "")) {
      errors.push(`entry ${index} has an invalid id`);
    } else if (ids.has(definition.id)) {
      errors.push(`duplicate gate id: ${definition.id}`);
    } else {
      ids.add(definition.id);
    }
    if (!definition.label?.trim()) {
      errors.push(`${definition.id ?? `entry ${index}`} has an empty label`);
    }
    if (!ALLOWED_SEMANTICS.has(definition.semantic)) {
      errors.push(
        `${definition.id ?? `entry ${index}`} has unknown semantic ${definition.semantic ?? "missing"}`,
      );
    }
  }
  for (const semantic of SPECIALIZED_SEMANTICS) {
    const count = catalog.filter(
      (entry) => entry?.semantic === semantic,
    ).length;
    if (count !== 1) {
      errors.push(
        `semantic ${semantic} must be owned by exactly one gate; found ${count}`,
      );
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    fingerprint: sha256(JSON.stringify(catalogPayload(catalog))),
  };
}

const loadedCatalog = Object.entries(releaseGateData).map(([id, definition]) =>
  Object.freeze({
    id,
    label: definition.label,
    semantic: definition.semantic,
  }),
);
const validation = validateReleaseGateCatalog(loadedCatalog);
if (!validation.ok) {
  throw new Error(
    `Invalid release-gate catalog: ${validation.errors.join("; ")}`,
  );
}

export const canonicalReleaseGateCatalog = Object.freeze(loadedCatalog);
export const canonicalReleaseGateNames = Object.freeze(
  canonicalReleaseGateCatalog.map(({ id }) => id),
);
export const canonicalReleaseGateDefinitions = Object.freeze(
  canonicalReleaseGateCatalog.map(({ id, label }) =>
    Object.freeze([id, label]),
  ),
);
export const canonicalReleaseGateFingerprint = validation.fingerprint;

function releaseGateDefinition(key) {
  const definition = canonicalReleaseGateCatalog.find(({ id }) => id === key);
  if (!definition) throw new Error(`Unknown canonical release gate: ${key}`);
  return definition;
}

function canonicalReleaseObservationPayload(key, observation) {
  const definition = releaseGateDefinition(key);
  const common = {
    gate: key,
    status: observation?.status ?? null,
    source: observation?.source ?? null,
    observedAt: observation?.observedAt ?? null,
  };
  if (definition.semantic === "rollback") {
    return {
      ...common,
      drillCompleted: observation?.drillCompleted ?? null,
      imageDigest: observation?.imageDigest ?? null,
      restoredHealth: observation?.restoredHealth ?? null,
    };
  }
  if (definition.semantic === "revenue") {
    return {
      ...common,
      live: observation?.live ?? null,
      eventType: observation?.eventType ?? null,
      amountCents: observation?.amountCents ?? null,
    };
  }
  return common;
}

export function buildCanonicalReleaseObservation(key, observation) {
  const payload = canonicalReleaseObservationPayload(key, observation);
  return { ...observation, digest: sha256(JSON.stringify(payload)) };
}

export function verifyCanonicalReleaseObservation(key, observation) {
  if (!observation) return false;
  return (
    observation.digest ===
    sha256(JSON.stringify(canonicalReleaseObservationPayload(key, observation)))
  );
}

function evaluateObservation(definition, observation, now, maxAgeMs) {
  const observedAtMs = observation?.observedAt
    ? Date.parse(observation.observedAt)
    : Number.NaN;
  const ageMs = Number.isFinite(observedAtMs) ? now - observedAtMs : null;
  const freshnessState =
    ageMs === null
      ? "missing"
      : ageMs < 0
        ? "future"
        : ageMs > maxAgeMs
          ? "stale"
          : "fresh";
  const sourceComplete = Boolean(observation?.source?.trim());
  const digestComplete = /^sha256:[0-9a-f]{64}$/i.test(
    observation?.digest ?? "",
  );
  const verified = observation?.status === "verified";
  const provenancePass =
    verified && freshnessState === "fresh" && sourceComplete && digestComplete;
  const semanticDigestPass =
    !["rollback", "revenue"].includes(definition.semantic) ||
    verifyCanonicalReleaseObservation(definition.id, observation);
  const semanticPass =
    definition.semantic === "health"
      ? observation?.httpStatus === 200 && observation?.healthy === true
      : definition.semantic === "rollback"
        ? observation?.drillCompleted === true &&
          observation?.restoredHealth === true &&
          /^sha256:[0-9a-f]{64}$/i.test(observation?.imageDigest ?? "")
        : definition.semantic === "revenue"
          ? observation?.live === true &&
            ["checkout", "supporter"].includes(observation?.eventType) &&
            Number.isInteger(observation?.amountCents) &&
            observation.amountCents > 0
          : true;
  const pass = provenancePass && semanticPass && semanticDigestPass;
  let detail;
  if (!observation) detail = "No evidence observation is attached.";
  else if (!verified)
    detail =
      observation.detail ??
      `Evidence status is ${observation.status ?? "missing"}.`;
  else if (freshnessState !== "fresh")
    detail = `Evidence is missing a valid fresh timestamp (${freshnessState}).`;
  else if (!sourceComplete || !digestComplete)
    detail =
      "Evidence is missing source or digest provenance; a canonical sha256 digest is required.";
  else if (!semanticDigestPass)
    detail =
      "Evidence digest does not match the canonical semantic launch-observation payload.";
  else if (definition.semantic === "health" && observation.httpStatus !== 200)
    detail = `Runtime health probe returned HTTP ${observation.httpStatus ?? "unknown"}; HTTP 200 is required.`;
  else if (definition.semantic === "health" && observation.healthy !== true)
    detail =
      "Runtime health probe did not provide an explicit healthy=true observation.";
  else if (
    definition.semantic === "rollback" &&
    observation.drillCompleted !== true
  )
    detail = "Rollback evidence must record drillCompleted=true.";
  else if (
    definition.semantic === "rollback" &&
    !/^sha256:[0-9a-f]{64}$/i.test(observation.imageDigest ?? "")
  )
    detail =
      "Rollback evidence must bind the restored image with a canonical sha256 digest.";
  else if (
    definition.semantic === "rollback" &&
    observation.restoredHealth !== true
  )
    detail =
      "Rollback evidence must record restoredHealth=true after the drill.";
  else if (definition.semantic === "revenue" && observation.live !== true)
    detail = "Revenue evidence must explicitly identify a live event.";
  else if (
    definition.semantic === "revenue" &&
    !["checkout", "supporter"].includes(observation.eventType)
  )
    detail =
      "Revenue evidence must identify a checkout or supporter event type.";
  else if (
    definition.semantic === "revenue" &&
    (!Number.isInteger(observation.amountCents) || observation.amountCents <= 0)
  )
    detail = "Revenue evidence must include a positive integer amountCents.";
  else
    detail = observation.detail ?? "Fresh provenance-backed evidence verified.";
  return {
    gate: definition.id,
    label: definition.label,
    status: pass ? "pass" : "block",
    evidenceStatus: observation?.status ?? "missing",
    source: observation?.source ?? null,
    observedAt: observation?.observedAt ?? null,
    digest: observation?.digest ?? null,
    ...(definition.semantic === "health"
      ? {
          httpStatus: observation?.httpStatus ?? null,
          healthy: observation?.healthy ?? null,
        }
      : {}),
    ...(definition.semantic === "rollback"
      ? {
          drillCompleted: observation?.drillCompleted ?? null,
          imageDigest: observation?.imageDigest ?? null,
          restoredHealth: observation?.restoredHealth ?? null,
        }
      : {}),
    ...(definition.semantic === "revenue"
      ? {
          live: observation?.live ?? null,
          eventType: observation?.eventType ?? null,
          amountCents: observation?.amountCents ?? null,
        }
      : {}),
    freshness: { state: freshnessState, ageMs, maxAgeMs },
    detail,
  };
}

export function evaluateReleaseGateCatalog(
  observations = {},
  {
    now = Date.now(),
    maxAgeMs = 24 * 60 * 60 * 1_000,
    alphaGateStatus = "not-started",
  } = {},
) {
  const gates = canonicalReleaseGateCatalog.map((definition) => {
    if (definition.semantic !== "alpha-human") {
      return evaluateObservation(
        definition,
        observations[definition.id],
        now,
        maxAgeMs,
      );
    }
    const ready = alphaGateStatus === "ready";
    return {
      gate: definition.id,
      label: definition.label,
      status: ready ? "pass" : "block",
      evidenceStatus: ready ? "verified" : "missing",
      source: alphaGateStatus ? "playtestPulse.alphaGate" : null,
      observedAt: null,
      digest: null,
      freshness: { state: "not-applicable", ageMs: null, maxAgeMs },
      detail: ready
        ? "Authenticated human alpha gate is ready."
        : `Authenticated human alpha gate is ${alphaGateStatus ?? "not attached"}; generic release observations cannot satisfy this gate.`,
    };
  });
  const blockers = gates
    .filter((gate) => gate.status === "block")
    .map((gate) => `${gate.gate}: ${gate.detail}`);
  return {
    schemaVersion: 1,
    status: blockers.length === 0 ? "ready" : "blocked",
    evaluatedAt: new Date(now).toISOString(),
    maxAgeMs,
    catalogFingerprint: canonicalReleaseGateFingerprint,
    gates,
    blockers,
  };
}
