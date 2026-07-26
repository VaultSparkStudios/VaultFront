const ALLOWED_AUTH = new Set([
  "verified-actor",
  "identity",
  "actor-or-admin",
  "admin",
  "signed-worker",
  "public-ingest",
  "retired",
]);
const ALLOWED_EVIDENCE = new Set([
  "none",
  "runtime-passport",
  "assignment-ledger",
  "result-certificate",
  "authenticated-event",
  "source-participation",
  "game-lifecycle",
  "signed-replay",
]);

export function validateMutationRoutePolicies(routes, catalog) {
  const mutations = routes.filter((route) => route.mutation);
  const errors = [];
  const catalogKeys = new Set();
  let publicIngestCount = 0;
  for (const policy of catalog.routes ?? []) {
    const key = `${policy.method} ${policy.path}`;
    if (catalogKeys.has(key)) errors.push(`duplicate policy: ${key}`);
    catalogKeys.add(key);
    if (!ALLOWED_AUTH.has(policy.auth)) errors.push(`${key}: invalid auth`);
    if (!ALLOWED_EVIDENCE.has(policy.evidence))
      errors.push(`${key}: invalid evidence`);
    if (typeof policy.rateLimit !== "string" || !policy.rateLimit.trim())
      errors.push(`${key}: missing rateLimit`);
    if (typeof policy.binding !== "string" || !policy.binding.trim())
      errors.push(`${key}: missing source binding`);
    if (
      policy.auth === "public-ingest" &&
      (typeof policy.rationale !== "string" || !policy.rationale.trim())
    )
      errors.push(`${key}: public-ingest requires rationale`);
    if (policy.auth === "public-ingest") publicIngestCount += 1;
  }

  const publicIngestMax = catalog.riskBudget?.publicIngestMax;
  if (!Number.isSafeInteger(publicIngestMax) || publicIngestMax < 0) {
    errors.push("risk budget requires a non-negative publicIngestMax");
  } else if (publicIngestCount > publicIngestMax) {
    errors.push(
      `public-ingest risk budget exceeded: ${publicIngestCount}/${publicIngestMax}`,
    );
  }
  if (
    typeof catalog.riskBudget?.rationale !== "string" ||
    !catalog.riskBudget.rationale.trim()
  ) {
    errors.push("risk budget requires a rationale");
  }

  const sourceKeys = new Set(
    mutations.map((route) => `${route.method} ${route.path}`),
  );
  const sourceByKey = new Map(
    mutations.map((route) => [`${route.method} ${route.path}`, route]),
  );
  for (const policy of catalog.routes ?? []) {
    const key = `${policy.method} ${policy.path}`;
    const route = sourceByKey.get(key);
    if (!route) continue;
    if (!route.registration.includes(policy.binding)) {
      errors.push(`${key}: binding marker not present: ${policy.binding}`);
    }
    if (
      policy.rateLimit !== "global-standard" &&
      !route.registration.includes(policy.rateLimit)
    ) {
      errors.push(`${key}: rate-limit marker not present: ${policy.rateLimit}`);
    }
  }
  for (const route of mutations) {
    const key = `${route.method} ${route.path}`;
    if (!catalogKeys.has(key))
      errors.push(`undeclared mutation: ${key} (line ${route.line})`);
  }
  for (const key of catalogKeys) {
    if (!sourceKeys.has(key)) errors.push(`stale mutation policy: ${key}`);
  }
  return {
    ok: errors.length === 0,
    registeredMutations: mutations.length,
    declaredPolicies: catalogKeys.size,
    publicIngestCount,
    publicIngestMax,
    errors,
  };
}
