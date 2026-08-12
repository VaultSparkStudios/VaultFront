import { decodeJwt } from "jose";
import { z } from "zod";
import { getApiBase, getAudience } from "./Api";
import { generateCryptoRandomUUID } from "./Utils";

const BrowserTokenSchema = z.object({
  sub: z.string().min(1),
  iss: z.literal("https://obeliskgate.com"),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
});
export type UserAuth =
  | {
      jwt: string;
      claims: z.infer<typeof BrowserTokenSchema>;
    }
  | false;

const PERSISTENT_ID_KEY = "player_persistent_id";

let __jwt: string | null = null;
let __persistentId: string | null = null;
let __refreshPromise: Promise<void> | null = null;

export function obeliskLogin() {
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(
    `${getApiBase()}/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  );
}

export async function tempTokenLogin(token: string): Promise<string | null> {
  const response = await fetch(
    `${getApiBase()}/auth/login/token?login-token=${token}`,
    {
      credentials: "include",
    },
  );
  if (response.status !== 200) {
    console.error("Token login failed", response);
    return null;
  }
  const json = await response.json();
  const { email } = json;
  return email;
}

export async function getAuthHeader(): Promise<string> {
  const userAuthResult = await userAuth();
  if (!userAuthResult) return "";
  const { jwt } = userAuthResult;
  return `Bearer ${jwt}`;
}

export async function logOut(allSessions: boolean = false): Promise<boolean> {
  try {
    const response = await fetch(
      getApiBase() + (allSessions ? "/auth/revoke" : "/auth/logout"),
      {
        method: "POST",
        credentials: "include",
      },
    );

    if (response.ok === false) {
      console.error("Logout failed", response);
      return false;
    }

    return true;
  } catch (e) {
    console.error("Logout failed", e);
    return false;
  } finally {
    __jwt = null;
    __persistentId = null;
    localStorage.removeItem(PERSISTENT_ID_KEY);
  }
}

export async function isLoggedIn(): Promise<boolean> {
  const userAuthResult = await userAuth();
  return userAuthResult !== false;
}

export async function userAuth(
  shouldRefresh: boolean = true,
): Promise<UserAuth> {
  try {
    const jwt = __jwt;
    if (!jwt) {
      if (!shouldRefresh) {
        console.warn("No JWT found and shouldRefresh is false");
        return false;
      }
      console.log("No JWT found");
      await refreshJwt();
      return userAuth(false);
    }

    // Verify the JWT (requires browser support)
    // const jwks = createRemoteJWKSet(
    //   new URL(getApiBase() + "/.well-known/jwks.json"),
    // );
    // const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    //   issuer: getApiBase(),
    //   audience: getAudience(),
    // });

    const payload = decodeJwt(jwt);
    const { iss, aud, exp } = payload;

    if (iss !== "https://obeliskgate.com") {
      // JWT was not issued by the correct server
      console.error('unexpected "iss" claim value');
      logOut();
      return false;
    }
    const myAud = getAudience();
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (myAud !== "localhost" && !audiences.includes("vaultfront")) {
      // JWT was not issued for this website
      console.error('unexpected "aud" claim value');
      logOut();
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    if (exp !== undefined && now >= exp - 3 * 60) {
      console.log("jwt expired or about to expire");
      if (!shouldRefresh) {
        console.error("jwt expired and shouldRefresh is false");
        return false;
      }
      await refreshJwt();

      // Try to get login info again after refreshing
      return userAuth(false);
    }

    const result = BrowserTokenSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid payload", error);
      return false;
    }

    const claims = result.data;
    return { jwt, claims };
  } catch (e) {
    console.error("isLoggedIn failed", e);
    return false;
  }
}

async function refreshJwt(): Promise<void> {
  if (__refreshPromise) {
    return __refreshPromise;
  }
  __refreshPromise = doRefreshJwt();
  try {
    await __refreshPromise;
  } finally {
    __refreshPromise = null;
  }
}

async function doRefreshJwt(): Promise<void> {
  try {
    console.log("Refreshing jwt");
    const response = await fetch(getApiBase() + "/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (response.status !== 200) {
      console.error("Refresh failed", response);
      logOut();
      return;
    }
    const json = await response.json();
    const { jwt, persistentId } = json;
    if (typeof jwt !== "string" || typeof persistentId !== "string") {
      throw new Error("Invalid refresh response");
    }
    console.log("Refresh succeeded");
    __jwt = jwt;
    __persistentId = persistentId;
  } catch (e) {
    console.error("Refresh failed", e);
    // if server unreachable, just clear jwt
    __jwt = null;
    __persistentId = null;
    return;
  }
}

// WARNING: DO NOT EXPOSE THIS ID
export async function getPlayToken(): Promise<string> {
  const result = await userAuth();
  if (result !== false) return result.jwt;
  return getPersistentIDFromLocalStorage();
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  return __persistentId ?? getPersistentIDFromLocalStorage();
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromLocalStorage(): string {
  // Try to get existing localStorage
  const value = localStorage.getItem(PERSISTENT_ID_KEY);
  if (value) return value;

  // If no localStorage exists, create new ID and set localStorage
  const newID = generateCryptoRandomUUID();
  localStorage.setItem(PERSISTENT_ID_KEY, newID);

  return newID;
}
