#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generatePublicShellHtml } from "./lib/public-shell.mjs";

function hrefOf(link) {
  return typeof link === "string" ? link : link?.href;
}

function hrefs(links) {
  return (links ?? []).map(hrefOf).filter(Boolean);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasHref(fragment, href) {
  return new RegExp(`href\\s*=\\s*["']${escapeRegex(href)}["']`, "iu").test(
    fragment,
  );
}

function scopedHtml(html, tag) {
  return (
    html.match(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "iu"),
    )?.[1] ?? null
  );
}

export function checkFooterManifest(root = process.cwd()) {
  const manifestPath = resolve(root, "public/footer-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const errors = [];
  const seenRoutes = new Set();
  const headerLinks = hrefs(manifest.headerLinks);
  const footerLinks = hrefs(manifest.footerLinks);
  const footerOnly = hrefs(manifest.footerOnly);
  const legalPages = hrefs(manifest.legalPages);
  const requiredFooterLinks = new Set([
    ...headerLinks,
    ...footerOnly,
    ...legalPages,
    ...hrefs(manifest.requiredLinks),
  ]);

  if (!headerLinks.length)
    errors.push("manifest: headerLinks must be non-empty");
  if (!footerLinks.length)
    errors.push("manifest: footerLinks must be non-empty");
  for (const href of requiredFooterLinks) {
    if (!footerLinks.includes(href)) {
      errors.push(`manifest: footerLinks missing ${href}`);
    }
  }

  for (const page of manifest.pages ?? []) {
    if (seenRoutes.has(page.route))
      errors.push(`${page.route}: duplicate route`);
    seenRoutes.add(page.route);
    let html;
    try {
      html = readFileSync(resolve(root, page.source), "utf8");
    } catch {
      errors.push(`${page.route}: missing source ${page.source}`);
      continue;
    }
    try {
      if (generatePublicShellHtml(html, manifest) !== html) {
        errors.push(`${page.route}: generated public shell drift`);
      }
    } catch (error) {
      errors.push(`${page.route}: ${String(error)}`);
    }

    const navigation = scopedHtml(html, "nav");
    const footer = scopedHtml(html, "footer");
    if (navigation == null) errors.push(`${page.route}: missing navigation`);
    if (footer == null) errors.push(`${page.route}: missing footer`);
    if (navigation != null) {
      for (const href of headerLinks) {
        if (!hasHref(navigation, href)) {
          errors.push(`${page.route}: navigation missing ${href}`);
        }
      }
    }
    if (footer != null) {
      if (!hasHref(footer, manifest.brandHref)) {
        errors.push(`${page.route}: footer missing brand link`);
      }
      if (!footer.includes(manifest.copyright)) {
        errors.push(`${page.route}: footer missing copyright`);
      }
      for (const href of footerLinks) {
        if (!hasHref(footer, href)) {
          errors.push(`${page.route}: footer missing ${href}`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    manifest: "public/footer-manifest.json",
    pageCount: manifest.pages?.length ?? 0,
    headerLinkCount: headerLinks.length,
    footerLinkCount: footerLinks.length,
    errors,
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const result = checkFooterManifest();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
