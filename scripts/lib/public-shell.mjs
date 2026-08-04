import { readFileSync } from "node:fs";
import path from "node:path";

export const NAV_START = "<!-- public-shell:nav:start -->";
export const NAV_END = "<!-- public-shell:nav:end -->";
export const FOOTER_START = "<!-- public-shell:footer:start -->";
export const FOOTER_END = "<!-- public-shell:footer:end -->";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLinks(links) {
  return links
    .map(
      (link) =>
        `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
    )
    .join(" · ");
}

export function loadPublicShellManifest(root) {
  const canonical = path.resolve(root, "src/shared/PublicRouteGraph.json");
  return JSON.parse(
    readFileSync(
      fsExists(canonical)
        ? canonical
        : path.resolve(root, "public/footer-manifest.json"),
      "utf8",
    ),
  );
}

function fsExists(file) {
  try {
    readFileSync(file, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function resolvePublicPage(root, source) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, source);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`page source escapes project root: ${source}`);
  }
  return resolved;
}

export function renderNavigation(manifest) {
  return [
    NAV_START,
    "<!-- prettier-ignore -->",
    '<nav aria-label="Primary">',
    `  ${renderLinks(manifest.headerLinks ?? [])}`,
    "</nav>",
    NAV_END,
  ].join("\n");
}

export function renderFooter(manifest) {
  const upstream =
    manifest.upstreamNotice ??
    "Based on OpenFrontIO; source licensing and upstream credits remain available in LICENSE, LICENSING.md, and CREDITS.md.";
  return [
    FOOTER_START,
    "<!-- prettier-ignore -->",
    "<footer>",
    `  <p><a href="${escapeHtml(manifest.brandHref)}">A VaultSpark Studios production</a></p>`,
    `  <p>${escapeHtml(manifest.copyright)}</p>`,
    `  <p>${renderLinks(manifest.footerLinks ?? [])}</p>`,
    `  <p>${escapeHtml(upstream)}</p>`,
    "</footer>",
    FOOTER_END,
  ].join("\n");
}

function replaceRegion(html, start, end, tag, replacement) {
  const withSourceIndent = (offset) => {
    const lineStart = html.lastIndexOf("\n", offset - 1) + 1;
    const indent = html.slice(lineStart, offset);
    return replacement.replace(/\n/g, `\n${indent}`);
  };
  const marked = new RegExp(
    `${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "u",
  );
  if (marked.test(html)) {
    return html.replace(marked, (...args) =>
      withSourceIndent(args[args.length - 2]),
    );
  }
  const tagPattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`,
    "iu",
  );
  if (!tagPattern.test(html)) throw new Error(`missing <${tag}> shell region`);
  return html.replace(tagPattern, (...args) =>
    withSourceIndent(args[args.length - 2]),
  );
}

export function generatePublicShellHtml(html, manifest) {
  const withNav = replaceRegion(
    html,
    NAV_START,
    NAV_END,
    "nav",
    renderNavigation(manifest),
  );
  return replaceRegion(
    withNav,
    FOOTER_START,
    FOOTER_END,
    "footer",
    renderFooter(manifest),
  );
}
