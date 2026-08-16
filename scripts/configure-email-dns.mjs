import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const EXPECTED_DOMAIN = "vaultfront.io";

function normalizeName(value) {
  return String(value || "")
    .replace(/\.$/u, "")
    .toLowerCase();
}

function normalizeContent(value) {
  return String(value || "")
    .replace(/^"|"$/gu, "")
    .replace(/"\s+"/gu, "");
}

function recordMatches(record, required) {
  return (
    record.type === required.type &&
    normalizeName(record.name) === normalizeName(required.name) &&
    normalizeContent(record.content) === normalizeContent(required.content)
  );
}

export function emailDnsRequirements(domain, verificationCode) {
  if (domain !== EXPECTED_DOMAIN) {
    throw new Error(`refusing unexpected email domain: ${domain}`);
  }
  if (!/^[a-f0-9]{32}$/u.test(verificationCode)) {
    throw new Error(
      "BREVO_DOMAIN_CODE must be a 32-character lowercase hexadecimal value",
    );
  }
  return [
    {
      role: "dkim-primary",
      type: "CNAME",
      name: `brevo1._domainkey.${domain}`,
      content: "b1.vaultfront-io.dkim.brevo.com",
    },
    {
      role: "dkim-secondary",
      type: "CNAME",
      name: `brevo2._domainkey.${domain}`,
      content: "b2.vaultfront-io.dkim.brevo.com",
    },
    {
      role: "domain-verification",
      type: "TXT",
      name: domain,
      content: `brevo-code:${verificationCode}`,
    },
    {
      role: "dmarc",
      type: "TXT",
      name: `_dmarc.${domain}`,
      content: "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com",
    },
  ];
}

export function planEmailDns(existing, required) {
  const create = [];
  const already = [];
  const preserved = [];
  const conflicts = [];

  for (const need of required) {
    const sameNameAndType = existing.filter(
      (record) =>
        record.type === need.type &&
        normalizeName(record.name) === normalizeName(need.name),
    );
    const identical = sameNameAndType.find((record) =>
      recordMatches(record, need),
    );
    if (identical) {
      already.push({ ...need, id: identical.id });
      continue;
    }
    if (
      need.role === "dmarc" &&
      sameNameAndType.some((record) =>
        /^v=DMARC1;/iu.test(normalizeContent(record.content)),
      )
    ) {
      preserved.push({ ...need, id: sameNameAndType[0].id });
      continue;
    }
    if (need.type === "CNAME" && sameNameAndType.length > 0) {
      conflicts.push({
        required: need,
        existing: sameNameAndType.map((record) => ({
          id: record.id,
          content: record.content,
        })),
      });
      continue;
    }
    create.push(need);
  }

  return { create, already, preserved, conflicts };
}

function redactProviderError(body) {
  const text = JSON.stringify(body?.errors || body || {});
  return text.replace(/[A-Za-z0-9_-]{32,}/gu, "[redacted]");
}

async function cloudflare(token, route, init = {}) {
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

async function run() {
  const apply = process.argv.includes("--apply");
  const token = process.env.CF_API_TOKEN;
  const domain = String(process.env.DOMAIN || EXPECTED_DOMAIN).toLowerCase();
  const verificationCode = String(
    process.env.BREVO_DOMAIN_CODE || "",
  ).toLowerCase();
  if (!token) throw new Error("CF_API_TOKEN is required");

  const required = emailDnsRequirements(domain, verificationCode);
  const zones = await cloudflare(
    token,
    `/zones?name=${encodeURIComponent(domain)}&per_page=5`,
  );
  const zone = zones.find(
    (candidate) => candidate.name?.toLowerCase() === domain,
  );
  if (!zone?.id)
    throw new Error(
      `${domain}: Cloudflare zone is unavailable to CF_API_TOKEN`,
    );

  const readRecords = () =>
    cloudflare(token, `/zones/${zone.id}/dns_records?per_page=100`);
  const before = await readRecords();
  const plan = planEmailDns(before, required);
  if (plan.conflicts.length > 0) {
    throw new Error(
      `refusing ${plan.conflicts.length} conflicting DKIM selector record(s)`,
    );
  }

  const receipt = {
    schemaVersion: "1.0",
    mode: apply ? "apply" : "plan",
    generatedAt: new Date().toISOString(),
    domain,
    plan,
    created: [],
    rollback: [],
    status: apply ? "applying" : "planned",
  };

  try {
    if (apply) {
      for (const record of plan.create) {
        const created = await cloudflare(
          token,
          `/zones/${zone.id}/dns_records`,
          {
            method: "POST",
            body: JSON.stringify({
              type: record.type,
              name: record.name,
              content: record.content,
              ttl: 1,
              proxied: false,
              comment: "VaultFront Brevo transactional-domain authentication",
            }),
          },
        );
        receipt.created.push({ ...record, id: created.id });
        receipt.rollback.push({ method: "DELETE", recordId: created.id });
      }

      const after = await readRecords();
      const afterPlan = planEmailDns(after, required);
      receipt.verification = afterPlan;
      if (afterPlan.create.length > 0 || afterPlan.conflicts.length > 0) {
        throw new Error("post-apply DNS verification failed");
      }
      receipt.status = "applied-and-verified";
    }
  } catch (error) {
    receipt.status = "rolling-back";
    for (const change of [...receipt.rollback].reverse()) {
      await cloudflare(
        token,
        `/zones/${zone.id}/dns_records/${change.recordId}`,
        {
          method: "DELETE",
        },
      ).catch(() => null);
    }
    receipt.status = "rolled-back";
    receipt.error = error?.message || String(error);
    throw error;
  } finally {
    const outputDirectory = path.resolve(".cache", "release-evidence");
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(outputDirectory, "email-dns-receipt.json"),
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
