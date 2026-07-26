import { createHash } from "node:crypto";
import balanceAuthority from "../../config/vaultfront-balance.v1.json";

export interface VaultFrontBalanceIdentity {
  authority: string;
  authorityFingerprint: `sha256:${string}`;
}

export function buildVaultFrontBalanceIdentity(
  authority: unknown = balanceAuthority,
): VaultFrontBalanceIdentity {
  const authorityName =
    typeof authority === "object" &&
    authority !== null &&
    "authority" in authority &&
    typeof authority.authority === "string"
      ? authority.authority
      : "unknown";
  return Object.freeze({
    authority: authorityName,
    authorityFingerprint: `sha256:${createHash("sha256")
      .update(JSON.stringify(authority))
      .digest("hex")}`,
  });
}

export const vaultFrontBalanceIdentity = buildVaultFrontBalanceIdentity();
