import { render } from "lit";
import { GameRightSidebar } from "../../../../src/client/graphics/layers/GameRightSidebar";
import { GameType } from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("GameRightSidebar Vault feed", () => {
  test("passive income updates merge and render as a single readable feed item", () => {
    const sidebar = new GameRightSidebar() as any;
    const me = {
      smallID: () => 1,
      isFriendly: (player: { smallID: () => number }) => player.smallID() === 2,
    };
    sidebar.game = {
      myPlayer: () => me,
      playerBySmallID: (id: number) => ({
        isPlayer: () => true,
        smallID: () => id,
      }),
      config: () => ({
        numSpawnPhaseTurns: () => 0,
      }),
    };

    sidebar.appendVaultFeed(
      [
        {
          type: GameUpdateType.VaultFrontActivity,
          activity: "vault_passive_income",
          tile: 10,
          sourcePlayerID: 1,
          targetPlayerID: null,
          label: "Vault 1 passive +90,000g",
          durationTicks: 120,
        },
        {
          type: GameUpdateType.VaultFrontActivity,
          activity: "vault_passive_income",
          tile: 11,
          sourcePlayerID: 1,
          targetPlayerID: null,
          label: "Vault 2 passive +90,000g",
          durationTicks: 120,
        },
      ],
      120,
    );

    expect(sidebar.recentVaultFeed).toHaveLength(1);
    expect(sidebar.recentVaultFeed[0].label).toBe("Passive income +90,000g x2");

    const container = document.createElement("div");
    render(sidebar.renderVaultFeed(), container);
    expect(container.textContent).toContain("Passive income +90,000g x2");
  });

  test("feed keeps self events ahead of global noise and prunes expired entries", () => {
    const sidebar = new GameRightSidebar() as any;
    const me = {
      smallID: () => 1,
      isFriendly: (player: { smallID: () => number }) => player.smallID() === 2,
    };
    sidebar.game = {
      myPlayer: () => me,
      playerBySmallID: (id: number) => ({
        isPlayer: () => true,
        smallID: () => id,
      }),
      config: () => ({
        numSpawnPhaseTurns: () => 0,
      }),
    };

    sidebar.appendVaultFeed(
      [
        {
          type: GameUpdateType.VaultFrontActivity,
          activity: "vault_captured",
          tile: 4,
          sourcePlayerID: 8,
          targetPlayerID: null,
          label: "Global vault capture",
          durationTicks: 120,
        },
        {
          type: GameUpdateType.VaultFrontActivity,
          activity: "convoy_delivered",
          tile: 6,
          sourcePlayerID: 1,
          targetPlayerID: null,
          label: "Your convoy delivered",
          durationTicks: 120,
        },
      ],
      100,
    );
    const personal = sidebar.recentVaultFeed.find(
      (entry: any) => entry.label === "Your convoy delivered",
    );
    const global = sidebar.recentVaultFeed.find(
      (entry: any) => entry.label === "Global vault capture",
    );
    expect(personal?.priority).toBeGreaterThan(global?.priority ?? 0);

    sidebar.appendVaultFeed(
      [
        {
          type: GameUpdateType.VaultFrontActivity,
          activity: "jam_breaker",
          tile: 8,
          sourcePlayerID: 9,
          targetPlayerID: null,
          label: "Global jam breaker",
          durationTicks: 120,
        },
      ],
      380,
    );

    expect(sidebar.recentVaultFeed).toHaveLength(1);
    expect(sidebar.recentVaultFeed[0].label).toBe("Global jam breaker");
  });
});

test("beacon pulse enters the short vault feed with a pulse badge", () => {
  const sidebar = new GameRightSidebar() as any;
  const me = {
    smallID: () => 1,
    isFriendly: (player: { smallID: () => number }) => player.smallID() === 2,
  };
  sidebar.game = {
    ticks: () => 160,
    myPlayer: () => me,
    playerBySmallID: (id: number) => ({
      isPlayer: () => true,
      smallID: () => id,
    }),
    config: () => ({
      numSpawnPhaseTurns: () => 0,
    }),
  };

  sidebar.appendVaultFeed(
    [
      {
        type: GameUpdateType.VaultFrontActivity,
        activity: "beacon_pulse",
        tile: 12,
        sourcePlayerID: 3,
        targetPlayerID: null,
        label: "Enemy pulse active",
        durationTicks: 120,
      },
    ],
    140,
  );

  const container = document.createElement("div");
  render(sidebar.renderVaultFeed(), container);

  expect(sidebar.recentVaultFeed).toHaveLength(1);
  expect(container.textContent).toContain("Pulse");
  expect(container.textContent).toContain("Enemy pulse active");
});

