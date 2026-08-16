import { describe, expect, it } from "vitest";
import {
  emailDnsRequirements,
  planEmailDns,
} from "../../scripts/configure-email-dns.mjs";

const code = "0123456789abcdef0123456789abcdef";

describe("VaultFront email DNS configurator", () => {
  it("is hard-bound to VaultFront and validates the public Brevo code", () => {
    expect(() => emailDnsRequirements("example.com", code)).toThrow(
      /unexpected email domain/u,
    );
    expect(() => emailDnsRequirements("vaultfront.io", "not-a-code")).toThrow(
      /32-character lowercase hexadecimal/u,
    );
    expect(emailDnsRequirements("vaultfront.io", code)).toHaveLength(4);
  });

  it("is idempotent for exact records and preserves a stronger DMARC policy", () => {
    const required = emailDnsRequirements("vaultfront.io", code);
    const existing = [
      ...required
        .slice(0, 3)
        .map((record, index) => ({ ...record, id: `record-${index}` })),
      {
        id: "dmarc-existing",
        role: "dmarc",
        type: "TXT",
        name: "_dmarc.vaultfront.io",
        content: "v=DMARC1; p=reject; rua=mailto:dmarc@vaultfront.io",
      },
    ];

    const plan = planEmailDns(existing, required);
    expect(plan.create).toEqual([]);
    expect(plan.already).toHaveLength(3);
    expect(plan.preserved).toHaveLength(1);
    expect(plan.conflicts).toEqual([]);
  });

  it("fails closed on an occupied DKIM selector without blocking coexisting apex TXT", () => {
    const required = emailDnsRequirements("vaultfront.io", code);
    const existing = [
      {
        id: "selector-conflict",
        type: "CNAME",
        name: "brevo1._domainkey.vaultfront.io",
        content: "different.example.net",
      },
      {
        id: "spf",
        type: "TXT",
        name: "vaultfront.io",
        content: "v=spf1 -all",
      },
    ];

    const plan = planEmailDns(existing, required);
    expect(plan.conflicts).toHaveLength(1);
    expect(
      plan.create.some((record) => record.role === "domain-verification"),
    ).toBe(true);
  });
});
