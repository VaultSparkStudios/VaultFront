import { describe, expect, it } from "vitest";
import {
  classifyServiceWorkerRequest,
  deriveServiceWorkerCacheName,
  serviceWorkerPrecacheUrls,
  shouldCacheServiceWorkerResponse,
  vaultFrontCachesToDelete,
} from "../../src/client/ServiceWorkerCachePolicy";

const scopeUrl = "https://play.example/vaultfront/";

describe("service-worker release cache policy", () => {
  it("derives a distinct cache namespace from each compiled worker asset", () => {
    expect(
      deriveServiceWorkerCacheName(
        "https://play.example/vaultfront/assets/sw-alpha123.js",
      ),
    ).toBe("vaultfront-shell:sw-alpha123.js");
    expect(
      deriveServiceWorkerCacheName(
        "https://play.example/vaultfront/assets/sw-beta456.js",
      ),
    ).not.toBe("vaultfront-shell:sw-alpha123.js");
    expect(() =>
      deriveServiceWorkerCacheName("data:video/mp2t;base64,raw"),
    ).toThrow(/HTTP\(S\)/);
  });

  it("deletes only prior VaultFront caches and preserves unrelated origin state", () => {
    expect(
      vaultFrontCachesToDelete(
        [
          "vaultfront-shell:sw-old.js",
          "vaultfront-shell:sw-current.js",
          "another-app:assets",
          "workbox-precache-v2",
        ],
        "vaultfront-shell:sw-current.js",
      ),
    ).toEqual(["vaultfront-shell:sw-old.js"]);
  });

  it("resolves app-shell pre-cache URLs from a non-root registration scope", () => {
    expect(serviceWorkerPrecacheUrls(scopeUrl)).toEqual([
      scopeUrl,
      `${scopeUrl}manifest.webmanifest`,
    ]);
  });

  it.each([
    ["POST", `${scopeUrl}assets/app.js`, "same-origin", "bypass"],
    ["GET", "https://cdn.example/assets/app.js", "same-origin", "bypass"],
    ["GET", `${scopeUrl}api/profile`, "same-origin", "bypass"],
    ["GET", `${scopeUrl}lobbies`, "same-origin", "bypass"],
    ["GET", `${scopeUrl}w27/game/abc`, "same-origin", "bypass"],
    ["GET", `${scopeUrl}play`, "navigate", "network-first-navigation"],
    [
      "GET",
      `${scopeUrl}assets/app-hash.js`,
      "same-origin",
      "cache-first-immutable",
    ],
  ])("classifies %s %s as %s", (method, requestUrl, mode, expected) => {
    expect(
      classifyServiceWorkerRequest({ requestUrl, method, mode, scopeUrl }),
    ).toBe(expected);
  });

  it("caches only successful same-origin immutable responses", () => {
    const immutable = {
      requestUrl: `${scopeUrl}assets/app-hash.js`,
      method: "GET",
      mode: "same-origin",
      scopeUrl,
    };
    expect(shouldCacheServiceWorkerResponse(immutable, true)).toBe(true);
    expect(shouldCacheServiceWorkerResponse(immutable, false)).toBe(false);
    expect(
      shouldCacheServiceWorkerResponse(
        { ...immutable, requestUrl: "https://cdn.example/assets/app.js" },
        true,
      ),
    ).toBe(false);
  });
});
