import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "../../scripts/lib/safe-spawn.mjs";

const fixtures: string[] = [];

function write(root: string, relativePath: string, body: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

describe("innovation-pack regeneration", () => {
  it("retains the source-derived certified authority and ledger count", () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), "vaultfront-innovation-pack-"),
    );
    fixtures.push(fixture);
    const generator = fs.readFileSync(
      path.join(process.cwd(), "scripts", "innovation-pack.mjs"),
      "utf8",
    );
    write(fixture, "scripts/innovation-pack.mjs", generator);
    write(fixture, "docs/.keep", "");
    write(
      fixture,
      "src/server/CertifiedGameAuthority.ts",
      "export function certifyArchivedGame() {}\n",
    );
    write(
      fixture,
      "tests/server/CertifiedGameAuthority.test.ts",
      'describe("CertifiedGameAuthority", () => {});\n',
    );
    write(
      fixture,
      "src/server/Worker.ts",
      "certifyArchivedGame(gameA, recordA);\ncertifyArchivedGame(gameB, recordB);\n",
    );
    write(
      fixture,
      "tests/scripts/InnovationPack.test.ts",
      fs.readFileSync(
        path.join(process.cwd(), "tests", "scripts", "InnovationPack.test.ts"),
        "utf8",
      ),
    );

    const runGenerator = () =>
      execFileSync(
        process.execPath,
        [path.join(fixture, "scripts", "innovation-pack.mjs")],
        {
          cwd: fixture,
          encoding: "utf8",
        },
      );

    runGenerator();
    const first = JSON.parse(
      fs.readFileSync(
        path.join(fixture, "docs", "INNOVATION_PACK.json"),
        "utf8",
      ),
    ) as {
      items: Array<{ id: string; rank: number; status: string }>;
    };
    const firstAuthority = first.items.find(
      (item) => item.id === "unified-certified-game-authority",
    );
    expect(first.items).toHaveLength(62);
    expect(firstAuthority).toMatchObject({ rank: 40, status: "shipped" });
    expect(
      first.items.find(
        (item) => item.id === "monotonic-innovation-ledger-guard",
      ),
    ).toMatchObject({ rank: 44, status: "shipped" });
    expect(first.items.slice(-9).map((item) => item.id)).toEqual([
      "dry-run-intent-admission",
      "dual-attestation-rollback-lineage",
      "observed-production-outcome-receipt",
      "lossless-hidden-path-artifact-transport",
      "dependency-free-github-release-planner",
      "format-stable-canonical-closeout",
      "personal-agency-evidence-receipt",
      "mastery-doctrine-receipt-verifier",
      "secondary-ui-entry-ratchet",
    ]);

    const output = runGenerator();
    const regenerated = JSON.parse(
      fs.readFileSync(
        path.join(fixture, "docs", "INNOVATION_PACK.json"),
        "utf8",
      ),
    ) as typeof first;
    expect(regenerated.items).toHaveLength(first.items.length);
    expect(
      regenerated.items.find(
        (item) => item.id === "unified-certified-game-authority",
      ),
    ).toMatchObject({ rank: 40, status: "shipped" });
    expect(output).toContain("3/62 shipped");
  }, 30_000);

  it("recognizes stronger semantic ratchets instead of stale exact values", () => {
    const generator = fs.readFileSync(
      path.join(process.cwd(), "scripts", "innovation-pack.mjs"),
      "utf8",
    );
    expect(generator).toContain("atMostNumericConstant");
    expect(generator).toContain("mutationPolicyPosture");
    expect(generator).not.toContain("/WORKER_LINE_BUDGET = 3130/");
  });

  it("refuses to overwrite when a shipped historical candidate is forgotten", () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), "vaultfront-innovation-guard-"),
    );
    fixtures.push(fixture);
    write(
      fixture,
      "scripts/innovation-pack.mjs",
      fs.readFileSync(
        path.join(process.cwd(), "scripts", "innovation-pack.mjs"),
        "utf8",
      ),
    );
    const historicalLedger = `${JSON.stringify(
      {
        schemaVersion: "1.0",
        items: [
          {
            id: "forgotten-historical-candidate",
            rank: 1,
            status: "shipped",
          },
        ],
      },
      null,
      2,
    )}\n`;
    write(fixture, "docs/INNOVATION_PACK.json", historicalLedger);
    write(fixture, "docs/INNOVATION_PACK.md", "historical markdown\n");

    let failure: unknown;
    try {
      execFileSync(
        process.execPath,
        [path.join(fixture, "scripts", "innovation-pack.mjs")],
        {
          cwd: fixture,
          encoding: "utf8",
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ status: 1 });
    expect(String((failure as { stderr?: string }).stderr)).toContain(
      "forgotten-historical-candidate",
    );
    expect(
      fs.readFileSync(
        path.join(fixture, "docs", "INNOVATION_PACK.json"),
        "utf8",
      ),
    ).toBe(historicalLedger);
    expect(
      fs.readFileSync(path.join(fixture, "docs", "INNOVATION_PACK.md"), "utf8"),
    ).toBe("historical markdown\n");
  }, 30_000);
});
