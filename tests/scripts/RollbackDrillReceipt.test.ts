import { describe, expect, it } from "vitest";
import {
  createRollbackDrillReceipt,
  verifyRollbackDrillReceipt,
} from "../../scripts/lib/rollback-drill-receipt.mjs";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const target = {
  workflowRunId: 100,
  gitSha: "a".repeat(40),
  imageDigest: digest("1"),
  attestationDigest: digest("2"),
};
const restored = {
  workflowRunId: 200,
  gitSha: "b".repeat(40),
  imageDigest: digest("3"),
  attestationDigest: digest("4"),
};
const validation = {
  workflowRunId: 300,
  operation: "rollback",
  targetSubdomain: "staging",
  rollbackReason: "release-drill",
  evidenceDigest: digest("5"),
  target: {
    stagingRunId: 100,
    attestationDigest: digest("2"),
  },
  replaced: {
    stagingRunId: 200,
    attestationDigest: digest("4"),
  },
};
const input = {
  repository: "VaultSparkStudios/vaultfront",
  workflowRunId: 400,
  workflowRunAttempt: 1,
  origin: "https://staging.vaultfront.io",
  rollbackReason: "release-drill",
  validationReceipt: validation,
  targetAttestation: target,
  replacedAttestation: restored,
  rollbackHealth: '{"status":"ok","scope":"master"}',
  rollbackRevision: target.gitSha,
  restoreHealth: '{"status":"ok","scope":"master"}',
  restoreRevision: restored.gitSha,
  startedAt: "2026-08-13T20:00:00.000Z",
  rolledBackAt: "2026-08-13T20:01:00.000Z",
  completedAt: "2026-08-13T20:02:00.000Z",
};

describe("staging rollback drill receipt", () => {
  it("binds both observed transitions and self-verifies", () => {
    const receipt = createRollbackDrillReceipt(input);
    expect(receipt).toMatchObject({
      drillCompleted: true,
      restoredHealth: true,
      durationMs: 120_000,
      target: { stagingRunId: 100, gitSha: target.gitSha },
      restored: { stagingRunId: 200, gitSha: restored.gitSha },
    });
    expect(verifyRollbackDrillReceipt(receipt)).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("rejects caller drift from the admitted validation", () => {
    expect(() =>
      createRollbackDrillReceipt({
        ...input,
        rollbackReason: "different",
      }),
    ).toThrow("rollback-validation-lineage-mismatch");
  });

  it("detects receipt tampering", () => {
    const receipt = createRollbackDrillReceipt(input);
    receipt.restorationObservation.revision.value = "c".repeat(40);
    expect(verifyRollbackDrillReceipt(receipt)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "rollback-drill-digest-mismatch",
        "restoration-observation-invalid",
      ]),
    });
  });
});
