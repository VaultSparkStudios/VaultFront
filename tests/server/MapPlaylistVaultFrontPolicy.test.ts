import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import {
  GameMapType,
  GameMode,
  GameType,
  RankedType,
} from "../../src/core/game/Game";
import { shouldInstallVaultFrontExecution } from "../../src/core/GameRunner";
import type { GameConfig, PublicGameType } from "../../src/core/Schemas";
import { MapPlaylist } from "../../src/server/MapPlaylist";

function reachesVaultFrontExecution(config: GameConfig): boolean {
  return shouldInstallVaultFrontExecution({
    vaultSitesEnabled: () => config.vaultSitesEnabled ?? false,
    intelOperationsEnabled: () => config.intelOperationsEnabled ?? false,
  });
}

function deterministicPlaylist(): MapPlaylist {
  const playlist = new MapPlaylist(async (map) => ({
    map,
    landTiles: 1_000_000,
    source: "manifest",
    observedAt: 1,
    error: null,
  }));
  const seam = playlist as unknown as {
    getNextMap: (type: PublicGameType) => GameMapType;
    getTeamCount: (map: GameMapType) => number;
    getRandomPublicGameModifiers: () => {
      isCompact: boolean;
      isRandomSpawn: boolean;
      isCrowded: boolean;
      isHardNations: boolean;
      startingGold: undefined;
    };
    getRandomSpecialGameModifiers: () => {
      isCompact: boolean;
      isRandomSpawn: boolean;
      isCrowded: boolean;
      isHardNations: boolean;
      startingGold: undefined;
    };
    lobbyMaxPlayers: () => Promise<number>;
    getSpawnImmunityDuration: () => number;
  };
  vi.spyOn(seam, "getNextMap").mockReturnValue(GameMapType.World);
  vi.spyOn(seam, "getTeamCount").mockReturnValue(2);
  vi.spyOn(seam, "getRandomPublicGameModifiers").mockReturnValue({
    isCompact: false,
    isRandomSpawn: false,
    isCrowded: false,
    isHardNations: false,
    startingGold: undefined,
  });
  vi.spyOn(seam, "getRandomSpecialGameModifiers").mockReturnValue({
    isCompact: false,
    isRandomSpawn: false,
    isCrowded: false,
    isHardNations: false,
    startingGold: undefined,
  });
  vi.spyOn(seam, "lobbyMaxPlayers").mockResolvedValue(100);
  vi.spyOn(seam, "getSpawnImmunityDuration").mockReturnValue(300);
  return playlist;
}

function expectPublicVaultFront(config: GameConfig): void {
  expect(config.gameType).toBe(GameType.Public);
  expect(config.vaultSitesEnabled).toBe(true);
  expect(config.intelOperationsEnabled).toBe(true);
  expect(reachesVaultFrontExecution(config)).toBe(true);
}

describe("MapPlaylist public VaultFront feature policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["ffa", GameMode.FFA],
    ["team", GameMode.Team],
  ] as const)(
    "enables VaultFront for scheduled %s games",
    async (type, mode) => {
      const config = await deterministicPlaylist().gameConfig(type);

      expect(config.gameMode).toBe(mode);
      expectPublicVaultFront(config);
    },
  );

  it("enables VaultFront for scheduled special games", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.75);

    const config = await deterministicPlaylist().gameConfig("special");

    expectPublicVaultFront(config);
  });

  it("enables VaultFront for ranked 1v1 games", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const config = deterministicPlaylist().get1v1Config();

    expect(config.rankedType).toBe(RankedType.OneVOne);
    expectPublicVaultFront(config);
  });

  it("keeps the execution gate disabled when neither feature is opted in", () => {
    expect(
      shouldInstallVaultFrontExecution({
        vaultSitesEnabled: () => false,
        intelOperationsEnabled: () => false,
      }),
    ).toBe(false);
  });
});