test("playtest pulse tile surfaces rival conversion and next operator action", () => {
  const sidebar = new GameRightSidebar() as any;
  sidebar.playtestPulse = {
    generatedAt: "2026-06-07T18:00:00.000Z",
    status: "warming",
    score: 28,
    totals: {
      events: 6,
      tutorialShown: 2,
      tutorialAdvanced: 2,
      tutorialCompleted: 1,
      tutorialSkipped: 0,
      matchFeedback: 1,
      tournamentActions: 0,
      retentionSignals: 2,
      retentionChallengeShown: 2,
      retentionGoalSaved: 0,
      retentionRequeued: 1,
      retentionRematchRequested: 0,
    },
    rates: {
      tutorialAdvance: 1,
      tutorialCompletion: 0.5,
      tutorialSkip: 0,
      matchFeedback: 0.1667,
      retentionAction: 0.5,
    },
    freshness: {
      firstEventAt: "2026-06-07T17:55:00.000Z",
      lastEventAt: "2026-06-07T18:00:00.000Z",
      ageMinutes: 3.2,
    },
    recent: [],
    insights: [],
    actionInsights: ["Continue with a focused rivalry/rematch playtest."],
    operatorNext: {
      headline: "Run the focused rivalry/rematch alpha gate.",
      steps: ["Seed a rivalry scenario."],
      successMetric: "Rival Challenge action rate reaches 25%+.",
    },
    alphaGate: {
      status: "warming",
      checks: {
        fresh: true,
        tutorial: true,
        feedback: true,
        rivalExposure: false,
        rivalAction: false,
      },
      passLabel: "3/5 alpha gate checks passing.",
      nextCheck: "Seed a rivalry rematch scenario.",
    },
  };

  const container = document.createElement("div");
  render(sidebar.renderPlaytestPulseTile(), container);
  const text = container.textContent?.replace(/\s+/g, " ") ?? "";

  expect(text).toContain("Rival action50%");
  expect(text).toContain("Latest signal3m");
  expect(text).toContain("Alpha gatewarming");
  expect(text).toContain("Seed a rivalry rematch scenario.");
  expect(text).toContain("Run the focused rivalry/rematch alpha gate.");
});

test("lifecycle wires visibility events and releases scheduled mastery work", () => {
  vi.useFakeTimers();
  localStorage.setItem("vaultfront.debug", "1");
  localStorage.setItem("vaultfront.kpi.panel", "1");
  const handlers: Array<(event?: any) => void> = [];
  const sidebar = new GameRightSidebar() as any;
  sidebar.viewportWidth = () => 1280;
  sidebar.game = {
    config: () => ({
      gameConfig: () => ({ gameType: GameType.Singleplayer }),
      isReplay: () => false,
    }),
    inSpawnPhase: vi.fn(() => false),
  };
  sidebar.eventBus = {
    on: vi.fn((_eventType: unknown, handler: (event?: any) => void) => {
      handlers.push(handler);
    }),
  };

  sidebar.init();
  handlers[0]({ visible: true });
  handlers[1]({ visible: true });
  handlers[2]();

  expect(sidebar._isSinglePlayer).toBe(true);
  expect(sidebar.vaultDebugActive).toBe(true);
  expect(sidebar.kpiPanelVisible).toBe(true);
  expect(sidebar.timelineExpanded).toBe(true);
  expect(sidebar.spawnBarVisible).toBe(true);
  expect(sidebar.immunityBarVisible).toBe(true);
  expect(sidebar.hasWinner).toBe(true);
  expect(sidebar.dailyMasteryTimers.size).toBe(2);

  sidebar.dispose();
  expect(sidebar.dailyMasteryTimers.size).toBe(0);
});

