import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatePublicShell } from "../../scripts/generate-public-shell.mjs";
import {
  buildCanonicalReleaseObservation,
  buildCiRevisionEvidence,
  buildDeployTopologyEvidence,
  buildReleaseEvidence,
  buildServiceWorkerReleaseEvidence,
  canonicalReleaseGateDefinitions,
  evaluateCanonicalReleaseGates,
  generateReleaseEvidence,
  verifyCiRevisionEvidence,
  verifyReleaseEvidenceLineage,
} from "../../scripts/generate-release-evidence.mjs";

const transfer = {
  initial: {
    gzipBytes: 90,
    brotliBytes: 80,
    maxGzipBytes: 100,
    maxBrotliBytes: 100,
  },
  media: {
    totalBytes: 900,
    largestBytes: 300,
    maxTotalBytes: 1_000,
    maxFileBytes: 400,
  },
};

function verifiedCi(gitSha = "abc123") {
  return buildCiRevisionEvidence({
    gitSha,
    observedAt: "2026-07-17T12:00:00.000Z",
    env: {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "vaultspark/vaultfront",
      GITHUB_WORKFLOW: "CI",
      GITHUB_RUN_ID: "123456",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_SHA: gitSha,
      GITHUB_JOB: "release-evidence",
      VAULTFRONT_CI_VERIFICATION_COMPLETE: "true",
      VAULTFRONT_CI_VERIFICATION_NEEDS:
        "build,test,eslint,prettier,security-audit,bundle-size",
    },
  });
}

