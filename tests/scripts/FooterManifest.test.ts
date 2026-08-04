import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkFooterManifest } from "../../scripts/check-footer-manifest.mjs";
import { generatePublicShell } from "../../scripts/generate-public-shell.mjs";

const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length) {
    fs.rmSync(fixtures.pop()!, { recursive: true, force: true });
  }
});

function fixtureRoot(manifest: object, html: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultfront-footer-"));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, "public", "leaf"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "public", "footer-manifest.json"),
    JSON.stringify(manifest),
  );
  fs.writeFileSync(path.join(root, "public", "leaf", "index.html"), html);
  return root;
}

const base = {
  schemaVersion: 2,
  brandHref: "https://vaultsparkstudios.com",
  copyright: "© 2026 VaultSpark Studios LLC. All rights reserved.",
  headerLinks: [{ href: "/", label: "Play" }],
  footerLinks: [
    { href: "/", label: "Play" },
    { href: "/privacy/", label: "Privacy" },
  ],
  footerOnly: ["/privacy/"],
  legalPages: ["/privacy/"],
  requiredLinks: ["/privacy/"],
  pages: [{ route: "/leaf/", source: "public/leaf/index.html" }],
};

describe("public footer manifest", () => {
  it("proves scoped route parity, ownership, copyright, and legal links on every leaf", () => {
    expect(checkFooterManifest(process.cwd())).toMatchObject({
      ok: true,
      pageCount: 10,
      headerLinkCount: 4,
      footerLinkCount: 7,
      appExternalLinkCount: 2,
      appConsumer: "src/client/components/Footer.ts",
      errors: [],
    });
  });

  it("rejects a header destination that appears outside the footer only", () => {
    const root = fixtureRoot(
      base,
      [
        '<nav><a href="/">Play</a></nav>',
        '<footer><a href="https://vaultsparkstudios.com">Brand</a>',
        '<a href="/privacy/">Privacy</a>',
        "© 2026 VaultSpark Studios LLC. All rights reserved.</footer>",
      ].join(""),
    );

    expect(checkFooterManifest(root)).toMatchObject({ ok: false });
    expect(checkFooterManifest(root).errors).toEqual(
      expect.arrayContaining(["/leaf/: footer missing /"]),
    );
  });

  it("rejects the prior vacuous zero-link manifest shape", () => {
    const root = fixtureRoot(
      { ...base, headerLinks: [], footerLinks: [] },
      '<nav></nav><footer><a href="https://vaultsparkstudios.com">Brand</a>© 2026 VaultSpark Studios LLC. All rights reserved.</footer>',
    );

    expect(checkFooterManifest(root).errors).toEqual(
      expect.arrayContaining([
        "manifest: headerLinks must be non-empty",
        "manifest: footerLinks must be non-empty",
        "manifest: footerLinks missing /privacy/",
      ]),
    );
  });

  it("writes an idempotent manifest-owned shell and detects later drift", () => {
    const root = fixtureRoot(
      base,
      '<main><nav><a href="/">Old</a></nav><h1>Leaf</h1></main><footer>Old</footer>',
    );
    expect(generatePublicShell(root, true)).toMatchObject({
      ok: true,
      changed: ["public/leaf/index.html"],
    });
    expect(generatePublicShell(root, false)).toMatchObject({
      ok: true,
      changed: [],
    });
    expect(checkFooterManifest(root)).toMatchObject({ ok: true, errors: [] });
  });

  it("rejects duplicate routes and sources outside the project root", () => {
    const duplicateRoot = fixtureRoot(
      { ...base, pages: [...base.pages, ...base.pages] },
      "<nav></nav><footer></footer>",
    );
    expect(() => generatePublicShell(duplicateRoot, false)).toThrow(
      "duplicate route",
    );

    const escapingRoot = fixtureRoot(
      { ...base, pages: [{ route: "/escape/", source: "../escape.html" }] },
      "<nav></nav><footer></footer>",
    );
    expect(() => generatePublicShell(escapingRoot, false)).toThrow(
      "escapes project root",
    );
  });
});
