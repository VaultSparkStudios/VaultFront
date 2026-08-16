#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function value(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${flag}`);
  return args[index + 1];
}

function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasHref(html, href) {
  return new RegExp(`href\\s*=\\s*["']${escapeRegex(href)}["']`, "iu").test(
    html,
  );
}

export async function observeLiveFooterManifest({
  origin,
  revision,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, "src/shared/PublicRouteGraph.json"),
      "utf8",
    ),
  );
  const errors = [];
  const routes = [];
  const revisionResponse = await fetchImpl(new URL("/commit.txt", origin), {
    signal: AbortSignal.timeout(10_000),
  });
  const observedRevision = revisionResponse.ok
    ? (await revisionResponse.text()).trim()
    : null;
  if (observedRevision !== revision)
    errors.push(
      `revision mismatch: ${observedRevision ?? revisionResponse.status}`,
    );
  for (const page of manifest.pages ?? []) {
    const response = await fetchImpl(new URL(page.route, origin), {
      signal: AbortSignal.timeout(10_000),
    });
    const html = await response.text();
    const routeErrors = [];
    if (response.status !== 200) routeErrors.push(`http-${response.status}`);
    if (!/text\/html/iu.test(response.headers.get("content-type") ?? ""))
      routeErrors.push("content-type-not-html");
    if (!html.includes(manifest.copyright))
      routeErrors.push("copyright-missing");
    if (!hasHref(html, manifest.brandHref))
      routeErrors.push("brand-link-missing");
    for (const link of manifest.footerLinks ?? []) {
      if (!hasHref(html, link.href))
        routeErrors.push(`footer-link-missing:${link.href}`);
    }
    routes.push({
      route: page.route,
      status: response.status,
      errors: routeErrors,
    });
    errors.push(...routeErrors.map((error) => `${page.route}:${error}`));
  }
  const payload = {
    schemaVersion: 1,
    origin: origin.replace(/\/$/u, ""),
    revision: observedRevision,
    observedAt: now().toISOString(),
    routeCount: routes.length,
    footerLinkCount: manifest.footerLinks?.length ?? 0,
    routeGraphDigest: sha256(JSON.stringify(manifest)),
    routes,
    errors,
    ok: errors.length === 0,
  };
  return { ...payload, digest: sha256(JSON.stringify(payload)) };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const report = await observeLiveFooterManifest({
    origin: value(args, "--origin"),
    revision: value(args, "--revision"),
  });
  const output = value(args, "--output");
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      ok: report.ok,
      routeCount: report.routeCount,
      errors: report.errors.length,
    }),
  );
  if (!report.ok) process.exitCode = 1;
}
