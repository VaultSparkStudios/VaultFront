/// <reference lib="webworker" />
import {
  classifyServiceWorkerRequest,
  deriveServiceWorkerCacheName,
  serviceWorkerPrecacheUrls,
  shouldCacheServiceWorkerResponse,
  vaultFrontCachesToDelete,
} from "./ServiceWorkerCachePolicy";

// VaultFront Service Worker
// Provides offline lobby browsing and PWA installability.
// Does NOT cache gameplay WebSocket traffic — only static assets and the shell.

const workerScope = self as unknown as ServiceWorkerGlobalScope;
const CACHE_NAME = deriveServiceWorkerCacheName(workerScope.location.href);
const PRECACHE_URLS = serviceWorkerPrecacheUrls(workerScope.registration.scope);

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => workerScope.skipWaiting()),
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          vaultFrontCachesToDelete(keys, CACHE_NAME).map((key) =>
            caches.delete(key),
          ),
        ),
      )
      .then(() => workerScope.clients.claim()),
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const descriptor = {
    requestUrl: event.request.url,
    method: event.request.method,
    mode: event.request.mode,
    scopeUrl: workerScope.registration.scope,
  };
  const strategy = classifyServiceWorkerRequest(descriptor);
  if (strategy === "bypass") return;

  // Network-first for HTML navigation (always fresh shell)
  if (strategy === "network-first-navigation") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.match(PRECACHE_URLS[0]))
          .then((response) => response ?? Response.error()),
      ),
    );
    return;
  }

  // Cache-first only inside the current release namespace. Old VaultFront
  // releases and unrelated origin caches are never consulted or deleted.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (shouldCacheServiceWorkerResponse(descriptor, response.ok)) {
        await cache.put(event.request, response.clone());
      }
      return response;
    }),
  );
});
