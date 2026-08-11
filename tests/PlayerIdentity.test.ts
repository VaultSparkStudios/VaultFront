import {
  formatPlayerDisplayName,
  MAX_FORTUNE_TITLE_LENGTH,
  normalizeFortuneTitle,
} from "../src/core/PlayerIdentity";
import { GameStartInfoSchema } from "../src/core/Schemas";
import {
  projectMatchPlayer,
  resolveEquippedFortuneTitle,
} from "../src/server/PlayerIdentityProjection";

describe("authoritative Fortune title identity", () => {
  test("formats one bounded title without changing the raw player name", () => {
    expect(formatPlayerDisplayName("Commander", "  The Operator  ")).toBe(
      "Commander · The Operator",
    );
    expect(formatPlayerDisplayName("Commander", null)).toBe("Commander");
  });

  test.each([
    "<img src=x onerror=alert(1)>",
    "Commander<script>",
    "x".repeat(MAX_FORTUNE_TITLE_LENGTH + 1),
    "   ",
  ])("rejects unsafe or unbounded title %j", (title) => {
    expect(normalizeFortuneTitle(title)).toBeNull();
  });

  test("keeps old replay/admission records valid while accepting a safe title", () => {
    const base = {
      gameID: "game1234",
      lobbyCreatedAt: 1,
      config: {
        gameMap: "World",
        difficulty: "Easy",
        donateGold: false,
        donateTroops: false,
        gameType: "Singleplayer",
        gameMode: "Free For All",
        gameMapSize: "Compact",
        nations: "disabled",
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
      },
      players: [{ clientID: "client01", username: "Player One" }],
    };
    expect(GameStartInfoSchema.safeParse(base).success).toBe(true);
    expect(
      GameStartInfoSchema.safeParse({
        ...base,
        players: [
          {
            ...base.players[0],
            equippedFortuneTitle: "Vault Sovereign",
          },
        ],
      }).success,
    ).toBe(true);
  });

  test("projects only the server-resolved client title into match admission", () => {
    expect(
      projectMatchPlayer(
        {
          username: "Commander",
          clientID: "client1",
          cosmetics: undefined,
          equippedFortuneTitle: "The Guardian",
        },
        true,
      ),
    ).toMatchObject({
      username: "Commander",
      equippedFortuneTitle: "The Guardian",
      isLobbyCreator: true,
    });
  });

  test("fails closed to no title when the store errors or returns markup", async () => {
    const report = vi.fn();
    await expect(
      resolveEquippedFortuneTitle(
        "player-1",
        async () => "<script>alert(1)</script>",
        report,
      ),
    ).resolves.toBeNull();
    await expect(
      resolveEquippedFortuneTitle(
        "player-1",
        async () => {
          throw new Error("database unavailable");
        },
        report,
      ),
    ).resolves.toBeNull();
    expect(report).toHaveBeenCalledOnce();
  });
});
