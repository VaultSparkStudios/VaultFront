import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatePublicStats } from "../../scripts/generate-public-stats.mjs";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("public stats surface", () => {
  it("generates the human cards and machine twin from one authority", () => {
    expect(generatePublicStats(root)).toEqual({
      ok: true,
      mode: "check",
      changed: [],
    });
  });

  it("keeps the human descriptor and machine endpoint byte-equivalent", () => {
    expect(JSON.parse(read("public/stats.json"))).toEqual(
      JSON.parse(read("public/stats-surface.json")),
    );
  });

  it("states pre-launch absence without publishing fabricated numeric zeros", () => {
    const descriptor = JSON.parse(read("public/stats-surface.json"));
    expect(descriptor).toMatchObject({
      route: "/stats/",
      machineReadable: "/stats.json",
      precomputed: true,
      status: "pre-launch-unmeasured",
    });
    expect(descriptor.metrics.length).toBeGreaterThanOrEqual(6);
    expect(descriptor.showcase).toHaveLength(3);
    for (const metric of descriptor.metrics) {
      expect(metric.available).toBe(false);
      expect(metric.value).toBeNull();
      expect(metric.unavailableReason.length).toBeGreaterThan(20);
      expect(metric.interpretation.length).toBeGreaterThan(20);
      expect(metric.source.length).toBeGreaterThan(20);
    }
  });

  it("makes stats navigable to humans and discoverable to agents", () => {
    const page = read("public/stats/index.html");
    const agents = JSON.parse(read("public/agents.json"));
    expect(page).toContain("Unmeasured is not zero.");
    expect(page).toContain('href="/stats.json"');
    expect(agents.endpoints.statsMachine).toBe("/stats.json");
    expect(agents.agentInteractions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/stats.json" }),
      ]),
    );
    for (const metric of JSON.parse(read("public/stats-surface.json"))
      .metrics) {
      expect(page).toContain(metric.label);
      expect(page).toContain("Not yet measured");
      expect(page).toContain(metric.period);
      expect(page).toContain(metric.source);
      expect(page).toContain(metric.interpretation);
    }
  });
});
