import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const DOMAIN = "vaultfront.io";
const ADDRESS = `contact@${DOMAIN}`;
const DESTINATION = "founder@vaultsparkstudios.com";

function literalRecipient(rule) {
  return (
    rule?.matchers?.find(
      (matcher) => matcher.type === "literal" && matcher.field === "to",
    )?.value || null
  );
}

function forwardDestination(rule) {
  const action = rule?.actions?.find(
    (candidate) => candidate.type === "forward",
  );
  return Array.isArray(action?.value) ? action.value[0] : null;
}

export function classifyEmailRouting(state) {
  const exactRules = state.rules.filter(
    (rule) => literalRecipient(rule)?.toLowerCase() === ADDRESS,
  );
  const correctRule = exactRules.find(
    (rule) =>
      forwardDestination(rule)?.toLowerCase() === DESTINATION &&
      rule.enabled !== false,
  );
  const conflictingRules = exactRules.filter((rule) => rule !== correctRule);
  const foreignMx = state.mx.filter(
    (record) => !/\.mx\.cloudflare\.net\.?$/iu.test(record.content || ""),
  );
  const cloudflareMx = state.mx.filter((record) =>
    /\.mx\.cloudflare\.net\.?$/iu.test(record.content || ""),
  );
  const destinationReady =
    state.destination?.verified === true ||
    state.destination?.status === "verified";
  const routingReady =
    (state.settings?.enabled === true && state.settings?.status === "ready") ||
    cloudflareMx.length > 0;
  const blockers = [];
  if (!state.destination)
    blockers.push(`destination is not registered: ${DESTINATION}`);
  else if (!destinationReady)
    blockers.push(`destination is not verified: ${DESTINATION}`);
  if (conflictingRules.length > 0)
    blockers.push(
      `${ADDRESS} has ${conflictingRules.length} conflicting rule(s)`,
    );
  if (foreignMx.length > 0)
    blockers.push(
      `${DOMAIN} has ${foreignMx.length} non-Cloudflare MX record(s)`,
    );

  return {
    address: ADDRESS,
    destination: DESTINATION,
    destinationReady,
    routingReady,
    correctRuleId: correctRule?.id || null,
    conflictingRuleIds: conflictingRules.map((rule) => rule.id),
    cloudflareMx: cloudflareMx.map((record) => ({
      content: record.content,
      priority: record.priority,
    })),
    foreignMx: foreignMx.map((record) => ({
      content: record.content,
      priority: record.priority,
    })),
    blockers,
  };
}

function redactProviderError(body) {
  const text = JSON.stringify(body?.errors || body || {});
  return text.replace(/[A-Za-z0-9_-]{32,}/gu, "[redacted]");
}

async function run() {
  const apply = process.argv.includes("--apply");
  const token = process.env.CF_API_TOKEN;
  const accountId = process.env.CF_ACCOUNT_ID;
  const configuredDomain = String(process.env.DOMAIN || DOMAIN).toLowerCase();
  if (configuredDomain !== DOMAIN)
    throw new Error(
      `refusing unexpected email-routing domain: ${configuredDomain}`,
    );
  if (!token) throw new Error("CF_API_TOKEN is required");
  if (!accountId) throw new Error("CF_ACCOUNT_ID is required");

  async function cloudflare(route, init = {}) {
    const response = await fetch(`${CLOUDFLARE_API}${route}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw new Error(
        `Cloudflare ${route} failed (${response.status}): ${redactProviderError(body)}`,
      );
    }
    return body.result;
  }

  const zones = await cloudflare(
    `/zones?name=${encodeURIComponent(DOMAIN)}&per_page=5`,
  );
  const zone = zones.find(
    (candidate) => candidate.name?.toLowerCase() === DOMAIN,
  );
  if (!zone?.id) throw new Error(`${DOMAIN}: Cloudflare zone is unavailable`);

  async function readState() {
    const [destinations, settings, rules, mx] = await Promise.all([
      cloudflare(`/accounts/${accountId}/email/routing/addresses?per_page=100`),
      cloudflare(`/zones/${zone.id}/email/routing`),
      cloudflare(`/zones/${zone.id}/email/routing/rules?per_page=100`),
      cloudflare(
        `/zones/${zone.id}/dns_records?type=MX&name=${encodeURIComponent(DOMAIN)}&per_page=100`,
      ),
    ]);
    return {
      destination: destinations.find(
        (candidate) => candidate.email?.toLowerCase() === DESTINATION,
      ),
      settings,
      rules,
      mx,
    };
  }

  const before = await readState();
  const classification = classifyEmailRouting(before);
  const receipt = {
    schemaVersion: "1.0",
    mode: apply ? "apply" : "plan",
    generatedAt: new Date().toISOString(),
    domain: DOMAIN,
    address: ADDRESS,
    destination: DESTINATION,
    before: classification,
    changes: [],
    rollback: [],
    status: apply ? "applying" : "planned",
  };

  try {
    if (classification.blockers.length > 0) {
      throw new Error(
        `routing blocked: ${classification.blockers.join(" | ")}`,
      );
    }
    if (apply) {
      if (!classification.routingReady) {
        await cloudflare(`/zones/${zone.id}/email/routing/enable`, {
          method: "POST",
        });
        receipt.changes.push({ kind: "routing-enabled" });
        receipt.rollback.push({ kind: "routing-disable" });
      }
      if (!classification.correctRuleId) {
        const rule = await cloudflare(`/zones/${zone.id}/email/routing/rules`, {
          method: "POST",
          body: JSON.stringify({
            name: "VaultFront contact route to founder mailbox",
            enabled: true,
            priority: 0,
            actions: [{ type: "forward", value: [DESTINATION] }],
            matchers: [{ field: "to", type: "literal", value: ADDRESS }],
            source: "api",
          }),
        });
        if (!rule?.id)
          throw new Error("Cloudflare created a routing rule without an id");
        receipt.changes.push({ kind: "rule-created", id: rule.id });
        receipt.rollback.push({ kind: "rule-delete", id: rule.id });
      }

      const after = await readState();
      receipt.after = classifyEmailRouting(after);
      if (
        !receipt.after.routingReady ||
        !receipt.after.correctRuleId ||
        receipt.after.blockers.length > 0
      ) {
        throw new Error("post-apply email-routing verification failed");
      }
      receipt.status = "applied-and-verified";
    }
  } catch (error) {
    if (apply && receipt.rollback.length > 0) {
      receipt.status = "rolling-back";
      for (const change of [...receipt.rollback].reverse()) {
        if (change.kind === "rule-delete") {
          await cloudflare(
            `/zones/${zone.id}/email/routing/rules/${change.id}`,
            { method: "DELETE" },
          ).catch(() => null);
        }
        if (change.kind === "routing-disable") {
          await cloudflare(`/zones/${zone.id}/email/routing/disable`, {
            method: "POST",
          }).catch(() => null);
        }
      }
      receipt.status = "rolled-back";
    } else {
      receipt.status = "blocked";
    }
    receipt.error = error?.message || String(error);
    throw error;
  } finally {
    const outputDirectory = path.resolve(".cache", "release-evidence");
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(outputDirectory, "email-routing-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    console.log(JSON.stringify(receipt, null, 2));
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
