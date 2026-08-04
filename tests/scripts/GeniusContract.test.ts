import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseGeniusCache,
  selectFirstPendingUnblocked,
} from "../../scripts/lib/genius-cache.mjs";
import { spawnSync } from "../../scripts/lib/safe-spawn.mjs";
import {
  PROCESS_INTEGRATION_SLO_MS,
  PROCESS_INTEGRATION_TIMEOUT_MS,
} from "../helpers/processBudget";

const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length) {
    fs.rmSync(fixtures.pop()!, { recursive: true, force: true });
  }
});

describe("versioned genius cache contract", () => {
  it("supports the current and legacy cache shapes", () => {
    const current = parseGeniusCache({
      schemaVersion: "1.0",
      items: [{ id: "current", status: "pending" }],
    });
    const legacy = parseGeniusCache({
      list: { ranked: [{ id: "legacy", status: "unblocked" }] },
    });

    expect(current.items[0].id).toBe("current");
    expect(legacy.items[0].id).toBe("legacy");
  });

  it("rejects unknown versions and chooses the first pending unblocked item", () => {
    expect(() => parseGeniusCache({ schemaVersion: "99", items: [] })).toThrow(
      "Unsupported genius cache schemaVersion",
    );

    const selected = selectFirstPendingUnblocked({
      schemaVersion: "1.0",
      items: [
        { id: "done", status: "shipped" },
        { id: "blocked", status: "pending", blocked: true },
        { id: "deferred", status: "deferred" },
        { id: "next", status: "pending", title: "Next verified item" },
      ],
    });
    expect(selected?.id).toBe("next");
  });

  it("provides a cache fixture for the renderer integration", () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), "vaultfront-genius-"),
    );
    fixtures.push(fixture);
    const cachePath = path.join(fixture, "genius-list.json");
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        schemaVersion: "1.0",
        items: [
          { id: "done", title: "Already done", status: "done" },
          {
            id: "next",
            title: "Next audit item",
            status: "pending",
            summary: "Generated contract proof",
          },
        ],
      }),
    );

    expect(
      parseGeniusCache(fs.readFileSync(cachePath, "utf8")).items,
    ).toHaveLength(2);
  });
  it(
    "flows the latest audit cache into the closeout next-session hint",
    () => {
      const startedAt = performance.now();
      const root = process.cwd();
      const generated = spawnSync(
        process.execPath,
        ["scripts/generate-genius-list.mjs", "--json"],
        { cwd: root, encoding: "utf8" },
      );
      expect(generated.status).toBe(0);
      const cache = JSON.parse(generated.stdout);
      const expected = selectFirstPendingUnblocked(cache);
      expect(cache.auditSource).toMatch(
        /^docs\/AUDIT_\d{4}-\d{2}-\d{2}\.json$/,
      );

      const fixture = fs.mkdtempSync(
        path.join(os.tmpdir(), "vaultfront-closeout-"),
      );
      fixtures.push(fixture);
      fs.mkdirSync(path.join(fixture, "context"), { recursive: true });
      fs.writeFileSync(
        path.join(fixture, "context", "PROJECT_STATUS.json"),
        JSON.stringify({ name: "Fixture", currentSession: 1, silScore: 0 }),
      );
      const cachePath = path.join(fixture, "genius-list.json");
      fs.writeFileSync(cachePath, generated.stdout);
      const rendered = spawnSync(
        process.execPath,
        [
          "scripts/render-closeout-board.mjs",
          "--project",
          fixture,
          "--genius-cache",
          cachePath,
          "--stdout",
        ],
        { cwd: root, encoding: "utf8" },
      );

      expect(rendered.status).toBe(0);
      expect(rendered.stdout).toContain("NEXT SESSION");
      if (expected) {
        expect(rendered.stdout).toContain(expected.title.slice(0, 58));
      } else {
        expect(rendered.stdout).toContain("Unified Genius List exhausted");
        expect(rendered.stdout).toContain(
          "No pending unblocked audit item remains.",
        );
      }
      expect(performance.now() - startedAt).toBeLessThan(
        PROCESS_INTEGRATION_SLO_MS,
      );
    },
    PROCESS_INTEGRATION_TIMEOUT_MS,
  );
});
