import { FetchGameMapLoader } from "src/core/game/FetchGameMapLoader";
import { GameMapType } from "src/core/game/Game";
import { GameMapLoader } from "src/core/game/GameMapLoader";
import { logger } from "./Logger";

const log = logger.child({ component: "MapLandTiles" });
const DEFAULT_FALLBACK_LAND_TILES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 1_500;
const DEFAULT_FALLBACK_TTL_MS = 5_000;

export interface MapCapacityObservation {
  map: GameMapType;
  landTiles: number;
  source: "manifest" | "bounded-fallback";
  observedAt: number;
  error: string | null;
}

export type MapCapacityResolver = (
  map: GameMapType,
) => Promise<MapCapacityObservation>;

type LandTileLoader = (map: GameMapType) => Promise<number>;

export class MapCapacityAuthority {
  private readonly cache = new Map<
    GameMapType,
    { promise: Promise<MapCapacityObservation>; expiresAt: number }
  >();

  public constructor(
    private readonly loadLandTiles: LandTileLoader,
    private readonly options: {
      timeoutMs?: number;
      fallbackLandTiles?: number;
      fallbackTtlMs?: number;
      now?: () => number;
    } = {},
  ) {}

  public observe(map: GameMapType): Promise<MapCapacityObservation> {
    const now = (this.options.now ?? Date.now)();
    const cached = this.cache.get(map);
    if (cached && now < cached.expiresAt) return cached.promise;
    const promise = this.load(map);
    this.cache.set(map, {
      promise,
      expiresAt: Number.POSITIVE_INFINITY,
    });
    void promise.then((observation) => {
      const current = this.cache.get(map);
      if (current?.promise !== promise) return;
      current.expiresAt =
        observation.source === "manifest"
          ? Number.POSITIVE_INFINITY
          : (this.options.now ?? Date.now)() +
            (this.options.fallbackTtlMs ?? DEFAULT_FALLBACK_TTL_MS);
    });
    return promise;
  }

  public clear(): void {
    this.cache.clear();
  }

  private async load(map: GameMapType): Promise<MapCapacityObservation> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const value = await Promise.race([
        this.loadLandTiles(map),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`map-capacity-timeout:${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("map-capacity-invalid-manifest");
      }
      return {
        map,
        landTiles: value,
        source: "manifest",
        observedAt: (this.options.now ?? Date.now)(),
        error: null,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.error("Map capacity unavailable; using bounded fallback", {
        map,
        source: "bounded-fallback",
        error: detail,
      });
      return {
        map,
        landTiles:
          this.options.fallbackLandTiles ?? DEFAULT_FALLBACK_LAND_TILES,
        source: "bounded-fallback",
        observedAt: (this.options.now ?? Date.now)(),
        error: detail,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

const mapLoader: GameMapLoader = new FetchGameMapLoader(
  "http://localhost:3000/maps",
  undefined,
  DEFAULT_TIMEOUT_MS,
);
const defaultAuthority = new MapCapacityAuthority(async (map) => {
  const manifest = await mapLoader.getMapData(map).manifest();
  return manifest.map.num_land_tiles;
});

export const getMapCapacityObservation: MapCapacityResolver = (map) =>
  defaultAuthority.observe(map);

export async function getMapLandTiles(map: GameMapType): Promise<number> {
  return (await getMapCapacityObservation(map)).landTiles;
}

export function resetMapCapacityCacheForTests(): void {
  defaultAuthority.clear();
}
