import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkHostedCronContract } from "../../scripts/check-hosted-cron-contract.mjs";
import { spawnSync } from "../../scripts/lib/safe-spawn.mjs";
import { PROCESS_INTEGRATION_TIMEOUT_MS } from "../helpers/processBudget";

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
  const contact = '<a href="mailto:contact@vaultfront.io">Contact</a>';
  write(root, "static/contact.html", contact);
  write(root, "static/contact/index.html", contact);
  write(
    root,
    "static/assets/sw-fixture123.js",
    'const cache="vaultfront-shell:sw-fixture123.js";',
  );
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
  it("runs hosted verification on the dependency graph's supported Node floor", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { engines?: { node?: string } };
    const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    const brief = fs.readFileSync(
      ".github/workflows/brief-format-check.yml",
      "utf8",
    );

    expect(manifest.engines?.node).toBe(">=22.13 <25");
    expect(ci.match(/node-version:\s*["']?22\.13\.0["']?/g)).toHaveLength(7);
    expect(brief).toMatch(/node-version:\s*["']22\.13\.0["']/);
    expect(ci).not.toMatch(/node-version:\s*["']?20["']?/);
  });

  it("makes the production artifact Pages-complete before release evidence is generated", () => {
    const scripts = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ).scripts as Record<string, string>;
    const production = scripts["build-prod"];
    expect(production).toContain("vite build");
    expect(production).toContain("node scripts/postbuild-pages.mjs");
    expect(production).toContain("node scripts/generate-release-evidence.mjs");
    expect(production.indexOf("vite build")).toBeLessThan(
      production.indexOf("node scripts/postbuild-pages.mjs"),
    );
    expect(production.indexOf("node scripts/postbuild-pages.mjs")).toBeLessThan(
      production.indexOf("node scripts/generate-release-evidence.mjs"),
    );
  });

  it(
    "accepts the built public surface and rejects missing files or stub drift",
    () => {
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
      expect(valid.stdout).toContain("service-worker 1/1");

      fs.rmSync(path.join(root, "static/404.html"));
      fs.rmSync(path.join(root, "static/assets/sw-fixture123.js"));
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
      expect(invalid.stderr).toContain(
        "service-worker:expected-one-compiled-asset-found-0",
      );
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );

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
        'href="mailto:contact@vaultfront.io"',
      );
    }
  });
});
