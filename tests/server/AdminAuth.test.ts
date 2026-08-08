import { describe, expect, test } from "vitest";
import { isAdminTokenMatch } from "../../src/server/AdminAuth";

describe("isAdminTokenMatch", () => {
  test("matches the exact expected token", () => {
    expect(isAdminTokenMatch("correct-token", "correct-token")).toBe(true);
  });

  test("rejects a wrong token of the same length (adversarial: constant-time path)", () => {
    // Same length as "correct-token" -- exercises the timingSafeEqual branch
    // rather than short-circuiting on the length check alone.
    expect(isAdminTokenMatch("wrong-tokennn", "correct-token")).toBe(false);
  });

  test("rejects a wrong token of a different length", () => {
    expect(isAdminTokenMatch("short", "correct-token")).toBe(false);
  });

  test("rejects a missing header", () => {
    expect(isAdminTokenMatch(undefined, "correct-token")).toBe(false);
  });

  test("rejects a duplicated header value (string[])", () => {
    expect(
      isAdminTokenMatch(["correct-token", "correct-token"], "correct-token"),
    ).toBe(false);
  });

  test("rejects an empty string against a non-empty expected token", () => {
    expect(isAdminTokenMatch("", "correct-token")).toBe(false);
  });
});
