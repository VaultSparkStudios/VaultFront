import type { Application, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import {
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
} from "jose";
import crypto from "node:crypto";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";

const LOGIN_COOKIE = "vf_obelisk_login";
const SESSION_COOKIE = "vf_obelisk_session";
const COOKIE_VERSION = 1;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_MAX_AGE_SECONDS = 10 * 60;
const REFRESH_EARLY_SECONDS = 3 * 60;
const VAULTFRONT_ID_NAMESPACE = "65fc8b51-050c-4baf-a5bb-b1d6a49af9bf";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().optional(),
  expires_in: z.number().positive().optional(),
});

const LoginCookieSchema = z.object({
  v: z.literal(COOKIE_VERSION),
  codeVerifier: z.string().min(43).max(128),
  state: z.string().min(20).max(256),
  nonce: z.string().min(20).max(256),
  returnTo: z.string().startsWith("/").max(2048),
});

const SessionCookieSchema = z.object({
  v: z.literal(COOKIE_VERSION),
  sub: z.string().min(1).max(512),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  email: z.string().email().nullable(),
});

type LoginCookie = z.infer<typeof LoginCookieSchema>;
type SessionCookie = z.infer<typeof SessionCookieSchema>;

export interface ObeliskConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  cookieSecret: string;
  secureCookies: boolean;
}

