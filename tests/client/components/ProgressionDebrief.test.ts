import { render } from "lit";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  fetchAchievements,
  fetchDailyChallenge,
  fetchMatchProgressionDividend,
  fetchSeasonProgress,
  fetchVaultFrontContracts,
} from "../../../src/client/Api";
import { ProgressionDebrief } from "../../../src/client/components/ProgressionDebrief";

vi.mock("../../../src/client/Api", () => ({
  fetchVaultFrontContracts: vi.fn(),
  fetchSeasonProgress: vi.fn(),
  fetchAchievements: vi.fn(),
  fetchDailyChallenge: vi.fn(),
  fetchMatchProgressionDividend: vi.fn(),
  claimSeasonMilestone: vi.fn(),
}));

vi.mock("../../../src/client/Auth", () => ({
  getPersistentID: () => "00000000-0000-4000-8000-000000000001",
}));

describe("ProgressionDebrief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(fetchDailyChallenge).mockResolvedValue(null);
    vi.mocked(fetchVaultFrontContracts).mockResolvedValue({
      seasonId: "week-29",
      interceptionTiming: 2,
      objectiveDenial: 3,
      comebackExecution: 1,
      surgeExecution: 4,
      evidence: "certified-match-result",
      durability: "process-local",
      eloRating: 1248,
      eloLabel: "Gold",
      matchesPlayed: 8,
      isDecaying: false,
      eloHistory: [1200, 1248],
    });
    vi.mocked(fetchSeasonProgress).mockResolvedValue({
      seasonId: "week-29",
      milestones: [
        {
          milestone: {
            id: "m2",
            tier: 2,
            title: "Getting Started",
            description: "Deliver 5 convoys",
            metric: "convoy_deliveries",
            target: 5,
            reward: { type: "badge", value: "bronze_convoy" },
          },
          progress: 4,
          target: 5,
          pct: 80,
          unlocked: false,
          claimed: false,
        },
      ],
    });
    vi.mocked(fetchAchievements).mockResolvedValue({
      achievements: [
        {
          id: "first_vault",
          unlockedAt: 1,
          progress: 100,
          progressLabel: "Unlocked",
        },
        {
          id: "ten_convoys",
          unlockedAt: null,
          progress: 40,
          progressLabel: "4 / 10 convoys",
        },
      ],
      metaChains: [],
    });
  });

  test("consolidates rating, season, and achievement progress", async () => {
    const debrief = new ProgressionDebrief() as any;
    debrief.visible = true;

    await debrief.refreshProgression();

    const container = document.createElement("div");
    render(debrief.render(), container);

    expect(container.textContent).toContain("Gold 1248");
    expect(container.textContent).toContain("Getting Started 4/5");
    expect(container.textContent).toContain("1/2 achievements");
    expect(container.textContent).toContain("Convoy Mastery");
    expect(container.textContent).toContain("Advance Getting Started");
    expect(localStorage.getItem("vaultfront.convoyMasteryGoal.v1")).toContain(
      '"source":"season"',
    );
  });

  test("renders an exact certified match dividend without snapshot optimism", async () => {
    vi.mocked(fetchMatchProgressionDividend).mockResolvedValue({
      status: "verified",
      gameId: "game-1",
      recordedAt: "2026-08-01T20:00:00.000Z",
      durability: "postgres",
      receiptDigest: `sha256:${"a".repeat(64)}`,
      dividend: {
        persistentId: "00000000-0000-4000-8000-000000000001",
        before: {
          eloRating: 1200,
          matchesPlayed: 7,
          wins: 3,
          losses: 4,
          vaultCaptures: 4,
          convoyDeliveries: 8,
          executionChains: 1,
        },
        after: {
          eloRating: 1232,
          matchesPlayed: 8,
          wins: 4,
          losses: 4,
          vaultCaptures: 6,
          convoyDeliveries: 11,
          executionChains: 2,
        },
        delta: {
          eloRating: 32,
          matchesPlayed: 1,
          wins: 1,
          losses: 0,
          vaultCaptures: 2,
          convoyDeliveries: 3,
          executionChains: 1,
        },
        achievementsUnlocked: ["first_breach"],
        dailyMastery: {
          challengeId: "vault-5",
          progress: 5,
          target: 5,
          rewardMastery: 50,
          completedNow: true,
          durability: "postgres",
        },
        seasonPass: null,
        match: {
          vaultPressureContributions: 2,
          vaultCaptures: 2,
          convoyDeliveries: 3,
          executionChains: 1,
          won: true,
        },
      },
    });
    const debrief = new ProgressionDebrief() as any;
    debrief.visible = true;
    debrief.loading = true;
    await debrief.pollProgressionDividend("game-1");
    const container = document.createElement("div");
    render(debrief.render(), container);
    expect(container.textContent).toContain("verified");
    expect(container.textContent).toContain("+32 rating · 1232");
    expect(container.textContent).toContain("vault-5 5/5");
    expect(container.textContent).toContain("+1 achievements");
    expect(container.textContent).toContain("2 team Pressure deliveries");
    expect(container.textContent).toContain("Rematch with this mastery goal");
    expect(fetchVaultFrontContracts).not.toHaveBeenCalled();
  });

  test("binds doctrine identity to the current match and forwards it into rematch intent", async () => {
    vi.mocked(fetchDailyChallenge).mockResolvedValue({
      challengeId: "vault-5",
      description: "Capture five vaults",
      progress: 3,
      target: 5,
      rewardMastery: 50,
      completed: false,
      masteryBalance: 120,
      durability: "postgres",
      doctrines: {
        activeId: "convoy-architect",
        ownedIds: ["convoy-architect"],
        catalog: [
          {
            id: "convoy-architect",
            name: "Convoy Architect",
            role: "Route planner",
            brief: "Build the safest decisive lane.",
            costMastery: 100,
          },
        ],
      },
    } as any);
    vi.mocked(fetchMatchProgressionDividend).mockResolvedValue({
      status: "verified",
      gameId: "game-doctrine",
      recordedAt: "2026-08-05T12:00:00.000Z",
      durability: "postgres",
      receiptDigest: "sha256:" + "b".repeat(64),
      dividend: {
        persistentId: "00000000-0000-4000-8000-000000000001",
        before: {
          eloRating: 1200,
          matchesPlayed: 1,
          wins: 0,
          losses: 1,
          vaultCaptures: 0,
          convoyDeliveries: 0,
          executionChains: 0,
        },
        after: {
          eloRating: 1210,
          matchesPlayed: 2,
          wins: 1,
          losses: 1,
          vaultCaptures: 1,
          convoyDeliveries: 1,
          executionChains: 0,
        },
        delta: {
          eloRating: 10,
          matchesPlayed: 1,
          wins: 1,
          losses: 0,
          vaultCaptures: 1,
          convoyDeliveries: 1,
          executionChains: 0,
        },
        achievementsUnlocked: [],
        dailyMastery: null,
        seasonPass: null,
        match: {
          vaultPressureContributions: 0,
          vaultCaptures: 1,
          convoyDeliveries: 1,
          executionChains: 0,
          won: true,
        },
      },
    } as any);

    const debrief = new ProgressionDebrief() as any;
    debrief.bindGame({ gameID: () => "game-doctrine" });
    debrief.visible = true;
    await debrief.pollProgressionDividend("game-doctrine");

    const received = vi.fn();
    debrief.addEventListener("vaultfront-mastery-rematch", received);
    debrief.requestMasteryRematch();

    expect(debrief.doctrineName).toBe("Convoy Architect");
    expect(received.mock.calls[0][0].detail.doctrine).toMatchObject({
      id: "convoy-architect",
      effectPolicy: "coaching-and-identity-only",
    });

    debrief.bindGame({ gameID: () => "game-next" });
    expect(debrief.requested).toBe(false);
    expect(debrief.doctrineId).toBe(null);
  });
});
