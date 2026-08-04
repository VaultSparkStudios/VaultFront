import { describe, expect, it } from "vitest";
import { getTelemetryIdentity } from "../../src/server/TelemetryIdentity";

describe("VaultFront telemetry identity", () => {
  it("binds service, revision, release version, and environment", () => {
    expect(
      getTelemetryIdentity({
        GIT_COMMIT: "abc123",
        VAULTFRONT_RELEASE_VERSION: "2.4.0",
        GAME_ENV: "staging",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      service: "vaultfront",
      version: "2.4.0",
      revision: "abc123",
      environment: "staging",
    });
  });

  it("never fabricates production identity when runtime evidence is absent", () => {
    expect(getTelemetryIdentity({} as NodeJS.ProcessEnv)).toMatchObject({
      version: "unversioned",
      revision: "unversioned",
      environment: "unknown",
    });
  });
});
