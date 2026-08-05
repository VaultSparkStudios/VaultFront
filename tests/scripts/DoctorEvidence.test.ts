import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadDoctorEvidence,
  writeDoctorEvidence,
} from "../../scripts/lib/doctor-evidence.mjs";

const roots: string[] = [];

afterEach(() => {
  while (roots.length)
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultfront-doctor-"));
  roots.push(root);
  return root;
}

function report() {
  return {
    observedAt: "2026-08-04T12:00:00.000Z",
    source: "scripts/project-doctor.mjs",
    blockingFailing: 0,
    warnings: [],
    checks: [{ id: "truth", status: "pass", exitCode: 0 }],
  };
}

describe("hash-bound doctor evidence", () => {
  it("writes one atomic sidecar and reloads it through the compact summary", () => {
    const root = fixtureRoot();
    const metadata = writeDoctorEvidence(root, report());
    const loaded = loadDoctorEvidence(root, {
      evidencePath: metadata.path,
      evidenceDigest: metadata.digest,
      checkCount: metadata.checkCount,
    });
    expect(metadata.path).toBe("audits/doctor-latest.json");
    expect(metadata.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(loaded).toMatchObject({ ok: true, checks: report().checks });
  });

  it("fails closed on missing, unsafe, or tampered evidence", () => {
    const root = fixtureRoot();
    const metadata = writeDoctorEvidence(root, report());
    const target = path.join(root, metadata.path);
    const evidence = JSON.parse(fs.readFileSync(target, "utf8"));
    evidence.checks[0].status = "fail";
    fs.writeFileSync(target, JSON.stringify(evidence));
    expect(
      loadDoctorEvidence(root, {
        evidencePath: metadata.path,
        evidenceDigest: metadata.digest,
        checkCount: metadata.checkCount,
      }),
    ).toMatchObject({ ok: false, error: "doctor-evidence-digest-mismatch" });
    expect(
      loadDoctorEvidence(root, {
        evidencePath: "../outside.json",
        evidenceDigest: metadata.digest,
      }),
    ).toMatchObject({ ok: false, error: "missing-or-unsafe-evidence-path" });
    fs.rmSync(target);
    expect(
      loadDoctorEvidence(root, {
        evidencePath: metadata.path,
        evidenceDigest: metadata.digest,
      }),
    ).toMatchObject({ ok: false, error: "doctor-evidence-missing" });
  });

  it("retains backwards-compatible reads for legacy embedded checks", () => {
    expect(
      loadDoctorEvidence(fixtureRoot(), { checks: report().checks }),
    ).toMatchObject({
      ok: true,
      source: "legacy-embedded",
      checks: report().checks,
    });
  });
});
