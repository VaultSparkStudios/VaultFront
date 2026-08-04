import { describe, expect, it } from "vitest";
import { normalizeKnownHostsEvidence } from "../../scripts/lib/deploy-known-hosts.mjs";

describe("protected deploy host evidence", () => {
  it("admits only an explicit reviewed key for the target host", () => {
    const line = "staging.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest";
    expect(
      normalizeKnownHostsEvidence("staging.example", `# reviewed\n${line}`),
    ).toBe(`${line}\n`);
  });

  it("rejects evidence for another host", () => {
    expect(() =>
      normalizeKnownHostsEvidence(
        "prod.example",
        "attacker.example ssh-ed25519 AAAA",
      ),
    ).toThrow(/does not contain/u);
  });
});
