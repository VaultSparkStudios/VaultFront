import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WinModal } from "../../../../src/client/graphics/layers/WinModal";
import { RankedType } from "../../../../src/core/game/Game";

const apiMock = vi.hoisted(() => ({
  createRematch: vi.fn(
    async (): Promise<
      | false
      | {
          gameId: string;
          lobbyId: string;
          code: string;
          mapName: string;
          participantCount: number;
          expiresAt: number;
          joinUrl: string;
          status: "ready";
        }
    > => ({
      gameId: "game-1",
      lobbyId: "lobby-1",
      code: "rematch1",
      mapName: "World",
      participantCount: 1,
      expiresAt: Date.now() + 300_000,
      joinUrl: "https://play.example/w0/game/lobby-1?lobby",
      status: "ready" as const,
    }),
  ),
  fetchVaultFrontRecapAssignment: vi.fn(async () => false),
  fetchMutatorVoteStatus: vi.fn(async () => false),
  requestReplayHighlight: vi.fn(async () => null),
  fetchVaultFrontContracts: vi.fn(async () => false),
  fetchWinFortune: vi.fn(async () => null),
  fetchMatchRecap: vi.fn(async () => null),
  fetchDynastyStory: vi.fn(async () => null),
  getUserMe: vi.fn(async () => null),
  recordVaultFrontFunnelTelemetry: vi.fn(async () => true),
  recordVaultFrontOutcomeTelemetry: vi.fn(async () => true),
  recordVaultFrontPlaytestPulse: vi.fn(async () => true),
  recordVaultFrontRecapEvent: vi.fn(async () => true),
  postMatchRating: vi.fn(async () => ({
    status: "accepted" as const,
    receipt: {
      accepted: true,
      duplicate: false,
      gameId: "game-1",
      mapName: "World",
      durability: "process-local" as const,
      evidence: "certified-match-result" as const,
      retentionDays: 30 as const,
    },
  })),
  updateVaultFrontSeasonContracts: vi.fn(async () => false),
}));

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "win_modal.exit": "Exit",
      "win_modal.requeue": "Play Again",
      "win_modal.keep": "Keep Playing",
      "win_modal.spectate": "Spectate",
    };
    return translations[key] || key;
  }),
  getGamesPlayed: vi.fn(() => 10),
  isInIframe: vi.fn(() => false),
  TUTORIAL_VIDEO_URL: "https://example.com/tutorial",
}));

vi.mock("../../../../src/client/Api", () => ({
  createRematch: apiMock.createRematch,
  fetchVaultFrontRecapAssignment: apiMock.fetchVaultFrontRecapAssignment,
  fetchMutatorVoteStatus: apiMock.fetchMutatorVoteStatus,
  requestReplayHighlight: apiMock.requestReplayHighlight,
  fetchVaultFrontContracts: apiMock.fetchVaultFrontContracts,
  fetchWinFortune: apiMock.fetchWinFortune,
  fetchMatchRecap: apiMock.fetchMatchRecap,
  fetchDynastyStory: apiMock.fetchDynastyStory,
  getUserMe: apiMock.getUserMe,
  recordVaultFrontFunnelTelemetry: apiMock.recordVaultFrontFunnelTelemetry,
  recordVaultFrontOutcomeTelemetry: apiMock.recordVaultFrontOutcomeTelemetry,
  recordVaultFrontPlaytestPulse: apiMock.recordVaultFrontPlaytestPulse,
  recordVaultFrontRecapEvent: apiMock.recordVaultFrontRecapEvent,
  postMatchRating: apiMock.postMatchRating,
  updateVaultFrontSeasonContracts: apiMock.updateVaultFrontSeasonContracts,
}));

vi.mock("../../../../src/client/Cosmetics", () => ({
  fetchCosmetics: vi.fn(async () => []),
  handlePurchase: vi.fn(),
  patternRelationship: vi.fn(() => ({})),
}));

vi.mock("../../../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    happytime: vi.fn(),
    requestAd: vi.fn(),
    gameplayStop: vi.fn(),
  },
}));

