import { render } from "lit";
import { ControlPanel } from "../../../../src/client/graphics/layers/ControlPanel";
import { GameRightSidebar } from "../../../../src/client/graphics/layers/GameRightSidebar";
import { DEFAULT_VAULT_GAMEPLAY_BALANCE } from "../../../../src/core/execution/VaultFrontBalance";

describe("ControlPanel vault HUD automation", () => {
  test("jam-on-next-pulse respects jam breaker cooldown", () => {
    const panel = new ControlPanel() as any;
    const me = {
      smallID: () => 1,
      isFriendly: () => false,
    };
    panel.game = {
      ticks: () => 100,
      myPlayer: () => me,
      playerBySmallID: () => ({
        isPlayer: () => true,
        smallID: () => 2,
      }),
    };
    panel.jamOnNextPulseArmed = true;
    panel.jamBreakerCooldownUntilTick = 180;
    panel.latestVaultStatus = {
      beacons: [
        {
          playerID: 2,
          maskedUntilTick: 140,
        },
      ],
    };

    const sendSpy = vi
      .spyOn(panel, "sendJamBreakerCommand")
      .mockImplementation(() => {});
    panel.maybeTriggerAutoJamOnPulse();

    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("jam-on-next-pulse auto-fires only for active enemy pulse", () => {
    const panel = new ControlPanel() as any;
    const me = {
      smallID: () => 1,
      isFriendly: (player: { smallID: () => number }) => player.smallID() === 1,
    };
    panel.game = {
      ticks: () => 100,
      myPlayer: () => me,
      x: (tile: number) => tile,
      y: (tile: number) => tile,
      width: () => 100,
      height: () => 100,
      ref: (x: number, y: number) => x + y,
      owner: () => ({
        isPlayer: () => false,
      }),
      playerBySmallID: (id: number) => ({
        isPlayer: () => true,
        smallID: () => id,
      }),
    };
    panel.jamOnNextPulseArmed = true;
    panel.jamBreakerCooldownUntilTick = 0;
    panel.latestVaultStatus = {
      beacons: [
        {
          playerID: 2,
          maskedUntilTick: 140,
        },
      ],
    };

    const sendSpy = vi
      .spyOn(panel, "sendJamBreakerCommand")
      .mockImplementation(() => {});
    panel.maybeTriggerAutoJamOnPulse();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith("auto");
  });

  test("jam-on-next-pulse ignores allied pulses", () => {
    const panel = new ControlPanel() as any;
    const me = {
      smallID: () => 1,
      isFriendly: (player: { smallID: () => number }) =>
        player.smallID() === 1 || player.smallID() === 3,
    };
    panel.game = {
      ticks: () => 100,
      myPlayer: () => me,
      x: (tile: number) => tile,
      y: (tile: number) => tile,
      width: () => 100,
      height: () => 100,
      ref: (x: number, y: number) => x + y,
      owner: () => ({
        isPlayer: () => false,
      }),
      playerBySmallID: (id: number) => ({
        isPlayer: () => true,
        smallID: () => id,
      }),
    };
    panel.jamOnNextPulseArmed = true;
    panel.jamBreakerCooldownUntilTick = 0;
    panel.latestVaultStatus = {
      beacons: [
        {
          playerID: 3,
          maskedUntilTick: 140,
        },
      ],
    };

    const sendSpy = vi
      .spyOn(panel, "sendJamBreakerCommand")
      .mockImplementation(() => {});
    panel.maybeTriggerAutoJamOnPulse();

    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("ally convoy fallback does not expose own reroute preview", () => {
    const panel = new ControlPanel() as any;
    const me = {
      smallID: () => 1,
      isFriendly: (player: { smallID: () => number }) => player.smallID() === 2,
    };
    panel.game = {
      ticks: () => 100,
      myPlayer: () => me,
      x: (tile: number) => tile,
      y: (tile: number) => tile,
      width: () => 100,
      height: () => 100,
      ref: (x: number, y: number) => x + y,
      owner: () => ({
        isPlayer: () => false,
      }),
      playerBySmallID: (id: number) => ({
        isPlayer: () => true,
        smallID: () => id,
      }),
    };
    panel.latestVaultStatus = {
      weeklyMutator: "none",
      captureTicksRequired: 90,
      cooldownTicksTotal: 650,
      executionChainWindowTicks: 1500,
      executionChainRewardMultiplier: 1.2,
      sites: [],
      convoys: [
        {
          id: 7,
          ownerID: 2,
          sourceTile: 4,
          destinationTile: 14,
          ticksRemaining: 80,
          totalTicks: 100,
          escortShield: 0,
          goldReward: 180000,
          troopsReward: 1400,
          rewardMultiplier: 1,
          rewardScale: 1,
          strengthMultiplier: 1,
          phaseMultiplier: 1,
          riskMultiplier: 1,
          routeRisk: 0.2,
          routeDistance: 12,
          rewardMath: "test math",
          reroutePreviews: [],
        },
      ],
      beacons: [],
    };
    vi.spyOn(panel, "buildVaultNotices").mockReturnValue([]);
    vi.spyOn(panel, "shouldTrimUnderusedCommands").mockReturnValue(false);
    vi.spyOn(panel, "renderRewardExplainPanel").mockReturnValue("");
    vi.spyOn(panel, "currentCommandHint").mockReturnValue("");
    vi.spyOn(panel, "adaptiveNudgeText").mockReturnValue(null);
    vi.spyOn(panel, "nextVaultObjectiveText").mockReturnValue(
      "Next vault opens in 20s",
    );

    const container = document.createElement("div");
    render(panel.renderVaultHud(), container);

    const normalized = container.textContent?.replace(/\s+/g, " ") ?? "";
    expect(normalized).toContain("Ally Convoy 8s");
    expect(normalized).toContain(
      "Tracking allied convoy. Shield/reroute commands apply only to your convoy.",
    );
    expect(normalized).not.toContain("Pre-Action Reroute Preview");
  });

  test("personal convoy is shown immediately when present", () => {
    const panel = new ControlPanel() as any;
    const me = {
      smallID: () => 1,
      isFriendly: (player: { smallID: () => number }) => player.smallID() === 2,
    };
    panel.game = {
      ticks: () => 100,
      myPlayer: () => me,
      x: (tile: number) => tile,
      y: (tile: number) => tile,
      width: () => 100,
      height: () => 100,
      ref: (x: number, y: number) => x + y,
      owner: () => ({
        isPlayer: () => false,
      }),
      playerBySmallID: (id: number) => ({
        isPlayer: () => true,
        smallID: () => id,
      }),
    };
    panel.latestVaultStatus = {
      weeklyMutator: "none",
      captureTicksRequired: 90,
      cooldownTicksTotal: 650,
      executionChainWindowTicks: 1500,
      executionChainRewardMultiplier: 1.2,
      sites: [],
      convoys: [
        {
          id: 3,
          ownerID: 1,
          sourceTile: 4,
          destinationTile: 14,
          ticksRemaining: 80,
          totalTicks: 100,
          escortShield: 1,
          goldReward: 210000,
          troopsReward: 1500,
          rewardMultiplier: 1.12,
          rewardScale: 1,
          strengthMultiplier: 1.04,
          phaseMultiplier: 1,
          riskMultiplier: 1.08,
          routeRisk: 0.24,
          routeDistance: 12,
          rewardMath: "test math",
          reroutePreviews: [],
        },
      ],
      beacons: [],
    };
    vi.spyOn(panel, "buildVaultNotices").mockReturnValue([]);
    vi.spyOn(panel, "shouldTrimUnderusedCommands").mockReturnValue(false);
    vi.spyOn(panel, "renderRewardExplainPanel").mockReturnValue("");
    vi.spyOn(panel, "currentCommandHint").mockReturnValue("");
    vi.spyOn(panel, "adaptiveNudgeText").mockReturnValue(null);
    vi.spyOn(panel, "nextVaultObjectiveText").mockReturnValue(
      "Next vault opens in 20s",
    );

    const container = document.createElement("div");
    render(panel.renderVaultHud(), container);

    expect(container.textContent).toContain("Vault Convoy 8s");
    expect(container.textContent).toContain("+210,000g +1,500t");
    expect(container.textContent).not.toContain("Ally Convoy 8s");
  });

  test("floating vault HUD and feed anchors do not conflict on desktop", () => {
    const panel = new ControlPanel() as any;
    panel.viewportWidth = () => 1440;
    const sidebar = new GameRightSidebar() as any;
    sidebar.viewportWidth = () => 1440;
    sidebar.spawnBarVisible = false;
    sidebar.immunityBarVisible = false;

    expect(sidebar.vaultFeedRightPx()).toBeGreaterThan(
      panel.floatingVaultHudWidthPx() + panel.floatingVaultHudRightPx(),
    );
    expect(sidebar.vaultFeedTopPx()).toBeGreaterThanOrEqual(
      panel.floatingVaultHudTopPx(),
    );
  });

  test("vault debug query flag enables persistent debug mode", () => {
    const originalPath = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState({}, "", "/?vaultDebug=1");
    localStorage.removeItem("vaultfront.debug");
    sessionStorage.removeItem("vaultfront.debug");

    const panel = new ControlPanel() as any;
    panel.initializeVaultDebugState();

    expect(panel.vaultDebugActive).toBe(true);
    expect(localStorage.getItem("vaultfront.debug")).toBe("1");
    expect(sessionStorage.getItem("vaultfront.debug")).toBe("1");

    window.history.replaceState({}, "", originalPath);
  });

  test("vault debug panel renders live QA checklist", () => {
    const panel = new ControlPanel() as any;
    panel.vaultDebugActive = true;
    panel.vaultQaProgress = {
      vaultCaptured: true,
      passiveIncomeEvents: 1,
      convoyDelivered: 0,
      convoyIntercepted: 2,
    };

    const container = document.createElement("div");
    render(panel.renderVaultDebugPanel(), container);

    expect(container.textContent).toContain("Vault QA");
    expect(container.textContent).toContain("Live verification checklist");
    expect(container.textContent).toContain("Done Capture a vault");
    expect(container.textContent).toContain("Pending Passive gold twice");
    expect(container.textContent).toContain("1/2");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("Command Ops");
    expect(container.textContent).toContain("Live tuning");
  });

  test("vault notices only show the nearest in-range site", () => {
    const panel = new ControlPanel() as any;
    const me = {
      smallID: () => 1,
      isFriendly: () => false,
    };
    panel.game = {
      ticks: () => 100,
      myPlayer: () => me,
      x: (tile: number) => tile % 20,
      y: (tile: number) => Math.floor(tile / 20),
      width: () => 20,
      height: () => 20,
      ref: (x: number, y: number) => y * 20 + x,
      owner: (tile: number) => ({
        isPlayer: () => tile === 22 || tile === 23,
        smallID: () => 1,
      }),
    };
    panel.latestVaultStatus = {
      weeklyMutator: "none",
      captureTicksRequired: 90,
      cooldownTicksTotal: 650,
      executionChainWindowTicks: 1500,
      executionChainRewardMultiplier: 1.2,
      sites: [
        {
          id: 1,
          tile: 24,
          controllerID: null,
          controlTicks: 0,
          cooldownTicks: 40,
          passiveOwnerID: null,
          nextPassiveIncomeTick: 0,
          reducedRewardNextCapture: false,
          projectedGoldReward: 100000,
          projectedTroopsReward: 1000,
          projectedRewardMultiplier: 1,
          projectedDistance: 10,
          projectedRisk: 1,
          rewardMath: "math 1",
        },
        {
          id: 2,
          tile: 399,
          controllerID: null,
          controlTicks: 0,
          cooldownTicks: 10,
          passiveOwnerID: null,
          nextPassiveIncomeTick: 0,
          reducedRewardNextCapture: false,
          projectedGoldReward: 200000,
          projectedTroopsReward: 2000,
          projectedRewardMultiplier: 1,
          projectedDistance: 20,
          projectedRisk: 2,
          rewardMath: "math 2",
        },
      ],
      convoys: [],
      beacons: [],
    };

    const notices = panel.buildVaultNotices();

    expect(notices).toHaveLength(1);
    expect(notices[0].siteID).toBe(1);
  });

  test("vault notices stay hidden when no territory is near a site", () => {
    const panel = new ControlPanel() as any;
    const me = {
      smallID: () => 1,
      isFriendly: () => false,
    };
    panel.game = {
      ticks: () => 100,
      myPlayer: () => me,
      x: (tile: number) => tile % 20,
      y: (tile: number) => Math.floor(tile / 20),
      width: () => 20,
      height: () => 20,
      ref: (x: number, y: number) => y * 20 + x,
      owner: () => ({
        isPlayer: () => false,
      }),
    };
    panel.latestVaultStatus = {
      weeklyMutator: "none",
      captureTicksRequired: 90,
      cooldownTicksTotal: 650,
      executionChainWindowTicks: 1500,
      executionChainRewardMultiplier: 1.2,
      sites: [
        {
          id: 7,
          tile: 310,
          controllerID: null,
          controlTicks: 0,
          cooldownTicks: 20,
          passiveOwnerID: null,
          nextPassiveIncomeTick: 0,
          reducedRewardNextCapture: false,
          projectedGoldReward: 100000,
          projectedTroopsReward: 1000,
          projectedRewardMultiplier: 1,
          projectedDistance: 10,
          projectedRisk: 1,
          rewardMath: "math",
        },
      ],
      convoys: [],
      beacons: [],
    };

    expect(panel.buildVaultNotices()).toEqual([]);
  });

  test("vault debug waiting card renders before status arrives", () => {
    const panel = new ControlPanel() as any;
    panel._isVisible = true;
    panel.vaultDebugActive = true;
    panel.latestVaultStatus = null;

    const container = document.createElement("div");
    render(panel.renderFloatingVaultHud(), container);

    expect(container.textContent).toContain("VaultFront Debug");
    expect(container.textContent).toContain("Waiting for VaultFront status");
  });

  test("vault HUD surfaces immediate action callout for high-risk convoy", () => {
    const panel = new ControlPanel() as any;
    const me = {
      smallID: () => 1,
      isFriendly: () => false,
    };
    panel.game = {
      ticks: () => 100,
      myPlayer: () => me,
      x: (tile: number) => tile,
      y: (tile: number) => 0,
      width: () => 200,
      height: () => 20,
      ref: (x: number, y: number) => x + y,
      owner: (tile: number) => ({
        isPlayer: () => tile >= 6 && tile <= 10,
        smallID: () => 2,
      }),
      playerBySmallID: (id: number) => ({
        isPlayer: () => true,
        smallID: () => id,
      }),
    };
    panel.latestVaultStatus = {
      weeklyMutator: "none",
      captureTicksRequired: 90,
      cooldownTicksTotal: 650,
      executionChainWindowTicks: 1500,
      executionChainRewardMultiplier: 1.2,
      passiveGoldPerMinute: 75000,
      jamBreakerGoldCost:
        DEFAULT_VAULT_GAMEPLAY_BALANCE.defense.jamBreakerGoldCost,
      escortDurationTicks: 600,
      sites: [],
      convoys: [
        {
          id: 11,
          ownerID: 1,
          sourceTile: 4,
          destinationTile: 10,
          ticksRemaining: 20,
          totalTicks: 100,
          escortShield: 0,
          goldReward: 190000,
          troopsReward: 1400,
          rewardMultiplier: 1,
          rewardScale: 1,
          strengthMultiplier: 1,
          phaseMultiplier: 1,
          riskMultiplier: 1,
          routeRisk: 0.65,
          routeDistance: 16,
          rewardMath: "test math",
          reroutePreviews: [],
        },
      ],
      beacons: [
        {
          playerID: 1,
          charge: 80,
          cooldownUntilTick: 0,
          maskedUntilTick: 0,
          jamBreakerCooldownUntilTick: 0,
          escortUntilTick: 0,
          factoryCount: 1,
        },
      ],
    };
    vi.spyOn(panel, "buildVaultNotices").mockReturnValue([]);
    vi.spyOn(panel, "renderRewardExplainPanel").mockReturnValue("");
    vi.spyOn(panel, "currentCommandHint").mockReturnValue("");
    vi.spyOn(panel, "adaptiveNudgeText").mockReturnValue(null);
    vi.spyOn(panel, "nextVaultObjectiveText").mockReturnValue(
      "Next vault opens in 20s",
    );

    const container = document.createElement("div");
    render(panel.renderVaultHud(), container);

    expect(container.textContent).toContain("Act Now");
    expect(container.textContent).toContain("Shield Nearest before contact");
    expect(container.textContent).toContain("115,000 gold");
  });
  test("vault debug toggle event updates panel state", () => {
    const panel = new ControlPanel() as any;
    panel.vaultDebugActive = false;

    panel.onVaultDebugToggle(
      new CustomEvent("vaultfront-debug-toggle", {
        detail: { enabled: true },
      }),
    );

    expect(panel.vaultDebugActive).toBe(true);
  });

  test("vault HUD telegraphs pressure and the active breach deadline", () => {
    const panel = new ControlPanel() as any;
    const me = { smallID: () => 1, isFriendly: () => false };
    panel.game = {
      ticks: () => 1200,
      myPlayer: () => me,
      x: (tile: number) => tile,
      y: () => 0,
      width: () => 100,
      height: () => 20,
      ref: (x: number, y: number) => x + y,
      owner: () => ({ isPlayer: () => false }),
      playerBySmallID: () => ({ isPlayer: () => false }),
    };
    panel.latestVaultStatus = {
      weeklyMutator: "none",
      captureTicksRequired: 90,
      cooldownTicksTotal: 650,
      executionChainWindowTicks: 1500,
      executionChainRewardMultiplier: 1.2,
      passiveGoldPerMinute: 75000,
      jamBreakerGoldCost:
        DEFAULT_VAULT_GAMEPLAY_BALANCE.defense.jamBreakerGoldCost,
      escortDurationTicks: 600,
      sites: [],
      convoys: [],
      beacons: [],
      executionChains: {},
      surges: {},
      squadObjectives: [],
      pressure: {
        1: {
          pressure: 3,
          threshold: 3,
          breachWindowUntilTick: 1350,
          deliveriesRequired: 1,
          victorySecured: false,
        },
      },
    };
    vi.spyOn(panel, "buildVaultNotices").mockReturnValue([]);
    vi.spyOn(panel, "renderRewardExplainPanel").mockReturnValue("");
    vi.spyOn(panel, "currentCommandHint").mockReturnValue("");
    vi.spyOn(panel, "adaptiveNudgeText").mockReturnValue(null);
    vi.spyOn(panel, "nextVaultObjectiveText").mockReturnValue(
      "Protect the breach window",
    );

    const container = document.createElement("div");
    render(panel.renderVaultHud(), container);

    expect(container.textContent).toContain("BREACH WINDOW 15s");
    expect(container.textContent).toContain("deliver one convoy to win");
  });

  test("tutorial lock releases after first vault and convoy engagement while the primary arc continues", () => {
    const panel = new ControlPanel() as any;
    panel.tutorialLockActive = true;
    panel.onboardingProgress = {
      focusSet: false,
      vaultCaptured: true,
      convoyAction: true,
      pressureStarted: false,
      breachOpened: false,
      decisiveDelivery: false,
      pulseTriggered: false,
    };

    expect(panel.onboardingChainCompleted()).toBe(false);
    expect(panel.tutorialLockActive).toBe(false);
  });

  test("onboarding presentation separates the decisive primary arc from optional mastery", () => {
    const panel = new ControlPanel() as any;
    panel.latestVaultStatus = { pressure: {}, beacons: [] };
    panel.game = { ticks: () => 100 };
    panel.onboardingProgress = {
      focusSet: true,
      vaultCaptured: true,
      convoyAction: true,
      pressureStarted: true,
      breachOpened: true,
      decisiveDelivery: false,
      pulseTriggered: false,
    };

    const container = document.createElement("div");
    render(panel.renderOnboarding(), container);

    expect(container.textContent).toContain(
      "Land the decisive Breach delivery",
    );
    const copy = container.textContent?.replace(/\s+/g, " ");
    expect(copy).toContain("Optional mastery: [x] Resource Focus");
    expect(copy).toContain("[ ] Defense Factory pulse");
    expect(copy).toContain("You: 0 Pressure deliveries · Team: 0/0");
  });
});
