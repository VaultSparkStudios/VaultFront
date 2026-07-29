export const VAULTFRONT_CACHE_PREFIX = "vaultfront-shell:";

export type ServiceWorkerRuntimeStrategy =
  "bypass" | "network-first-navigation" | "cache-first-immutable";

export interface ServiceWorkerRequestDescriptor {
  requestUrl: string;
  method: string;
  mode: string;
  scopeUrl: string;
}

function relativeScopePath(requestUrl: URL, scopeUrl: URL): string {
  const scopePath = scopeUrl.pathname.endsWith("/")
    ? scopeUrl.pathname
    : `${scopeUrl.pathname}/`;
  return requestUrl.pathname.startsWith(scopePath)
    ? `/${requestUrl.pathname.slice(scopePath.length)}`
    : requestUrl.pathname;
}

export function deriveServiceWorkerCacheName(scriptUrl: string): string {
  const url = new URL(scriptUrl);
  if (!/^https?:$/u.test(url.protocol)) {
    throw new TypeError("service worker release URL must be HTTP(S)");
  }
  const releaseAsset = url.pathname.split("/").filter(Boolean).at(-1);
  if (!releaseAsset || !/\.js$/u.test(releaseAsset)) {
    throw new TypeError(
      "service worker release URL must name a JavaScript asset",
    );
  }
  return `${VAULTFRONT_CACHE_PREFIX}${releaseAsset}`;
}

export function serviceWorkerPrecacheUrls(scopeUrl: string): string[] {
  const scope = new URL(scopeUrl);
  if (!scope.pathname.endsWith("/")) scope.pathname += "/";
  return [scope.toString(), new URL("manifest.webmanifest", scope).toString()];
}

export function vaultFrontCachesToDelete(
  cacheNames: readonly string[],
  currentCacheName: string,
): string[] {
  return cacheNames.filter(
    (name) =>
      name.startsWith(VAULTFRONT_CACHE_PREFIX) && name !== currentCacheName,
  );
}

export function classifyServiceWorkerRequest(
  descriptor: ServiceWorkerRequestDescriptor,
): ServiceWorkerRuntimeStrategy {
  const scope = new URL(descriptor.scopeUrl);
  const request = new URL(descriptor.requestUrl, scope);
  if (descriptor.method.toUpperCase() !== "GET") return "bypass";
  if (request.origin !== scope.origin) return "bypass";
  const relativePath = relativeScopePath(request, scope);
  if (
    /^\/(?:api|lobbies)(?:\/|$)/u.test(relativePath) ||
    /^\/w\d+(?:\/|$)/u.test(relativePath)
  ) {
    return "bypass";
  }
  if (descriptor.mode === "navigate") return "network-first-navigation";
  if (
    relativePath === "/manifest.webmanifest" ||
    relativePath.startsWith("/assets/")
  ) {
    return "cache-first-immutable";
  }
  return "bypass";
}

export function shouldCacheServiceWorkerResponse(
  descriptor: ServiceWorkerRequestDescriptor,
  responseOk: boolean,
): boolean {
  return (
    responseOk &&
    classifyServiceWorkerRequest(descriptor) === "cache-first-immutable"
  );
}
