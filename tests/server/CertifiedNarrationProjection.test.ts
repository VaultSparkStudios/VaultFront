import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StampedIntent } from "../../src/core/Schemas";
import {
  CERTIFIED_NARRATION_AUTHORITY,
  projectCertifiedNarration,
} from "../../src/server/CertifiedNarrationProjection";

const stamped = (intent: object): StampedIntent =>
  ({ ...intent, clientID: "private-client-id" }) as StampedIntent;

describe("certified narration authority", () => {
  it("projects high-signal accepted intents without player identifiers", () => {
    const event = projectCertifiedNarration(
      stamped({ type: "vault_convoy_command", command: "vault_heist" }),
    );
    expect(event).toEqual({
      authority: CERTIFIED_NARRATION_AUTHORITY,
      intentType: "vault_convoy_command",
      label: "A vault heist was committed.",
    });
    expect(JSON.stringify(event)).not.toContain("private-client-id");
  });

  it("refuses caller-authored prose and low-signal intents", () => {
    expect(
      projectCertifiedNarration(
        stamped({ type: "quick_chat", message: "fabricated victory" }),
      ),
    ).toBeNull();
  });

  it("queues narration only after rate acceptance and intent admission", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/server/GameServer.ts"),
      "utf8",
    );
    const method = source.slice(source.indexOf("private addIntent"));
    const accept = method.indexOf("shouldAcceptIntent");
    const admitted = method.indexOf("this.intents.push(intent)");
    const projected = method.indexOf("projectCertifiedNarration(intent)");
    expect(accept).toBeGreaterThanOrEqual(0);
    expect(admitted).toBeGreaterThan(accept);
    expect(projected).toBeGreaterThan(admitted);
  });

  it("has no browser-writable narration endpoint", () => {
    const worker = readFileSync(
      resolve(process.cwd(), "src/server/Worker.ts"),
      "utf8",
    );
    const api = readFileSync(
      resolve(process.cwd(), "src/client/Api.ts"),
      "utf8",
    );
    expect(worker).not.toContain("/narrator/:gameId/event");
    expect(api).not.toContain("pushNarratorEvent");
  });
});