describe("Release Evidence Manifest", () => {
  it("binds clean/dirty provenance and exhausted work into the digest", () => {
    const base = {
      generatedAt: "2026-07-17T01:00:00.000Z",
      gitSha: "abc123",
      dirty: false,
      auditSource: "docs/AUDIT_2026-07-16.json",
      auditItems: [
        { slug: "done", status: "shipped" },
        { slug: "external-receipt", status: "externally-blocked" },
      ],
      innovationItems: [{ id: "innovation", status: "shipped" }],
      projectTruth: {
        evaluation: { ok: true, contradictionIds: [] },
        fingerprint: `sha256:${"c".repeat(64)}`,
      },
      transfer,
    };
    const clean = buildReleaseEvidence(base);
    const dirty = buildReleaseEvidence({ ...base, dirty: true });

    expect(clean.work.exhausted).toBe(true);
    expect(clean.transfer.status).toBe("pass");
    expect(clean.source.dirty).toBe(false);
    expect(verifyReleaseEvidenceLineage(clean)).toBe(true);
    expect(clean.status).toBe("blocked");
    expect(clean.launch.gates).toHaveLength(
      canonicalReleaseGateDefinitions.length,
    );
    expect(dirty.source.dirty).toBe(true);
    expect(dirty.evidenceDigest).not.toBe(clean.evidenceDigest);
    const tampered = structuredClone(clean);
    tampered.work.exhausted = false;
    expect(verifyReleaseEvidenceLineage(tampered)).toBe(false);
    const truthTampered = structuredClone(clean);
    truthTampered.projectTruth.fingerprint = `sha256:${"d".repeat(64)}`;
    expect(verifyReleaseEvidenceLineage(truthTampered)).toBe(false);
    const balanceBound = buildReleaseEvidence({
      ...base,
      balanceEnvelope: {
        status: "verified",
        scenarioDigest: `sha256:${"a".repeat(64)}`,
      },
    });
    const balanceTampered = structuredClone(balanceBound);
    balanceTampered.balance.scenarioDigest = `sha256:${"b".repeat(64)}`;
    expect(verifyReleaseEvidenceLineage(balanceTampered)).toBe(false);
    expect(clean.lineage.nodes).toContainEqual(
      expect.objectContaining({
        id: "project-truth",
        kind: "cross-surface-truth",
      }),
    );
  });

  it("keeps pending work and over-budget transfer evidence red", () => {
    const evidence = buildReleaseEvidence({
      generatedAt: "2026-07-17T01:00:00.000Z",
      gitSha: "abc123",
      dirty: false,
      auditSource: "docs/AUDIT_2026-07-16.json",
      auditItems: [{ slug: "pending-audit", status: "pending" }],
      innovationItems: [],
      transfer: {
        ...transfer,
        initial: { ...transfer.initial, gzipBytes: 101 },
      },
    });

    expect(evidence.work.exhausted).toBe(false);
    expect(evidence.work.pendingWork).toEqual(["pending-audit"]);
    expect(evidence.transfer.status).toBe("fail");
  });

  it("fails missing, stale, future, and provenance-free live gates closed", () => {
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    const evaluated = evaluateCanonicalReleaseGates(
      {
        staging: {
          status: "verified",
          observedAt: "2026-07-15T12:00:00.000Z",
          source: "staging-smoke",
          digest: `sha256:${"a".repeat(64)}`,
        },
        stagingParity: {
          status: "verified",
          observedAt: "2026-07-17T13:00:00.000Z",
          source: "parity-probe",
          digest: `sha256:${"b".repeat(64)}`,
        },
        contactEmail: {
          status: "verified",
          observedAt: "2026-07-17T11:00:00.000Z",
          source: "brevo-delivery",
          digest: "not-a-canonical-digest",
        },
      },
      { now },
    );

    expect(evaluated.status).toBe("blocked");
    expect(
      evaluated.gates.find((gate) => gate.gate === "staging"),
    ).toMatchObject({
      status: "block",
      freshness: { state: "stale" },
    });
    expect(
      evaluated.gates.find((gate) => gate.gate === "stagingParity"),
    ).toMatchObject({ status: "block", freshness: { state: "future" } });
    expect(
      evaluated.gates.find((gate) => gate.gate === "contactEmail")?.detail,
    ).toContain("canonical sha256 digest");
    expect(
      evaluated.gates.find((gate) => gate.gate === "founderApproval"),
    ).toMatchObject({ status: "block", evidenceStatus: "missing" });
    expect(
      evaluated.gates.find((gate) => gate.gate === "healthObservation"),
    ).toMatchObject({ status: "block", evidenceStatus: "missing" });
  });

  it("becomes ready only with every fresh sourced gate and a healthy observed runtime", () => {
    const generatedAt = "2026-07-17T12:00:00.000Z";
    const releaseObservations = Object.fromEntries(
      canonicalReleaseGateDefinitions.map(([gate], index) => {
        const observation = {
          status: "verified",
          observedAt: "2026-07-17T11:30:00.000Z",
          source: `probe:${gate}`,
          ...(gate === "healthObservation"
            ? { httpStatus: 200, healthy: true }
            : {}),
          ...(gate === "rollbackObservation"
            ? {
                drillCompleted: true,
                restoredHealth: true,
                imageDigest: `sha256:${"e".repeat(64)}`,
              }
            : {}),
          ...(gate === "revenueObservation"
            ? { live: true, eventType: "checkout", amountCents: 500 }
            : {}),
        };
        return [
          gate,
          ["rollbackObservation", "revenueObservation"].includes(gate)
            ? buildCanonicalReleaseObservation(gate, observation)
            : {
                ...observation,
                digest: `sha256:${index.toString(16).padStart(64, "0")}`,
              },
        ];
      }),
    );
    const evidence = buildReleaseEvidence({
      generatedAt,
      gitSha: "abc123",
      dirty: false,
      auditSource: "docs/AUDIT_2026-07-16.json",
      auditItems: [{ slug: "done", status: "shipped" }],
      innovationItems: [{ id: "innovation", status: "shipped" }],
      transfer,
      releaseObservations,
      localSurfaceEvidence: {
        healthRouteContract: {
          status: "declared",
          source: "Master.ts + Worker.ts",
          observedAt: generatedAt,
          digest: `sha256:${"f".repeat(64)}`,
          detail: "Both routes are statically declared.",
        },
        deploymentTopology: {
          schemaVersion: 1,
          status: "verified",
          authority: "caddy+project-router",
          source: "fixture",
          observedAt: generatedAt,
          sourceDigest: `sha256:${"8".repeat(64)}`,
          failures: [],
          detail: "Verified fixture.",
        },
      },
      serviceWorkerRelease: {
        schemaVersion: 1,
        status: "verified",
        assetPath: "static/assets/sw-proof.js",
        assetDigest: `sha256:${"9".repeat(64)}`,
        byteLength: 123,
        cacheNamespace: "vaultfront-shell:sw-proof.js",
        policyMarkerPresent: true,
        candidates: ["sw-proof.js"],
        detail: "Verified fixture.",
      },
      ciRevision: verifiedCi(),
      authenticatedAlphaGateStatus: "ready",
    });

    expect(evidence).toMatchObject({
      status: "ready",
      blockers: [],
      launch: { status: "ready", runtimeAdvertised: true },
    });
  });

  it("rejects provenance-complete rollback and revenue claims without real event semantics", () => {
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    const generic = {
      status: "verified",
      observedAt: "2026-07-17T11:30:00.000Z",
      source: "operator-note",
      digest: `sha256:${"a".repeat(64)}`,
    };
    const evaluated = evaluateCanonicalReleaseGates(
      {
        rollbackObservation: generic,
        revenueObservation: generic,
      },
      { now },
    );

    expect(
      evaluated.gates.find((gate) => gate.gate === "rollbackObservation"),
    ).toMatchObject({
      status: "block",
      drillCompleted: null,
      restoredHealth: null,
    });
    expect(
      evaluated.gates.find((gate) => gate.gate === "revenueObservation"),
    ).toMatchObject({
      status: "block",
      live: null,
      amountCents: null,
    });
  });

  it("rejects tampered semantic launch observations even when fields remain plausible", () => {
    const observedAt = "2026-07-17T11:30:00.000Z";
    const certified = buildCanonicalReleaseObservation("revenueObservation", {
      status: "verified",
      observedAt,
      source: "checkout:webhook:event-123",
      live: true,
      eventType: "checkout",
      amountCents: 500,
    });
    const tampered = { ...certified, amountCents: 900 };
    const evaluated = evaluateCanonicalReleaseGates(
      { revenueObservation: tampered },
      { now: Date.parse("2026-07-17T12:00:00.000Z") },
    );

    expect(
      evaluated.gates.find((gate) => gate.gate === "revenueObservation"),
    ).toMatchObject({ status: "block", amountCents: 900 });
    expect(
      evaluated.gates.find((gate) => gate.gate === "revenueObservation")
        ?.detail,
    ).toContain("canonical semantic launch-observation payload");
  });

  it("binds the sole-ingress topology fingerprint and fails on a secondary ingress", () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), "vaultfront-topology-"),
    );
    try {
      fs.mkdirSync(path.join(fixture, "docs"), { recursive: true });
      fs.writeFileSync(
        path.join(fixture, "Dockerfile"),
        'HEALTHCHECK CMD curl -f http://127.0.0.1/_health\nCMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]\n',
      );
      fs.writeFileSync(
        path.join(fixture, "supervisord.conf"),
        "[supervisord]\n",
      );
      fs.writeFileSync(
        path.join(fixture, "update.sh"),
        'DEPLOY_INGRESS_PORT=8999\nactivate_route "$CONTAINER_NAME" "$GHCR_IMAGE"\necho "127.0.0.1:${DEPLOY_INGRESS_PORT}"\n',
      );
      fs.writeFileSync(
        path.join(fixture, "docs/DEPLOY_RUNTIME_RUNBOOK.md"),
        "Caddy is the sole public ingress authority.\n",
      );
      const verified = buildDeployTopologyEvidence(
        fixture,
        "2026-07-17T12:00:00.000Z",
      );
      expect(verified.authority).toBe("caddy+project-router");
      fs.appendFileSync(
        path.join(fixture, "Dockerfile"),
        "RUN cloudflared tunnel run\n",
      );
      const contradicted = buildDeployTopologyEvidence(
        fixture,
        "2026-07-17T12:00:00.000Z",
      );

      expect(verified).toMatchObject({
        status: "verified",
        authority: "caddy+project-router",
      });
      expect(contradicted).toMatchObject({ status: "failed", authority: null });
      expect(contradicted.failures).toContain(
        "secondary-cloudflare-ingress-present",
      );
      expect(contradicted.sourceDigest).not.toBe(verified.sourceDigest);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("requires the post-verification fan-in contract for the exact release revision", () => {
    const verified = verifiedCi();
    expect(verified).toMatchObject({
      status: "verified",
      provider: "github-actions",
      sha: "abc123",
      runAttempt: "2",
    });
    expect(verifyCiRevisionEvidence(verified, "abc123")).toBe(true);
    expect(verifyCiRevisionEvidence(verified, "different-sha")).toBe(false);

    const stillRunning = buildCiRevisionEvidence({
      gitSha: "abc123",
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "vaultspark/vaultfront",
        GITHUB_WORKFLOW: "CI",
        GITHUB_RUN_ID: "123456",
        GITHUB_SHA: "abc123",
      },
    });
    expect(stillRunning).toMatchObject({
      status: "incomplete",
      verificationComplete: false,
    });
    expect(verifyCiRevisionEvidence(stillRunning, "abc123")).toBe(false);

    const mismatched = buildCiRevisionEvidence({
      gitSha: "abc123",
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "vaultspark/vaultfront",
        GITHUB_WORKFLOW: "CI",
        GITHUB_RUN_ID: "123456",
        GITHUB_SHA: "old-sha",
      },
    });
    expect(mismatched.status).toBe("mismatched");
    const evidence = buildReleaseEvidence({
      generatedAt: "2026-07-17T12:00:00.000Z",
      gitSha: "abc123",
      dirty: false,
      auditItems: [],
      innovationItems: [],
      transfer,
      ciRevision: mismatched,
    });
    expect(evidence.blockers).toContainEqual(
      expect.stringContaining("ciRevision:"),
    );

    const tampered = structuredClone(verified);
    tampered.workflow = "Tampered";
    expect(verifyCiRevisionEvidence(tampered, "abc123")).toBe(false);
  });

  it("binds exact service-worker release evidence and rejects missing, duplicate, or markerless assets", () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), "vaultfront-service-worker-release-"),
    );
    try {
      fs.mkdirSync(path.join(fixture, "static", "assets"), {
        recursive: true,
      });
      expect(buildServiceWorkerReleaseEvidence(fixture)).toMatchObject({
        status: "missing",
        candidates: [],
      });

      const workerPath = path.join(
        fixture,
        "static",
        "assets",
        "sw-alpha123.js",
      );
      fs.writeFileSync(workerPath, 'const cache = "vaultfront-shell:";\n');
      const verified = buildServiceWorkerReleaseEvidence(fixture);
      expect(verified).toMatchObject({
        status: "verified",
        assetPath: "static/assets/sw-alpha123.js",
        cacheNamespace: "vaultfront-shell:sw-alpha123.js",
        policyMarkerPresent: true,
      });
      expect(verified.assetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

      fs.writeFileSync(
        path.join(fixture, "static", "assets", "sw-beta456.js"),
        'const cache = "vaultfront-shell:";\n',
      );
      expect(buildServiceWorkerReleaseEvidence(fixture)).toMatchObject({
        status: "invalid",
        candidates: ["sw-alpha123.js", "sw-beta456.js"],
      });
      fs.rmSync(path.join(fixture, "static", "assets", "sw-beta456.js"));
      fs.writeFileSync(
        workerPath,
        "self.addEventListener('fetch', () => {});\n",
      );
      expect(buildServiceWorkerReleaseEvidence(fixture)).toMatchObject({
        status: "invalid",
        policyMarkerPresent: false,
      });
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("does not advertise a statically declared but unobserved runtime", () => {
    const evidence = buildReleaseEvidence({
      generatedAt: "2026-07-17T12:00:00.000Z",
      gitSha: "abc123",
      dirty: false,
      auditSource: "docs/AUDIT_2026-07-16.json",
      auditItems: [{ slug: "done", status: "shipped" }],
      innovationItems: [{ id: "innovation", status: "shipped" }],
      transfer,
      localSurfaceEvidence: {
        healthRouteContract: {
          status: "declared",
          source: "Master.ts + Worker.ts",
          observedAt: "2026-07-17T12:00:00.000Z",
          digest: `sha256:${"f".repeat(64)}`,
          detail: "Both routes are statically declared.",
        },
      },
    });

    expect(evidence.localSurface).toHaveProperty("healthRouteContract");
    expect(evidence.localSurface).not.toHaveProperty("healthEndpoint");
    expect(evidence.launch.runtimeAdvertised).toBe(false);
    expect(evidence.launch.gates).toContainEqual(
      expect.objectContaining({
        gate: "healthObservation",
        status: "block",
        evidenceStatus: "missing",
      }),
    );
  });

  it("rejects a fresh provenance-backed HTTP 503 health observation", () => {
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    const evaluated = evaluateCanonicalReleaseGates(
      {
        healthObservation: {
          status: "verified",
          observedAt: "2026-07-17T11:59:00.000Z",
          source: "staging:/_health",
          digest: `sha256:${"e".repeat(64)}`,
          httpStatus: 503,
          healthy: false,
        },
      },
      { now },
    );
    const health = evaluated.gates.find(
      (gate) => gate.gate === "healthObservation",
    );

    expect(health).toMatchObject({
      status: "block",
      evidenceStatus: "verified",
      httpStatus: 503,
      healthy: false,
      freshness: { state: "fresh" },
    });
    expect(health?.detail).toContain("HTTP 503");
  });

  it("reports blocked without external proof in an isolated unbuilt fixture", () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), "vaultfront-release-evidence-"),
    );
    try {
      fs.mkdirSync(path.join(fixture, "static", "assets"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(fixture, "src", "server"), { recursive: true });
      fs.mkdirSync(path.join(fixture, "public"), { recursive: true });
      fs.writeFileSync(
        path.join(fixture, ".bundlewatch.json"),
        JSON.stringify({
          initialEntry: {
            html: "static/index.html",
            baselineGzipBytes: 1_024,
            baselineBrotliBytes: 1_024,
            crossPlatformVariancePercent: 0,
          },
          media: {
            root: "static/assets",
            extensions: [".png"],
            maxTotalBytes: 1_024,
            maxFileBytes: 1_024,
          },
        }),
      );
      fs.writeFileSync(
        path.join(fixture, "static", "index.html"),
        "<!doctype html><html><head></head><body></body></html>",
      );
      for (const source of ["Master.ts", "Worker.ts"]) {
        fs.writeFileSync(
          path.join(fixture, "src", "server", source),
          'app.get("/_health", handler);\n',
        );
      }
      fs.writeFileSync(
        path.join(fixture, "public", "footer-manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          brandHref: "https://vaultsparkstudios.com",
          copyright: "© 2026 VaultSpark Studios LLC. All rights reserved.",
          headerLinks: [{ href: "/", label: "Play" }],
          footerLinks: [
            { href: "/", label: "Play" },
            { href: "/privacy/", label: "Privacy" },
            { href: "/terms/", label: "Terms" },
          ],
          footerOnly: ["/privacy/", "/terms/"],
          legalPages: ["/privacy/", "/terms/"],
          requiredLinks: ["/privacy/", "/terms/"],
          pages: [{ route: "/", source: "public/index.html" }],
        }),
      );
      fs.writeFileSync(
        path.join(fixture, "public", "index.html"),
        '<nav><a href="/">Play</a></nav><footer><a href="https://vaultsparkstudios.com">VaultSpark Studios</a><a href="/">Play</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a>© 2026 VaultSpark Studios LLC. All rights reserved.</footer>',
      );
      generatePublicShell(fixture, true);

      const { evidence } = generateReleaseEvidence(fixture);
      expect(evidence.status).toBe("blocked");
      expect(evidence.launch.status).toBe("blocked");
      expect(evidence.source.observationBundle.state).toBe("missing");
      expect(evidence.localSurface.healthRouteContract).toMatchObject({
        status: "declared",
      });
      expect(evidence.localSurface).not.toHaveProperty("healthEndpoint");
      expect(evidence.launch.runtimeAdvertised).toBe(false);
      expect(evidence.launch.gates).toContainEqual(
        expect.objectContaining({
          gate: "founderApproval",
          status: "block",
          evidenceStatus: "missing",
        }),
      );
      expect(evidence.launch.gates).toContainEqual(
        expect.objectContaining({ gate: "footerManifest", status: "pass" }),
      );
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }, 15_000);
});
