export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteAuthPolicy =
  | "public"
  | "identity"
  | "verified-actor"
  | "actor-or-admin"
  | "admin"
  | "certificate-actor";
export type RouteEvidencePolicy =
  "none" | "runtime-passport" | "assignment-ledger" | "result-certificate";

export interface RoutePolicy {
  id: string;
  method: RouteMethod;
  path: string;
  auth: RouteAuthPolicy;
  mutation: boolean;
  rateLimit: string;
  evidence: RouteEvidencePolicy;
}

export const routePolicyManifest = [
  {
    id: "create-game",
    method: "POST",
    path: "/api/create_game/:id",
    auth: "actor-or-admin",
    mutation: true,
    rateLimit: "game-creation-admission",
    evidence: "runtime-passport",
  },
  {
    id: "readiness",
    method: "GET",
    path: "/api/vaultfront/readiness",
    auth: "public",
    mutation: false,
    rateLimit: "standard-read",
    evidence: "runtime-passport",
  },
  {
    id: "runtime-integrity",
    method: "GET",
    path: "/api/admin/vaultfront/runtime-integrity-passport",
    auth: "admin",
    mutation: false,
    rateLimit: "admin-read",
    evidence: "runtime-passport",
  },
  ...(["dock", "recap", "runtime"] as const).map((experiment) => ({
    id: `experiment-${experiment}-event`,
    method: "POST" as const,
    path: `/api/vaultfront/ab/${experiment}/event`,
    auth: "verified-actor" as const,
    mutation: true,
    rateLimit: "experiment-write",
    evidence: "assignment-ledger" as const,
  })),
  {
    id: "experiment-outcome-observation",
    method: "POST",
    path: "/api/vaultfront/outcome",
    auth: "verified-actor",
    mutation: true,
    rateLimit: "experiment-write",
    evidence: "assignment-ledger",
  },
  {
    id: "match-oracle",
    method: "GET",
    path: "/api/vaultfront/match-oracle",
    auth: "verified-actor",
    mutation: false,
    rateLimit: "remote-ai-intel",
    evidence: "none",
  },
  {
    id: "match-coach",
    method: "POST",
    path: "/api/vaultfront/match-coach",
    auth: "certificate-actor",
    mutation: false,
    rateLimit: "remote-ai-coach",
    evidence: "result-certificate",
  },
  {
    id: "match-recap",
    method: "GET",
    path: "/api/vaultfront/match-recap/:gameId",
    auth: "certificate-actor",
    mutation: false,
    rateLimit: "remote-ai-debrief",
    evidence: "result-certificate",
  },
  {
    id: "coach-debrief",
    method: "POST",
    path: "/api/vaultfront/coach-debrief",
    auth: "certificate-actor",
    mutation: false,
    rateLimit: "remote-ai-debrief",
    evidence: "result-certificate",
  },
  {
    id: "match-feedback-write",
    method: "POST",
    path: "/api/vaultfront/match-rating",
    auth: "certificate-actor",
    mutation: true,
    rateLimit: "match-feedback-write",
    evidence: "result-certificate",
  },
  {
    id: "match-feedback-admin",
    method: "GET",
    path: "/api/admin/match-ratings",
    auth: "admin",
    mutation: false,
    rateLimit: "admin-read",
    evidence: "result-certificate",
  },
] as const satisfies readonly RoutePolicy[];

export type RoutePolicyId = (typeof routePolicyManifest)[number]["id"];

export interface RouteAuthorizationContext {
  hasIdentity?: boolean;
  hasVerifiedActor?: boolean;
  hasAdminToken?: boolean;
  hasVerifiedCertificate?: boolean;
  certificateBindsActor?: boolean;
}

export interface RouteAuthorizationDecision {
  allowed: boolean;
  status: 200 | 401 | 403 | 409;
  reason: string;
}

export function getRoutePolicy(id: RoutePolicyId): RoutePolicy {
  const policy = routePolicyManifest.find((entry) => entry.id === id);
  if (!policy) throw new Error(`Unknown route policy: ${id}`);
  return policy;
}

export function assertRoutePolicyBinding(
  id: RoutePolicyId,
  method: RouteMethod,
  path: string,
): RoutePolicy {
  const policy = getRoutePolicy(id);
  if (policy.method !== method || policy.path !== path) {
    throw new Error(
      `Route policy drift: ${id} expected ${policy.method} ${policy.path}, registered ${method} ${path}`,
    );
  }
  return policy;
}

export function evaluateRouteAuthorization(
  id: RoutePolicyId,
  context: RouteAuthorizationContext,
): RouteAuthorizationDecision {
  const policy = getRoutePolicy(id);
  const allow = (reason: string): RouteAuthorizationDecision => ({
    allowed: true,
    status: 200,
    reason,
  });
  const deny = (
    status: 401 | 403 | 409,
    reason: string,
  ): RouteAuthorizationDecision => ({
    allowed: false,
    status,
    reason,
  });
  switch (policy.auth) {
    case "public":
      return allow("public route");
    case "identity":
      return context.hasIdentity
        ? allow("identity resolved")
        : deny(401, "identity required");
    case "verified-actor":
      return context.hasVerifiedActor
        ? allow("actor verified")
        : deny(401, "verified actor required");
    case "actor-or-admin":
      return context.hasVerifiedActor || context.hasAdminToken
        ? allow(
            context.hasAdminToken ? "admin token verified" : "actor verified",
          )
        : deny(401, "verified actor or exact admin token required");
    case "admin":
      return context.hasAdminToken
        ? allow("admin token verified")
        : deny(403, "admin token required");
    case "certificate-actor":
      if (!context.hasVerifiedActor)
        return deny(401, "verified actor required");
      if (!context.hasVerifiedCertificate)
        return deny(409, "verified result certificate required");
      return context.certificateBindsActor
        ? allow("certificate binds verified actor")
        : deny(403, "certificate does not bind actor");
  }
}

export function validateRoutePolicyManifest(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const methodPaths = new Set<string>();
  for (const route of routePolicyManifest as readonly RoutePolicy[]) {
    const methodPath = `${route.method} ${route.path}`;
    if (ids.has(route.id)) errors.push(`duplicate id: ${route.id}`);
    if (methodPaths.has(methodPath))
      errors.push(`duplicate route: ${methodPath}`);
    ids.add(route.id);
    methodPaths.add(methodPath);
    if (route.mutation && route.auth === "public")
      errors.push(`${route.id}: mutation cannot be public`);
    if (
      route.auth === "certificate-actor" &&
      route.evidence !== "result-certificate"
    )
      errors.push(`${route.id}: certificate actor route needs result evidence`);
    if (!route.rateLimit.trim())
      errors.push(`${route.id}: missing rate policy`);
  }
  return errors;
}
