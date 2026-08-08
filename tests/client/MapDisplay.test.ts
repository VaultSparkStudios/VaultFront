import { afterEach, describe, expect, it, vi } from "vitest";

const { getMapData } = vi.hoisted(() => ({
  getMapData: vi.fn((map: string) => ({
    webpPath: `/maps/${map}.webp`,
    manifest: async () => ({ name: map, nations: [{ name: "Test" }] }),
  })),
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData },
}));

import "../../src/client/components/map/MapDisplay";
import type { MapDisplay } from "../../src/client/components/map/MapDisplay";

async function settle(element: MapDisplay) {
  await element.updateComplete;
  await vi.waitFor(() => expect(element.querySelector("img")).not.toBeNull());
}

describe("map-display", () => {
  afterEach(() => {
    document.body.replaceChildren();
    getMapData.mockClear();
  });

  it("loads hidden-modal cards without depending on IntersectionObserver", async () => {
    const element = document.createElement("map-display") as MapDisplay;
    element.mapKey = "World";
    element.translation = "World";
    document.body.append(element);

    await settle(element);

    expect(getMapData).toHaveBeenCalledTimes(1);
    expect(element.querySelector("img")?.getAttribute("src")).toContain(
      "/maps/World.webp",
    );
  });

  it("reloads reused cards and exposes an explicit image failure state", async () => {
    const element = document.createElement("map-display") as MapDisplay;
    element.mapKey = "World";
    element.translation = "World";
    document.body.append(element);
    await settle(element);

    element.mapKey = "Europe";
    element.translation = "Europe";
    await element.updateComplete;
    await vi.waitFor(() =>
      expect(element.querySelector("img")?.getAttribute("src")).toContain(
        "/maps/Europe.webp",
      ),
    );

    element.querySelector("img")?.dispatchEvent(new Event("error"));
    await element.updateComplete;

    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toContain("map_component.error");
  });
});
