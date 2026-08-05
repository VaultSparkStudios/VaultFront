import { jwtVerify } from "jose";
import { z } from "zod";
import {
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { GameEnv, ServerConfig } from "../core/configuration/Config";
import { PersistentIdSchema } from "../core/Schemas";

type TokenVerificationResult =
  | {
      type: "success";
      persistentId: string;
      claims: TokenPayload | null;
    }
  | { type: "error"; message: string };

export async function verifyClientToken(
  token: string,
  config: ServerConfig,
): Promise<TokenVerificationResult> {
  if (PersistentIdSchema.safeParse(token).success) {
    if (config.env() === GameEnv.Dev) {
      return { type: "success", persistentId: token, claims: null };
    } else {
      return {
        type: "error",
        message: "persistent ID not allowed in production",
      };
    }
  }
  try {
    const issuer = config.jwtIssuer();
    const audience = config.jwtAudience();
    const key = await config.jwkPublicKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer,
      audience,
    });
    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      return {
        type: "error",
        message: z.prettifyError(result.error),
      };
    }
    const claims = result.data;
    const persistentId = claims.sub;
    return { type: "success", persistentId, claims };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "An unknown error occurred";

    return { type: "error", message };
  }
}

export const USER_ME_TIMEOUT_MS = 5_000;

export interface UserMeRequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function getUserMe(
  token: string,
  config: ServerConfig,
  options: UserMeRequestOptions = {},
): Promise<
  | { type: "success"; response: UserMeResponse }
  | { type: "error"; message: string }
> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs =
    typeof options.timeoutMs === "number" &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? options.timeoutMs
      : USER_ME_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("identity-provider-timeout"),
    timeoutMs,
  );

  try {
    const response = await fetchImpl(`${config.jwtIssuer()}/users/@me`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      return {
        type: "error",
        message: `Identity provider rejected request (${response.status})`,
      };
    }
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      return {
        type: "error",
        message: "Identity provider returned an invalid response",
      };
    }
    return { type: "success", response: result.data };
  } catch {
    return {
      type: "error",
      message: controller.signal.aborted
        ? "Identity provider request timed out"
        : "Identity provider request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