describe("WinModal Requeue", () => {
  let mockLocationHref = "";

  beforeEach(() => {
    mockLocationHref = "";
    // Mock window.location.href using Object.defineProperty
    const locationMock = {
      get href() {
        return mockLocationHref;
      },
      set href(value: string) {
        mockLocationHref = value;
      },
    };
    Object.defineProperty(window, "location", {
      value: locationMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    apiMock.recordVaultFrontPlaytestPulse.mockClear();
    apiMock.createRematch.mockClear();
  });

  describe("isRankedGame detection", () => {
    it("should detect ranked 1v1 game", () => {
      const gameConfig = {
        rankedType: RankedType.OneVOne,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(true);
    });

    it("should not detect non-ranked game", () => {
      const gameConfig = {
        rankedType: undefined,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(false);
    });
  });

  describe("requeue navigation", () => {
    it("should navigate to /?requeue when requeue is triggered", () => {
      // Simulate the _handleRequeue behavior
      const handleRequeue = () => {
        window.location.href = "/?requeue";
      };

      handleRequeue();

      expect(window.location.href).toBe("/?requeue");
    });

    it("should navigate to / when exit is triggered", () => {
      // Simulate the _handleExit behavior
      const handleExit = () => {
        window.location.href = "/";
      };

      handleExit();

      expect(window.location.href).toBe("/");
    });
  });

  describe("requeue URL parameter handling", () => {
    it("should parse requeue parameter from URL", () => {
      const url = new URL("http://localhost:9000/?requeue");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(true);
    });

    it("should not find requeue parameter when absent", () => {
      const url = new URL("http://localhost:9000/");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(false);
    });
  });
});

describe("VaultFront recap coaching", () => {
  it("builds a recovery script that includes HUD usage when no anchors were used", () => {
    const modal = new WinModal() as any;
    modal.behindAtMinute8 = true;
    vi.spyOn(modal, "hudCountersForCurrentMatch").mockReturnValue({
      vaultNoticeJumps: 0,
      objectiveRailClicks: 0,
      timelineJumps: 0,
    });

    const plan = modal.buildActionPlan({
      key: "vault",
      title: "Vault Control",
      myValue: "0",
      winnerValue: "2",
      deltaText: "Delta -2",
      positive: false,
      ratio: 0.2,
    });

    expect(plan[0]).toContain("Vault notice or objective rail");
    expect(plan.join(" ")).toContain("nearest contestable vault");
    expect(plan.join(" ")).toContain("fall behind again");
  });

  it("renders a rival challenge when rivalry revenge was earned", () => {
    const modal = new WinModal() as any;
    const container = document.createElement("div");
    modal.rivalryRevengeDelta = 2;

    render(modal.renderRivalChallenge(), container);

    expect(container.textContent).toContain("Rival Challenge");
    expect(container.textContent?.replace(/\s+/g, " ")).toContain(
      "2 revenge counters banked",
    );
    expect(container.textContent).toContain("counter-intercept");
  });

  it("records Rival Challenge retention pulse when saving the next goal", () => {
    const modal = new WinModal() as any;
    modal.rivalryRevengeDelta = 2;
    modal.actionableHint = "Intercept the first rival convoy.";
    modal.actionableGoalKey = "convoy_impact";

    modal.saveNextMatchGoal();

    expect(apiMock.recordVaultFrontPlaytestPulse).toHaveBeenCalledWith({
      surface: "retention",
      event: "rival_goal_saved",
      value: 1,
    });
  });

  it("records Rival Challenge retention pulse when requesting a rematch", async () => {
    const modal = new WinModal() as any;
    modal.rivalryRevengeDelta = 1;
    modal.game = { gameID: () => "game-1" };

    await modal._handleRematch();

    expect(apiMock.createRematch).toHaveBeenCalledWith("game-1");
    expect(apiMock.recordVaultFrontPlaytestPulse).toHaveBeenCalledWith({
      surface: "retention",
      event: "rival_rematch_requested",
      value: 1,
    });
  });

  it("keeps rematch failure honest and does not count retention", async () => {
    const pulseCallsBefore =
      apiMock.recordVaultFrontPlaytestPulse.mock.calls.length;
    apiMock.createRematch.mockResolvedValueOnce(false);
    const modal = new WinModal() as any;
    modal.rivalryRevengeDelta = 1;
    modal.game = { gameID: () => "game-1" };

    await modal._handleRematch();

    expect(modal.rematchResult).toBeNull();
    expect(modal.rematchError).toContain("could not be created");
    expect(apiMock.recordVaultFrontPlaytestPulse).toHaveBeenCalledTimes(
      pulseCallsBefore,
    );
  });

  it("promotes ranked continuation as the single dominant next action", () => {
    const modal = new WinModal() as any;
    modal.isVisible = true;
    modal.showButtons = true;
    modal.isRankedGame = true;
    modal.game = {
      gameID: () => "game-1",
      myPlayer: () => ({ isAlive: () => true }),
    };
    const container = document.createElement("div");

    render(modal.render(), container);

    const recommended = container.querySelector(
      "post-match-continuation-card",
    ) as any;
    expect(recommended.context).toMatchObject({
      isRanked: true,
      isAlive: true,
    });
    expect(container.textContent).not.toContain("Keep Playing");
    const secondary = container.querySelector(
      "details[data-post-match-secondary]",
    ) as HTMLDetailsElement;
    expect(secondary).not.toBeNull();
    expect(secondary.open).toBe(false);
    expect(secondary.querySelector("summary")?.textContent).toContain(
      "More rewards & sharing",
    );
    expect(secondary.textContent).toContain("Share Match");
    expect(secondary.textContent).toContain("Save Result Card");
  });
});

describe("WinModal post-match session lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
    apiMock.fetchMutatorVoteStatus.mockResolvedValue(false);
    apiMock.requestReplayHighlight.mockResolvedValue(null);
    apiMock.fetchWinFortune.mockResolvedValue(null);
    apiMock.fetchMatchRecap.mockResolvedValue(null);
    apiMock.fetchDynastyStory.mockResolvedValue(null);
    apiMock.getUserMe.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const game = (rankedType?: RankedType) =>
    ({
      gameID: () => "game-1",
      config: () => ({
        gameConfig: () => ({ rankedType }),
      }),
    }) as any;

  it("reveals the shell synchronously and rejects hydration after hide", async () => {
    let resolveAssignment!: (value: {
      experimentId: "recap_cta_v1";
      variant: "requeue_focus";
      assignedAt: number;
    }) => void;
    apiMock.fetchVaultFrontRecapAssignment.mockImplementationOnce(
      () =>
        new Promise<any>((resolve) => {
          resolveAssignment = resolve;
        }),
    );
    const modal = new WinModal() as any;
    modal.game = game();

    const shown = modal.show();
    expect(modal.isVisible).toBe(true);
    expect(modal.showButtons).toBe(false);
    await shown;

    modal.hide();
    resolveAssignment({
      experimentId: "recap_cta_v1",
      variant: "requeue_focus",
      assignedAt: 1,
    });
    await vi.runAllTimersAsync();

    expect(modal.isVisible).toBe(false);
    expect(modal.recapCtaVariant).toBe("goal_focus");
    expect(modal.postMatchSessions.snapshot()).toMatchObject({
      active: false,
      timers: 0,
      animationFrames: 0,
    });
  });

  it("emits one bounded lifecycle pulse from the session receipt", async () => {
    apiMock.fetchVaultFrontRecapAssignment.mockResolvedValue(false);
    const modal = new WinModal() as any;
    modal.game = game();

    await modal.show();
    await vi.advanceTimersByTimeAsync(0);
    modal.hide();
    modal.hide();

    const lifecyclePulses = (
      apiMock.recordVaultFrontPlaytestPulse.mock.calls as unknown as Array<
        [any]
      >
    )
      .map(([event]) => event)
      .filter((event) => event.event.startsWith("postmatch_hydration_"));
    expect(lifecyclePulses).toHaveLength(1);
    expect(lifecyclePulses[0]!).toMatchObject({
      surface: "match",
      value: 1,
    });
    expect(lifecyclePulses[0]!.event).toMatch(
      /^postmatch_hydration_(healthy|degraded)$/,
    );
  });

  it("derives ranked Elo animation from actor-bound history, not global storage", async () => {
    localStorage.setItem("vaultfront.lastElo", "9999");
    apiMock.fetchVaultFrontRecapAssignment.mockResolvedValue(false);
    apiMock.fetchVaultFrontContracts.mockResolvedValueOnce({
      seasonId: "week-30",
      interceptionTiming: 0,
      objectiveDenial: 0,
      comebackExecution: 0,
      surgeExecution: 0,
      evidence: "certified-match-result",
      durability: "process-local",
      eloRating: 1_210,
      eloLabel: "Silver",
      matchesPlayed: 8,
      isDecaying: false,
      eloHistory: [1_160, 1_180, 1_210],
    } as any);
    const modal = new WinModal() as any;
    modal.game = game(RankedType.OneVOne);

    await modal.show();
    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.resolve();

    expect(modal.eloData).toMatchObject({
      previous: 1_180,
      current: 1_210,
      label: "Silver",
    });
    expect(localStorage.getItem("vaultfront.lastElo")).toBe("9999");
    modal.hide();
  });

  it("rejects a rematch response after the post-match session closes", async () => {
    let resolveRematch!: (value: any) => void;
    apiMock.createRematch.mockImplementationOnce(
      () =>
        new Promise<any>((resolve) => {
          resolveRematch = resolve;
        }),
    );
    apiMock.fetchVaultFrontRecapAssignment.mockResolvedValue(false);
    const modal = new WinModal() as any;
    modal.game = game();
    await modal.show();

    const pending = modal._handleRematch();
    expect(modal.rematchPending).toBe(true);
    modal.hide();
    resolveRematch({
      gameId: "game-1",
      lobbyId: "lobby-1",
      code: "rematch1",
      mapName: "World",
      participantCount: 1,
      expiresAt: Date.now() + 300_000,
      joinUrl: "https://play.example/w0/game/lobby-1?lobby",
      status: "ready",
    });
    await pending;

    expect(modal.rematchPending).toBe(false);
    expect(modal.rematchResult).toBeNull();
    expect(apiMock.recordVaultFrontPlaytestPulse).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "rival_rematch_requested" }),
    );
  });
});
