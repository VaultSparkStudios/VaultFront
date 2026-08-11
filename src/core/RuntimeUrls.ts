function normalizeBasePath(basePath: string | undefined): string {
  const raw = (basePath ?? "/").trim();
  if (!raw || raw === "/") return "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

function normalizeOrigin(origin: string | undefined): string {
  return (origin ?? "").trim().replace(/\/+$/, "");
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
}

function normalizeWebSocketOrigin(origin: string | undefined): string {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return `${globalThis.location.protocol === "https:" ? "wss:" : "ws:"}//${globalThis.location.host}`;
  }
  if (normalized.startsWith("http://")) {
    return `ws://${normalized.slice("http://".length)}`;
  }
  if (normalized.startsWith("https://")) {
    return `wss://${normalized.slice("https://".length)}`;
  }
  if (normalized.startsWith("ws://") || normalized.startsWith("wss://")) {
    return normalized;
  }
  return `https://${normalized}`;
}

function trimLeadingSlashes(path: string): string {
  return path.replace(/^\/+/, "");
}

function trimWorkerPath(workerPath: string): string {
  return workerPath.replace(/^\/+|\/+$/g, "");
}

export function appBasePath(): string {
  return normalizeBasePath(import.meta.env.BASE_URL);
}

export function appRootPath(): string {
  return appBasePath();
}

export function appRelativePath(path = ""): string {
  const normalizedPath = trimLeadingSlashes(path);
  if (!normalizedPath) {
    return appBasePath();
  }
  return `${appBasePath()}${normalizedPath}`;
}

export function appUrl(path = ""): string {
  return new URL(appRelativePath(path), globalThis.location.origin).toString();
}

export function stripAppBase(pathname: string): string {
  const basePath = appBasePath();
  if (basePath === "/") {
    return pathname || "/";
  }
  const basePrefix = basePath.slice(0, -1);
  if (!pathname.startsWith(basePrefix)) {
    return pathname || "/";
  }
  const trimmed = pathname.slice(basePrefix.length);
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function currentAppPathname(): string {
  return stripAppBase(globalThis.location.pathname);
}

export function gameServiceOrigin(): string {
  return (
    normalizeOrigin(process?.env?.GAME_SERVICE_ORIGIN) ||
    globalThis.location.origin
  );
}

export function gameServiceHttpUrl(path = ""): string {
  const normalizedPath = trimLeadingSlashes(path);
  const origin = gameServiceOrigin();
  return normalizedPath ? `${origin}/${normalizedPath}` : origin;
}

export function gameServiceWebSocketUrl(path = ""): string {
  const normalizedPath = trimLeadingSlashes(path);
  const wsOrigin = normalizeWebSocketOrigin(process?.env?.GAME_SERVICE_ORIGIN);
  return normalizedPath ? `${wsOrigin}/${normalizedPath}` : wsOrigin;
}

export function workerGamePath(
  workerPath: string,
  gameId: string,
  search = "",
): string {
  const normalizedWorkerPath = trimWorkerPath(workerPath);
  const normalizedSearch =
    search && !search.startsWith("?") ? `?${search}` : search;
  return appRelativePath(
    `${normalizedWorkerPath}/game/${encodeURIComponent(gameId)}${normalizedSearch}`,
  );
}

export function workerGameUrl(
  workerPath: string,
  gameId: string,
  search = "",
): string {
  return new URL(
    workerGamePath(workerPath, gameId, search),
    globalThis.location.origin,
  ).toString();
}

export function workerApiUrl(workerPath: string, apiPath: string): string {
  const normalizedWorkerPath = trimWorkerPath(workerPath);
  const normalizedApiPath = trimLeadingSlashes(apiPath);
  return gameServiceHttpUrl(`${normalizedWorkerPath}/api/${normalizedApiPath}`);
}

export function workerSocketUrl(workerPath: string, suffix = ""): string {
  const normalizedWorkerPath = trimWorkerPath(workerPath);
  const normalizedSuffix = trimLeadingSlashes(suffix);
  const path = normalizedSuffix
    ? `${normalizedWorkerPath}/${normalizedSuffix}`
    : normalizedWorkerPath;
  return gameServiceWebSocketUrl(path);
}
