import fs from "node:fs";
import releaseEvidencePolicy from "../../config/release-evidence-trust.json";
import { verifyRuntimeReleaseEvidenceBundle } from "../shared/runtime-release-evidence.mjs";
import type { CanonicalReleaseEvidenceInput } from "./ReleaseEvidenceContract";

const MAX_BUNDLE_BYTES = 256 * 1024;

export interface RuntimeReleaseEvidenceResult {
  releaseEvidence: CanonicalReleaseEvidenceInput;
  errors: string[];
}

function runtimeOrigin(environment: NodeJS.ProcessEnv): string | null {
  const domain = environment.DOMAIN?.trim();
  const subdomain = environment.SUBDOMAIN?.trim();
  if (!domain || !subdomain) return null;
  return subdomain === "main"
    ? `https://${domain}`
    : `https://${subdomain}.${domain}`;
}

export function loadRuntimeReleaseEvidence(
  environment: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): RuntimeReleaseEvidenceResult {
  const evidencePath = environment.VAULTFRONT_RELEASE_EVIDENCE_PATH?.trim();
  const origin = runtimeOrigin(environment);
  const gitSha = environment.GIT_COMMIT?.trim();
  const imageDigest = environment.GHCR_IMAGE?.split("@").at(-1)?.trim();
  const runtimeEnvironment = environment.GAME_ENV?.trim();
  if (!evidencePath) return { releaseEvidence: {}, errors: [] };
  if (!origin || !gitSha || !imageDigest || !runtimeEnvironment) {
    return {
      releaseEvidence: {},
      errors: ["runtime-evidence-binding-incomplete"],
    };
  }
  try {
    const stat = fs.statSync(evidencePath);
    if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES)
      return { releaseEvidence: {}, errors: ["invalid-bundle-file"] };
    const bundle = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    const verified = verifyRuntimeReleaseEvidenceBundle(bundle, {
      policy: releaseEvidencePolicy,
      runtime: {
        environment: runtimeEnvironment,
        origin,
        gitSha,
        imageDigest,
      },
      now,
    });
    return {
      releaseEvidence: { observations: verified.observations },
      errors: verified.errors,
    };
  } catch {
    return { releaseEvidence: {}, errors: ["bundle-read-failed"] };
  }
}
