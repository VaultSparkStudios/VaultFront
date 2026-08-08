import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(__dirname, "../..");
const read = (relative: string) =>
  readFileSync(resolve(root, relative), "utf8");

describe("critical combat alerts route through i18n (S99 audit #176)", () => {
  test("EventsDisplay translates incoming-unit messages the same way it translates DisplayEvent messages", () => {
    const source = read("src/client/graphics/layers/EventsDisplay.ts");
    const onUnitIncoming = source.slice(
      source.indexOf("onUnitIncomingEvent("),
      source.indexOf("onUnitIncomingEvent(") + 600,
    );
    expect(onUnitIncoming).toContain(
      'event.message.startsWith("events_display.")',
    );
    expect(onUnitIncoming).toContain(
      "translateText(event.message, event.params ?? {})",
    );
  });

  test("none of the three combat-alert call sites hardcode English text or carry a TODO TranslateText marker", () => {
    for (const file of [
      "src/core/execution/MIRVExecution.ts",
      "src/core/execution/NukeExecution.ts",
      "src/core/execution/TransportShipExecution.ts",
    ]) {
      const source = read(file);
      expect(source).not.toContain("TODO TranslateText");
    }
  });

  test("MIRVExecution passes the translation key and player name", () => {
    const source = read("src/core/execution/MIRVExecution.ts");
    expect(source).toContain('"events_display.mirv_inbound"');
    expect(source).toContain("{ name: this.player.name() }");
  });

  test("NukeExecution passes translation keys and player name for both bomb types", () => {
    const source = read("src/core/execution/NukeExecution.ts");
    expect(source).toContain('"events_display.atom_bomb_inbound"');
    expect(source).toContain('"events_display.hydrogen_bomb_inbound"');
  });

  test("TransportShipExecution passes the translation key with attacker name and troops params", () => {
    const source = read("src/core/execution/TransportShipExecution.ts");
    expect(source).toContain('"events_display.naval_invasion_inbound"');
    expect(source).toContain("name: this.attacker.displayName()");
    expect(source).toContain("troops: renderTroops(this.boat.troops())");
  });

  test("all four keys exist in the English locale with their expected params", () => {
    const en = JSON.parse(read("resources/lang/en.json"));
    expect(en.events_display.mirv_inbound).toContain("{name}");
    expect(en.events_display.atom_bomb_inbound).toContain("{name}");
    expect(en.events_display.hydrogen_bomb_inbound).toContain("{name}");
    expect(en.events_display.naval_invasion_inbound).toContain("{name}");
    expect(en.events_display.naval_invasion_inbound).toContain("{troops}");
  });
});