interface ObeliskDependencies {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface AuthLogger {
  warn(message: string, metadata?: Record<string, unknown>): unknown;
}

export type ObeliskTokenVerification =
  | { type: "not-obelisk" }
  | { type: "success"; sub: string; claims: JWTPayload }
  | { type: "error"; message: string };

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function encodeObeliskCookie(value: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function decodeObeliskCookie(
  value: string | undefined,
  secret: string,
): unknown | null {
  if (!value || value.length > 32_768) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function deriveObeliskPersistentId(
  issuer: string,
  subject: string,
): string {
  return uuidv5(`${issuer}|${subject}`, VAULTFRONT_ID_NAMESPACE);
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(/;\s*/u)) {
    if (!part.startsWith(`${name}=`)) continue;
    try {
      return decodeURIComponent(part.slice(name.length + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function cookieHeader(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function clearCookieHeader(name: string, secure: boolean): string {
  return cookieHeader(name, "", 0, secure);
}

function safeReturnTo(input: unknown): string {
  if (typeof input !== "string") return "/";
  if (!input.startsWith("/") || input.startsWith("//")) return "/";
  if (input.length > 2048) return "/";
  return input;
}

function normalizedIssuer(value: string): string {
  const issuer = new URL(value);
  if (issuer.protocol !== "https:") {
    throw new Error("OBELISK_ISSUER must use HTTPS");
  }
  issuer.pathname = issuer.pathname.replace(/\/+$/u, "");
  issuer.search = "";
  issuer.hash = "";
  return issuer.toString().replace(/\/$/u, "");
}

export function readObeliskConfig(
  env: NodeJS.ProcessEnv = process.env,
): ObeliskConfig | null {
  const issuerValue = env.OBELISK_ISSUER?.trim();
  const clientId = env.OBELISK_CLIENT_ID?.trim();
  const redirectUri = env.OBELISK_REDIRECT_URI?.trim();
  const cookieSecret = env.OBELISK_COOKIE_SECRET?.trim();
  if (!issuerValue || !clientId || !redirectUri || !cookieSecret) return null;
  if (cookieSecret.length < 32) {
    throw new Error("OBELISK_COOKIE_SECRET must be at least 32 characters");
  }
  const issuer = normalizedIssuer(issuerValue);
  const redirect = new URL(redirectUri);
  if (
    redirect.protocol !== "https:" &&
    !(redirect.protocol === "http:" && redirect.hostname === "localhost")
  ) {
    throw new Error("OBELISK_REDIRECT_URI must use HTTPS (except localhost)");
  }
  return {
    issuer,
    clientId,
    redirectUri: redirect.toString(),
    cookieSecret,
    secureCookies: redirect.protocol === "https:",
  };
}

function requireConfiguredObelisk(): ObeliskConfig {
  const config = readObeliskConfig();
  if (!config) {
    throw new Error(
      "Obelisk is not configured: issuer, client ID, redirect URI, and cookie secret are required",
    );
  }
  return config;
}

function tokenErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "token verification failed";
}

function accessTokenSubject(payload: JWTPayload): string {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Obelisk access token has no subject");
  }
  return payload.sub;
}

function createObeliskService(
  config: ObeliskConfig,
  dependencies: ObeliskDependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/auth/jwks`), {
    [customFetch]: fetchImpl,
  });

  async function verifyAccessToken(token: string): Promise<JWTPayload> {
    const result = await jwtVerify(token, jwks, {
      algorithms: ["ES256"],
      issuer: config.issuer,
      audience: config.clientId,
      currentDate: new Date(now()),
    });
    accessTokenSubject(result.payload);
    return result.payload;
  }

  async function tokenRequest(body: URLSearchParams) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(`${config.issuer}/auth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        redirect: "error",
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = TokenResponseSchema.safeParse(payload);
      if (!response.ok || !parsed.success) {
        throw new Error(
          `Obelisk token endpoint rejected the request (${response.status})`,
        );
      }
      return parsed.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refreshSession(
    session: SessionCookie,
  ): Promise<SessionCookie> {
    try {
      const claims = await verifyAccessToken(session.accessToken);
      const expiresAt = typeof claims.exp === "number" ? claims.exp : 0;
      if (expiresAt - Math.floor(now() / 1000) > REFRESH_EARLY_SECONDS) {
        return session;
      }
    } catch {
      // A signed session may contain an expired access token. The rotating
      // refresh token is the only permitted recovery path from that state.
    }
    if (!session.refreshToken)
      throw new Error("Obelisk session cannot refresh");
    const tokens = await tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
        client_id: config.clientId,
      }),
    );
    const claims = await verifyAccessToken(tokens.access_token);
    if (accessTokenSubject(claims) !== session.sub) {
      throw new Error("Obelisk refresh changed the subject");
    }
    return {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? session.refreshToken,
    };
  }

  function decodeSession(req: Request): SessionCookie | null {
    const decoded = decodeObeliskCookie(
      readCookie(req, SESSION_COOKIE),
      config.cookieSecret,
    );
    const parsed = SessionCookieSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  }

  function setSession(res: Response, session: SessionCookie): void {
    res.append(
      "Set-Cookie",
      cookieHeader(
        SESSION_COOKIE,
        encodeObeliskCookie(session, config.cookieSecret),
        SESSION_MAX_AGE_SECONDS,
        config.secureCookies,
      ),
    );
  }

  return {
    verifyAccessToken,
    decodeSession,
    refreshSession,
    setSession,
    tokenRequest,
  };
}

let verificationService:
  ReturnType<typeof createObeliskService> | null | undefined;

export async function verifyObeliskAccessToken(
  token: string,
): Promise<ObeliskTokenVerification> {
  let decoded: JWTPayload;
  try {
    decoded = decodeJwt(token);
  } catch {
    return { type: "not-obelisk" };
  }
  const config = readObeliskConfig();
  if (!config || decoded.iss !== config.issuer) {
    return { type: "not-obelisk" };
  }
  try {
    verificationService ??= createObeliskService(config);
    const claims = await verificationService.verifyAccessToken(token);
    return { type: "success", sub: accessTokenSubject(claims), claims };
  } catch (error) {
    return { type: "error", message: tokenErrorMessage(error) };
  }
}

export function registerObeliskAuthRoutes(
  app: Application,
  logger: AuthLogger,
  dependencies: ObeliskDependencies = {},
): void {
  const config = requireConfiguredObelisk();
  const service = createObeliskService(config, dependencies);
  app.use(
    "/auth",
    rateLimit({
      windowMs: 60_000,
      max: 30,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );

  app.get("/auth/login", (req, res) => {
    const codeVerifier = base64url(crypto.randomBytes(32));
    const state = base64url(crypto.randomBytes(24));
    const nonce = base64url(crypto.randomBytes(24));
    const codeChallenge = base64url(
      crypto.createHash("sha256").update(codeVerifier).digest(),
    );
    const pending: LoginCookie = {
      v: COOKIE_VERSION,
      codeVerifier,
      state,
      nonce,
      returnTo: safeReturnTo(req.query.returnTo),
    };
    const authorize = new URL(`${config.issuer}/auth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: "openid profile email offline_access",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    res.append(
      "Set-Cookie",
      cookieHeader(
        LOGIN_COOKIE,
        encodeObeliskCookie(pending, config.cookieSecret),
        LOGIN_MAX_AGE_SECONDS,
        config.secureCookies,
      ),
    );
    res.redirect(302, authorize.toString());
  });

  app.get("/auth/callback", async (req, res) => {
    const decoded = decodeObeliskCookie(
      readCookie(req, LOGIN_COOKIE),
      config.cookieSecret,
    );
    const pendingResult = LoginCookieSchema.safeParse(decoded);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const returnedState =
      typeof req.query.state === "string" ? req.query.state : "";
    if (
      !pendingResult.success ||
      !code ||
      !constantTimeEqual(pendingResult.data.state, returnedState)
    ) {
      res.append(
        "Set-Cookie",
        clearCookieHeader(LOGIN_COOKIE, config.secureCookies),
      );
      res.redirect(302, "/?auth=error");
      return;
    }
    const pending = pendingResult.data;
    try {
      const tokens = await service.tokenRequest(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          code_verifier: pending.codeVerifier,
        }),
      );
      if (!tokens.id_token) throw new Error("Obelisk returned no ID token");
      const idToken = await jwtVerify(
        tokens.id_token,
        createRemoteJWKSet(new URL(`${config.issuer}/auth/jwks`), {
          [customFetch]: dependencies.fetchImpl ?? fetch,
        }),
        {
          algorithms: ["ES256"],
          issuer: config.issuer,
          audience: config.clientId,
          currentDate: new Date((dependencies.now ?? Date.now)()),
        },
      );
      const claims = idToken.payload;
      if (
        typeof claims.nonce !== "string" ||
        !constantTimeEqual(claims.nonce, pending.nonce)
      ) {
        throw new Error("Obelisk nonce mismatch");
      }
      if (claims.email_verified !== true || typeof claims.email !== "string") {
        throw new Error("Obelisk verified email required");
      }
      const accessClaims = await service.verifyAccessToken(tokens.access_token);
      const subject = accessTokenSubject(accessClaims);
      if (subject !== claims.sub)
        throw new Error("Obelisk token subjects differ");
      service.setSession(res, {
        v: COOKIE_VERSION,
        sub: subject,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        email: claims.email,
      });
      res.append(
        "Set-Cookie",
        clearCookieHeader(LOGIN_COOKIE, config.secureCookies),
      );
      res.redirect(302, pending.returnTo);
    } catch (error) {
      logger.warn("Obelisk callback rejected", {
        reason: tokenErrorMessage(error),
      });
      res.append(
        "Set-Cookie",
        clearCookieHeader(LOGIN_COOKIE, config.secureCookies),
      );
      res.redirect(302, "/?auth=error");
    }
  });

  app.post("/auth/refresh", async (req, res) => {
    const session = service.decodeSession(req);
    if (!session) {
      res.setHeader("Cache-Control", "no-store");
      res.status(401).json({ error: "not_authenticated" });
      return;
    }
    try {
      const refreshed = await service.refreshSession(session);
      service.setSession(res, refreshed);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        jwt: refreshed.accessToken,
        persistentId: deriveObeliskPersistentId(config.issuer, refreshed.sub),
      });
    } catch (error) {
      logger.warn("Obelisk session refresh rejected", {
        reason: tokenErrorMessage(error),
      });
      res.append(
        "Set-Cookie",
        clearCookieHeader(SESSION_COOKIE, config.secureCookies),
      );
      res.setHeader("Cache-Control", "no-store");
      res.status(401).json({ error: "session_expired" });
    }
  });

  app.get("/auth/me", async (req, res) => {
    const session = service.decodeSession(req);
    if (!session) {
      res.setHeader("Cache-Control", "no-store");
      res.status(401).json({ error: "not_authenticated" });
      return;
    }
    try {
      const refreshed = await service.refreshSession(session);
      service.setSession(res, refreshed);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        user: refreshed.email ? { email: refreshed.email } : {},
        player: {
          publicId: deriveObeliskPersistentId(config.issuer, refreshed.sub),
        },
      });
    } catch {
      res.append(
        "Set-Cookie",
        clearCookieHeader(SESSION_COOKIE, config.secureCookies),
      );
      res.setHeader("Cache-Control", "no-store");
      res.status(401).json({ error: "session_expired" });
    }
  });

  const logout = async (req: Request, res: Response) => {
    const session = service.decodeSession(req);
    if (session?.refreshToken) {
      try {
        await (dependencies.fetchImpl ?? fetch)(
          `${config.issuer}/auth/revoke`,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: session.refreshToken,
              token_type_hint: "refresh_token",
              client_id: config.clientId,
            }).toString(),
            redirect: "error",
          },
        );
      } catch {
        // Local logout must still succeed if the upstream revocation endpoint is
        // temporarily unavailable. The short-lived access token expires itself.
      }
    }
    res.append(
      "Set-Cookie",
      clearCookieHeader(SESSION_COOKIE, config.secureCookies),
    );
    res.setHeader("Cache-Control", "no-store");
    res.status(204).end();
  };
  app.post("/auth/logout", logout);
  app.post("/auth/revoke", logout);
}
