#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";

export const PRODUCT_SMOKE_SCHEMA_VERSION = 1;

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function request(origin, path, options = {}) {
  const response = await fetch(new URL(path, origin), {
    redirect: options.redirect ?? "follow",
    signal: AbortSignal.timeout(8_000),
    headers: { accept: options.accept ?? "application/json" },
  });
  return response;
}

function contentType(response) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
}

export async function runProductSmoke({ origin, expectedRevision }) {
  const normalizedOrigin = new URL(origin).origin;
  const checks = [];
  const add = (id, pass, evidence) => checks.push({ id, pass, evidence });

  const health = await request(normalizedOrigin, "/_health");
  const healthBody = await health.json().catch(() => null);
  add(
    "health-json",
    health.ok &&
      contentType(health) === "application/json" &&
      healthBody?.status === "ok",
    {
      status: health.status,
      contentType: contentType(health),
      scope: healthBody?.scope ?? null,
    },
  );

  const revision = await request(normalizedOrigin, "/commit.txt", {
    accept: "text/plain",
  });
  const revisionText = (await revision.text()).trim();
  add("exact-revision", revision.ok && revisionText === expectedRevision, {
    status: revision.status,
    observed: revisionText,
    expected: expectedRevision,
  });

  const pulse = await request(
    normalizedOrigin,
    "/api/vaultfront/playtest-pulse/summary",
  );
  const pulseBody = await pulse.json().catch(() => null);
  add(
    "public-pulse-json-privacy",
    pulse.ok &&
      contentType(pulse) === "application/json" &&
      pulseBody?.privacy?.smallCountThreshold === 5,
    {
      status: pulse.status,
      contentType: contentType(pulse),
      privacyThreshold: pulseBody?.privacy?.smallCountThreshold ?? null,
    },
  );

  const projectApi = await request(normalizedOrigin, "/api/clans/leaderboard");
  await projectApi.arrayBuffer();
  add(
    "worker-api-json-not-spa",
    contentType(projectApi) === "application/json" && projectApi.status !== 404,
    {
      status: projectApi.status,
      contentType: contentType(projectApi),
      shard: projectApi.headers.get("x-vaultfront-api-shard"),
    },
  );

  const me = await request(normalizedOrigin, "/auth/me");
  const meBody = await me.json().catch(() => null);
  add(
    "obelisk-unauthenticated-json",
    me.status === 401 &&
      contentType(me) === "application/json" &&
      meBody?.error === "not_authenticated",
    {
      status: me.status,
      contentType: contentType(me),
      cacheControl: me.headers.get("cache-control"),
    },
  );

  const login = await request(normalizedOrigin, "/auth/login", {
    redirect: "manual",
    accept: "text/html",
  });
  const location = login.headers.get("location");
  const loginHost = location ? new URL(location).hostname : null;
  const setCookie = login.headers.get("set-cookie") ?? "";
  add(
    "obelisk-pkce-redirect",
    login.status === 302 &&
      loginHost === "obeliskgate.com" &&
      /HttpOnly/iu.test(setCookie) &&
      /Secure/iu.test(setCookie) &&
      /SameSite=Lax/iu.test(setCookie),
    {
      status: login.status,
      locationHost: loginHost,
      cookieFlags: {
        httpOnly: /HttpOnly/iu.test(setCookie),
        secure: /Secure/iu.test(setCookie),
        sameSiteLax: /SameSite=Lax/iu.test(setCookie),
      },
    },
  );

  const checkoutContract = await request(
    normalizedOrigin,
    "/stripe/create-checkout-session",
  );
  const checkoutBody = await checkoutContract.json().catch(() => null);
  add(
    "checkout-json-not-spa",
    checkoutContract.status === 405 &&
      contentType(checkoutContract) === "application/json" &&
      checkoutBody?.error === "Method not allowed",
    {
      status: checkoutContract.status,
      contentType: contentType(checkoutContract),
    },
  );

  for (const path of ["/agents.json", "/.well-known/llms.txt"]) {
    const response = await request(normalizedOrigin, path, { accept: "*/*" });
    const body = await response.text();
    add(`agent-surface:${path}`, response.ok && body.length > 20, {
      status: response.status,
      contentType: contentType(response),
      bytes: Buffer.byteLength(body),
    });
  }

  const core = {
    schemaVersion: PRODUCT_SMOKE_SCHEMA_VERSION,
    origin: normalizedOrigin,
    expectedRevision,
    observedAt: new Date().toISOString(),
    pass: checks.every((check) => check.pass),
    checks,
  };
  return { ...core, receiptDigest: sha256(JSON.stringify(core)) };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => args[args.indexOf(flag) + 1];
  const origin = get("--origin");
  const expectedRevision = get("--revision");
  const output = get("--output");
  if (!origin || !expectedRevision || !output) {
    throw new Error(
      "Usage: staging-product-smoke.mjs --origin <https-url> --revision <sha> --output <json>",
    );
  }
  const receipt = await runProductSmoke({ origin, expectedRevision });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.pass) {
    console.error(JSON.stringify(receipt, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`Product smoke passed: ${receipt.receiptDigest}`);
  }
}

if (
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/gu, "/")}` ||
  import.meta.url === `file://${process.argv[1]}`
) {
  await main();
}