test("tick consumes authoritative status and persists major activity", () => {
  sessionStorage.setItem("vaultfront.matchTimeline", "not-json");
  let inSpawnPhase = false;
  let ticks = 100;
  const sidebar = new GameRightSidebar() as any;
  const me = {
    smallID: () => 1,
    isLobbyCreator: () => true,
    isFriendly: () => false,
  };
  const status = { type: GameUpdateType.VaultFrontStatus, sites: [] };
  const activity = {
    type: GameUpdateType.VaultFrontActivity,
    activity: "vault_captured",
    tile: 19,
    sourcePlayerID: 1,
    targetPlayerID: null,
    label: "Your vault captured",
    durationTicks: 120,
  };
  sidebar.game = {
    myPlayer: () => me,
    playerBySmallID: (id: number) => ({
      isPlayer: () => true,
      smallID: () => id,
    }),
    config: () => ({
      gameConfig: () => ({ maxTimerValue: 2 }),
      numSpawnPhaseTurns: () => 20,
    }),
    ticks: () => ticks,
    inSpawnPhase: () => inSpawnPhase,
    updatesSinceLastTick: () => ({
      [GameUpdateType.VaultFrontStatus]: [status],
      [GameUpdateType.VaultFrontActivity]: [activity],
    }),
  };

  sidebar.tick();

  expect(sidebar.isLobbyCreator).toBe(true);
  expect(sidebar.timer).toBe(112);
  expect(sidebar.latestVaultStatus).toBe(status);
  expect(sidebar.vaultTimeline).toMatchObject([
    { tick: 100, activity: "vault_captured", tile: 19 },
  ]);
  expect(sidebar.recentVaultFeed).toHaveLength(1);
  expect(
    JSON.parse(sessionStorage.getItem("vaultfront.matchTimeline") ?? "[]"),
  ).toMatchObject([{ tick: 100, activity: "vault_captured", tile: 19 }]);

  inSpawnPhase = true;
  ticks = 110;
  sidebar.tick();
  expect(sidebar.timer).toBe(120);

  inSpawnPhase = false;
  sidebar.hasWinner = true;
  sidebar.timer = 17;
  sidebar.tick();
  expect(sidebar.timer).toBe(17);
});

test("operator controls persist toggles and classify changing vault risk", () => {
  const sidebar = new GameRightSidebar() as any;
  sidebar.playtestPulseLastFetchAt = Date.now();

  sidebar.toggleKpiPanel();
  expect(sidebar.kpiPanelVisible).toBe(true);
  expect(localStorage.getItem("vaultfront.kpi.panel")).toBe("1");
  sidebar.toggleKpiPanel();
  expect(localStorage.getItem("vaultfront.kpi.panel")).toBe("0");

  const debugEvents: boolean[] = [];
  window.addEventListener(
    "vaultfront-debug-toggle",
    ((event: CustomEvent<{ enabled: boolean }>) => {
      debugEvents.push(event.detail.enabled);
    }) as EventListener,
    { once: true },
  );
  sidebar.toggleVaultDebug();
  expect(debugEvents).toEqual([true]);
  expect(sessionStorage.getItem("vaultfront.debug")).toBe("1");

  const initialTimeline = sidebar.timelineExpanded;
  sidebar.toggleTimeline();
  expect(sidebar.timelineExpanded).toBe(!initialTimeline);
  const capturesEnabled = sidebar.timelineFilters.captures;
  sidebar.toggleTimelineFilter("captures");
  expect(sidebar.timelineFilters.captures).toBe(!capturesEnabled);

  expect(sidebar.kpiPercent(1, 4)).toBe("25.0%");
  expect(sidebar.kpiPercent(1, 0)).toBe("0%");
  expect(sidebar.vaultRiskTrend(3, "Low")).toBe("steady");
  expect(sidebar.vaultRiskTrend(3, "Medium")).toBe("rising");
  expect(sidebar.vaultRiskTrend(3, "Low")).toBe("falling");

  const owner = (id: number) => ({
    isPlayer: () => true,
    smallID: () => id,
  });
  const me = {
    smallID: () => 1,
    isFriendly: () => false,
  };
  sidebar.game = {
    x: () => 5,
    y: () => 5,
    width: () => 12,
    height: () => 12,
    ref: (x: number, y: number) => ({ x, y }),
    owner: ({ x, y }: { x: number; y: number }) =>
      x === 5 && y === 5 ? owner(1) : owner(2),
    myPlayer: () => me,
  };

  expect(sidebar.isTerritoryNearVault(12, 1)).toBe(true);
  expect(sidebar.vaultRiskTag(12, 1)).toBe("High");
  expect(sidebar.vaultRiskTag(12, 9)).toBe("Low");
});
