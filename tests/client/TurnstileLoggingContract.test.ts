import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Turnstile browser logging contract", () => {
  it("never writes the challenge capability into console output", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/client/Main.ts"),
      "utf8",
    );
    const callbackStart = source.indexOf("callback: (token: string)");
    const callbackEnd = source.indexOf('"error-callback"', callbackStart);
    expect(callbackStart).toBeGreaterThan(-1);
    expect(callbackEnd).toBeGreaterThan(callbackStart);
    const callback = source.slice(callbackStart, callbackEnd);
    expect(callback).not.toMatch(
      /console\.(?:debug|info|log|warn|error)\([^)]*token/i,
    );
    expect(callback).toContain('console.info("Turnstile challenge completed")');
  });
});
