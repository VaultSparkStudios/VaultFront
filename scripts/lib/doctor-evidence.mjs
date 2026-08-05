import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomicSync } from "./write-project-status.mjs";

export const DOCTOR_EVIDENCE_SCHEMA_VERSION = 1;
export const DOCTOR_EVIDENCE_PATH = "audits/doctor-latest.json";

export function doctorEvidenceDigest(evidence) {
  return `sha256:${createHash("sha256").update(JSON.stringify(evidence)).digest("hex")}`;
}

export function buildDoctorEvidence(report) {
  return {
    schemaVersion: DOCTOR_EVIDENCE_SCHEMA_VERSION,
    observedAt: report.observedAt,
    source: report.source,
    blockingFailing: report.blockingFailing,
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
    checks: Array.isArray(report.checks) ? report.checks : [],
  };
}

export function writeDoctorEvidence(root, report) {
  const evidence = buildDoctorEvidence(report);
  const target = path.join(root, DOCTOR_EVIDENCE_PATH);
  writeJsonAtomicSync(target, evidence);
  return {
    path: DOCTOR_EVIDENCE_PATH,
    digest: doctorEvidenceDigest(evidence),
    schemaVersion: DOCTOR_EVIDENCE_SCHEMA_VERSION,
    checkCount: evidence.checks.length,
  };
}

function resolveEvidencePath(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return null;
  }
  return resolved;
}

/** Load full detail only when a consumer needs it; legacy embedded checks remain readable. */
export function loadDoctorEvidence(root, doctorScore) {
  if (Array.isArray(doctorScore?.checks)) {
    return {
      ok: true,
      source: "legacy-embedded",
      checks: doctorScore.checks,
      evidence: null,
    };
  }

  const resolved = resolveEvidencePath(root, doctorScore?.evidencePath);
  if (!resolved) {
    return { ok: false, error: "missing-or-unsafe-evidence-path", checks: [] };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: "doctor-evidence-missing", checks: [] };
  }

  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    return { ok: false, error: "doctor-evidence-invalid-json", checks: [] };
  }
  if (evidence.schemaVersion !== DOCTOR_EVIDENCE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: "doctor-evidence-schema-unsupported",
      checks: [],
    };
  }
  const digest = doctorEvidenceDigest(evidence);
  if (digest !== doctorScore?.evidenceDigest) {
    return { ok: false, error: "doctor-evidence-digest-mismatch", checks: [] };
  }
  if (!Array.isArray(evidence.checks)) {
    return { ok: false, error: "doctor-evidence-checks-missing", checks: [] };
  }
  if (
    Number.isSafeInteger(doctorScore?.checkCount) &&
    evidence.checks.length !== doctorScore.checkCount
  ) {
    return { ok: false, error: "doctor-evidence-count-mismatch", checks: [] };
  }
  return {
    ok: true,
    source: doctorScore.evidencePath,
    checks: evidence.checks,
    evidence,
  };
}
