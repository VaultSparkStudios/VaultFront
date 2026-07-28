import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkHostedCronContract } from "../../scripts/check-hosted-cron-contract.mjs";
import { spawnSync } from "../../scripts/lib/safe-spawn.mjs";

const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length) {
    fs.rmSync(fixtures.pop()!, { recursive: true, force: true });
  }
});

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultfront-release-"));
  fixtures.push(root);
  return root;
}

function write(root: string, relativePath: string, source = "ok"): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}

function validPagesFixture(): string {
  const root = fixtureRoot();
  for (const file of [
    "index.html",
    "404.html",
    "agents.json",
    ".well-known/llms.txt",
    "sitemap.xml",
    "robots.txt",
    "privacy/index.html",
    "terms/index.html",
    "ip/index.html",
  ]) {
    write(root, `static/${file}`);
  }
  const contact =
    '<a href="mailto:contact@vaultfront.vaultsparkstudios.com">Contact</a>';
  write(root, "static/contact.html", contact);
  write(root, "static/contact/index.html", contact);
  write(
    root,
    ".github/workflows/deploy-pages.yml",
    [
      "run: npm run build:pages",
      "run: node scripts/check-pages-deploy-contract.mjs --artifact static",
      "uses: actions/upload-pages-artifact@v3",
      "with:",
      "  path: static",
      "uses: actions/deploy-pages@v4",
    ].join("\n"),
  );
  return root;
}

describe("release surface contracts", () => {
  it("accepts the built public surface and rejects missing files or stub drift", () => {
    const root = validPagesFixture();
    const script = path.join(
      process.cwd(),
      "scripts/check-pages-deploy-contract.mjs",
    );
    const valid = spawnSync(
      process.execPath,
      [script, "--artifact", "static"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain("Pages artifact contract: 10/10");

    fs.rmSync(path.join(root, "static/404.html"));
    const workflow = path.join(root, ".github/workflows/deploy-pages.yml");
    fs.appendFileSync(workflow, "\npath: pages-stub\n");
    const invalid = spawnSync(
      process.execPath,
      [script, "--artifact", "static"],
      { cwd: root, encoding: "utf8" },
    );
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("404.html");
    expect(invalid.stderr).toContain("workflow:pages-stub");
  });

  it("forbids hosted workflow cron without treating Dependabot metadata as hosted cron", () => {
    const root = fixtureRoot();
    write(root, ".github/workflows/manual.yml", "on:\n  workflow_dispatch:\n");
    write(root, ".github/dependabot.yml", "schedule:\n  interval: weekly\n");
    expect(checkHostedCronContract(root)).toMatchObject({ ok: true });

    write(
      root,
      ".github/workflows/cron.yml",
      'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
    );
    expect(checkHostedCronContract(root)).toMatchObject({
      ok: false,
      errors: ["cron.yml: hosted schedule is forbidden"],
    });
  });

  it("keeps the live repository schedule-free with project-domain contact actions", () => {
    expect(checkHostedCronContract(process.cwd())).toMatchObject({
      ok: true,
      errors: [],
    });
    for (const file of ["public/contact.html", "public/contact/index.html"]) {
      expect(fs.readFileSync(file, "utf8")).toContain(
        'href="mailto:contact@vaultfront.vaultsparkstudios.com"',
      );
    }
  });
});
