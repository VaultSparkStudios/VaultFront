import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeObeliskCookie,
  deriveObeliskPersistentId,
  encodeObeliskCookie,
  readObeliskConfig,
  registerObeliskAuthRoutes,
} from "../../src/server/ObeliskAuth";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Obelisk Passport v2 adapter", () => {
  it("rejects tampered signed cookies", () => {
    const secret = "a".repeat(48);
    const encoded = encodeObeliskCookie({ sub: "identity-1" }, secret);
    expect(decodeObeliskCookie(encoded, secret)).toEqual({ sub: "identity-1" });
    expect(decodeObeliskCookie(`${encoded}x`, secret)).toBeNull();
  });

  it("derives a stable UUID without exposing the Obelisk subject", () => {
    const first = deriveObeliskPersistentId(
      "https://obeliskgate.com",
      "obx_private_subject",
    );
    const second = deriveObeliskPersistentId(
      "https://obeliskgate.com",
      "obx_private_subject",
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first).not.toContain("obx_private_subject");
  });

  it("fails closed on incomplete or weak runtime configuration", () => {
    expect(readObeliskConfig({})).toBeNull();
    expect(() =>
      readObeliskConfig({
        OBELISK_ISSUER: "https://obeliskgate.com",
        OBELISK_CLIENT_ID: "vaultfront",
        OBELISK_REDIRECT_URI: "https://vaultfront.io/auth/callback",
        OBELISK_COOKIE_SECRET: "too-short",
      }),
    ).toThrow(/at least 32/u);
  });

  it("starts authorization with exact callback, S256 PKCE, and no open redirect", async () => {
    Object.assign(process.env, {
      OBELISK_ISSUER: "https://obeliskgate.com",
      OBELISK_CLIENT_ID: "vaultfront",
      OBELISK_REDIRECT_URI: "https://vaultfront.io/auth/callback",
      OBELISK_COOKIE_SECRET: "b".repeat(48),
    });
    const app = express();
    registerObeliskAuthRoutes(app, { warn: () => undefined });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(
        `http://127.0.0.1:${port}/auth/login?returnTo=${encodeURIComponent("https://evil.example")}`,
        { redirect: "manual" },
      );
      expect(response.status).toBe(302);
      const authorize = new URL(response.headers.get("location") ?? "");
      expect(authorize.origin).toBe("https://obeliskgate.com");
      expect(authorize.pathname).toBe("/auth/authorize");
      expect(authorize.searchParams.get("client_id")).toBe("vaultfront");
      expect(authorize.searchParams.get("redirect_uri")).toBe(
        "https://vaultfront.io/auth/callback",
      );
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authorize.searchParams.get("code_challenge")).toMatch(
        /^[A-Za-z0-9_-]{43}$/u,
      );
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
