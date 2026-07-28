import fs from "node:fs";
import path from "node:path";
import { ensureAges } from "../../scripts/lib/human-action-ages.mjs";
import {
  parseHumanItems,
  parseHumanItemsResult,
} from "../../scripts/lib/task-board.mjs";

describe("canonical human-action parsing", () => {
  test("produces equivalent identities for bullet and table representations", () => {
    const bullet = `# Tasks

## Human Action Required

- [ ] **Enroll hardware key** — Provider UI confirmation (~3 sessions)
`;
    const table = `# Tasks

## Unified Genius List

| # | Tier | Category | Status | Effort | Item |
|---|---|---|---|---|---|
| 1 | ⚠ | Security | human-blocked | S | **Enroll hardware key** — Provider UI confirmation |
`;

    expect(parseHumanItems(bullet).map((item) => item.title)).toEqual([
      "Enroll hardware key",
    ]);
    expect(parseHumanItems(table).map((item) => item.title)).toEqual([
      "Enroll hardware key",
    ]);
  });

  test("deduplicates an action represented in both canonical surfaces", () => {
    const markdown = `## Unified Genius List

| # | Tier | Category | Status | Effort | Item |
|---|---|---|---|---|---|
| 1 | ⚠ | Security | human-blocked | S | **Enroll hardware key** — Provider UI confirmation |

## Human Action Required

- [ ] **Enroll hardware key** — Provider UI confirmation
`;

    expect(parseHumanItems(markdown)).toHaveLength(1);
  });

  test("reports unsupported content as unknown instead of empty", () => {
    const result = parseHumanItemsResult(`## Human Action Required

* Founder must enroll a hardware key
`);

    expect(result.status).toBe("unknown");
    expect(result.items).toEqual([]);
    expect(result.reason).toMatch(/canonical bullet or table schema/);
  });

  test("unknown input preserves the durable first-seen ledger", () => {
    const root = fs.mkdtempSync(
      path.join(process.cwd(), ".codex-temp-human-action-"),
    );
    try {
      const ledgerPath = path.join(root, "portfolio", "HUMAN_ACTION_AGES.json");
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.writeFileSync(
        ledgerPath,
        `${JSON.stringify(
          {
            "Enroll hardware key": {
              firstSeen: "2026-07-01",
              session: 80,
            },
          },
          null,
          2,
        )}\n`,
      );
      const unknown: string[] = [];

      const ledger = ensureAges(
        `## Human Action Required

* Founder must enroll a hardware key
`,
        { root, onUnknown: (reason: string) => unknown.push(reason) },
      );

      expect(ledger).toEqual({
        "Enroll hardware key": {
          firstSeen: "2026-07-01",
          session: 80,
        },
      });
      expect(unknown).toHaveLength(1);
      expect(JSON.parse(fs.readFileSync(ledgerPath, "utf8"))).toEqual(ledger);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
