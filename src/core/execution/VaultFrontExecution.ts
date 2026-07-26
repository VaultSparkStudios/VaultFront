import {
  Execution,
  Game,
  MessageType,
  Player,
  UnitType,
  VaultFrontCommand,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  GameUpdateType,
  MapEventType,
  VaultFrontExecutionChainState,
  VaultFrontPressureState,
  VaultFrontSquadObjectiveState,
  VaultFrontStatusUpdate,
  VaultFrontSurgeState,
} from "../game/GameUpdates";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { planConvoyReward, type ConvoyRewardPlan } from "./VaultFrontBalance";
import {
  projectVaultFrontMutatorBalance,
  VAULTFRONT_RUNTIME_BALANCE,
} from "./VaultFrontRuntimeBalance";
import {
  DEFAULT_VAULT_PRESSURE_CONFIG,
  deliverToVaultPressure,
  expireVaultPressureWindow,
  initialVaultPressureState,
  projectVaultPressure,
  type VaultPressureKernelState,
} from "./VaultPressureKernel";

interface VaultSite {
  id: number;
  tile: TileRef;
  controllerID: number | null;
  controlTicks: number;
  cooldownTicks: number;
  passiveOwnerID: number | null;
  nextPassiveGoldTick: number;
  reducedRewardNextCapture: boolean;
  uncontrolledSinceTick: number;
  vacantAlertFiredAtTick: number;
  accumulatedPassiveGold: bigint;
}

interface VaultConvoy {
  id: number;
  ownerID: number;
  sourceTile: TileRef;
  destinationTile: TileRef;
  ticksRemaining: number;
  totalTicks: number;
  goldReward: bigint;
  troopsReward: number;
  rewardMultiplier: number;
  rewardScale: number;
  strengthMultiplier: number;
  phaseMultiplier: number;
  riskMultiplier: number;
  routeRisk: number;
  routeDistance: number;
  rewardMath: string;
  escortShield: number;
  reroutes: number;
  interceptProbability: number;
  ghostConvoy: boolean;
}

interface BeaconState {
  charge: number;
  cooldownUntil: number;
  maskedUntil: number;
  anchorTile?: TileRef;
}

interface SquadObjectiveWindow {
  siteID: number;
  ownerID: number;
  anchorTile: TileRef;
  expiresAtTick: number;
  participants: Set<number>;
  rewarded: boolean;
}

export class VaultFrontExecution implements Execution {
  private readonly tuning = VAULTFRONT_RUNTIME_BALANCE;
  private mutatorBalance = projectVaultFrontMutatorBalance("none");
  private active = true;
  private game!: Game;
  private random!: PseudoRandom;
  private statusProjectionDirty = true;
  private statusProjectionCritical = true;
  private lastStatusProjectionTick = Number.NEGATIVE_INFINITY;
  private lastStatusProjectionDigest: number | null = null;
  private lastStatusProjectionSerialized: string | null = null;
  private statusProjectionBuilds = 0;
  private statusProjectionPublishes = 0;
  private statusProjectionDeduplicated = 0;
  private statusProjectionBuildSamplesMs: number[] = [];

  private vaultSites: VaultSite[] = [];
  private convoys: VaultConvoy[] = [];
  private nextConvoyID = 1;
  private beacons = new Map<number, BeaconState>();
  private preferredConvoyDestination = new Map<number, UnitType>();
  private escortUntilTick = new Map<number, number>();
  private jamBreakerCooldownUntil = new Map<number, number>();
  private ghostRouteCooldownUntil = new Map<number, number>();
  private behindSinceTick = new Map<number, number>();
  private surgeUntilTick = new Map<number, number>();
  private minute8BehindMarked = new Set<number>();
  private executionChainStep = new Map<number, 0 | 1 | 2>();
  private executionChainExpiresAtTick = new Map<number, number>();
  private executionStreakNextConvoyMultiplier = new Map<number, number>();
  private squadObjectiveWindows: SquadObjectiveWindow[] = [];
  private lastPublishedConvoyDebugKey = "";

  // Vault Pressure — three deliveries open a short, telegraphed Breach
  // Window; one further delivery during that window wins. All state lives in
  // deterministic simulation memory, so clients and replays derive the same
  // outcome without a server-side timing oracle.
  private vaultPressureStates = new Map<number, VaultPressureKernelState>();
  private vaultBreachVictorID: number | null = null;

  // Chain Guardian: consecutive vault captures per player (resets on site loss)
  private consecutiveVaultCaptures = new Map<number, number>();
  private commandTimestamps = new Map<number, number[]>();
  private lastStandTriggeredBy = new Set<number>();
  private lastStandBonusUntilTick = new Map<number, number>();
  private heistActivated = new Set<number>();
  private heistConvoyId = new Map<number, number>();
  private heistCooldownUntil = new Map<number, number>();
  private convoyInterceptsBy = new Map<number, Map<number, number>>();
  private activeBounties = new Map<
    number,
    { reward: bigint; chargesLeft: number; expiresAtTick: number }
  >();
  private warchestMarkPlayerID: number | null = null;
  private warchestHuntUntilTick = 0;
  private warchestHuntFired = false;
  private activeMapEvent: MapEventType | null = null;
  private mapEventUntilTick = 0;
  private nextMapEventTick = 0;
  private intelActiveUntilTick = new Map<number, number>();
  private deepIntelActiveUntilTick = new Map<number, number>();
  private sabotageCharges = new Map<number, Map<number, number>>();
  private dispatchDelayUntilTick = new Map<number, number>();
  private tradeDealNextConvoy = new Map<number, number>();

  private weeklyMutator:
    | "none"
    | "lane_fog"
    | "accelerated_cooldowns"
    | "double_passive"
    | "gold_rush"
    | "blitz"
    | "no_mercy"
    | "contested"
    | "shield_escort"
    | "rally_point"
    | "execution_rush" = "none";

  // Vault sites and convoy extraction.

  init(mg: Game): void {
    this.game = mg;
    const seed = simpleHash(
      `vaultfront:${mg.width()}x${mg.height()}:${mg.numLandTiles()}`,
    );
    this.random = new PseudoRandom(seed);
    this.weeklyMutator = this.game.config().vaultWeeklyMutator();
    this.mutatorBalance = projectVaultFrontMutatorBalance(this.weeklyMutator);

    for (const player of this.game.allPlayers()) {
      this.preferredConvoyDestination.set(player.smallID(), UnitType.City);
      this.escortUntilTick.set(player.smallID(), 0);
      this.jamBreakerCooldownUntil.set(player.smallID(), 0);
      this.behindSinceTick.set(player.smallID(), -1);
      this.surgeUntilTick.set(player.smallID(), 0);
      this.executionChainStep.set(player.smallID(), 0);
      this.executionChainExpiresAtTick.set(player.smallID(), 0);
      this.executionStreakNextConvoyMultiplier.set(player.smallID(), 1);
      this.beacons.set(player.smallID(), {
        charge: this.random.nextInt(
          this.tuning.gameplay.simulation.initialBeaconChargeMin,
          this.tuning.gameplay.simulation.initialBeaconChargeMax,
        ),
        cooldownUntil: 0,
        maskedUntil: 0,
      });
      this.heistCooldownUntil.set(player.smallID(), 0);
      this.convoyInterceptsBy.set(player.smallID(), new Map());
      this.intelActiveUntilTick.set(player.smallID(), 0);
      this.deepIntelActiveUntilTick.set(player.smallID(), 0);
      this.sabotageCharges.set(player.smallID(), new Map());
      this.dispatchDelayUntilTick.set(player.smallID(), 0);
      this.vaultPressureStates.set(
        player.smallID(),
        initialVaultPressureState(),
      );
    }

    this.nextMapEventTick =
      this.tuning.mapEventMinIntervalTicks +
      this.random.nextInt(
        0,
        this.tuning.mapEventMaxIntervalTicks -
          this.tuning.mapEventMinIntervalTicks,
      );

    if (this.game.config().vaultSitesEnabled()) {
      this.createVaultSites();
      if (this.vaultSites.length > 0) {
        this.game.displayMessage(
          `VaultFront: ${this.vaultSites.length} vault sites are now contested.`,
          MessageType.ATTACK_REQUEST,
          null,
        );
        if (this.weeklyMutator !== "none") {
          const mutatorLabels: Record<string, string> = {
            lane_fog: "Lane Fog",
            accelerated_cooldowns: "Accelerated Cooldowns",
            double_passive: "Double Passive",
            gold_rush: "Gold Rush",
            blitz: "Blitz",
            no_mercy: "No Mercy",
            contested: "Contested",
            shield_escort: "Shielded Run",
            rally_point: "Rally Point",
            execution_rush: "Execution Rush",
          };
          const mutatorLabel =
            mutatorLabels[this.weeklyMutator] ?? this.weeklyMutator;
          this.game.displayMessage(
            `Weekly VaultFront mutator active: ${mutatorLabel}.`,
            MessageType.CHAT,
            null,
          );
        }
      }
    }
  }

  tick(ticks: number): void {
    if (this.game.inSpawnPhase()) {
      return;
    }

    this.handleQueuedCommands(ticks);
    this.sweepExpiredBreachWindows(ticks);
    this.updateComebackState(ticks);
    this.sweepExpiredSquadObjectives(ticks);
    for (const player of this.game.players()) {
      const playerID = player.smallID();
      const step = this.executionChainStep.get(playerID) ?? 0;
      if (
        step > 0 &&
        ticks > (this.executionChainExpiresAtTick.get(playerID) ?? 0)
      ) {
        this.resetExecutionChain(playerID);
      }
    }

    if (this.game.config().vaultSitesEnabled()) {
      this.tickVaultSites(ticks);
      this.tickConvoys(ticks);
    }

    if (this.game.config().intelOperationsEnabled()) {
      this.tickCountersurveillance(ticks);
    }

    this.checkWarchestHunt(ticks);
    this.tickMapEvents(ticks);
    // Dynamic timers can advance every tick, but the user-facing projection is
    // intentionally bounded to 2 Hz (at the canonical 100 ms tick). Critical
    // activity bypasses the cadence and unchanged snapshots are suppressed.
    this.statusProjectionDirty = true;
    this.maybePublishStatusUpdate(ticks);
  }

  private createVaultSites(): void {
    const landTiles: TileRef[] = [];
    this.game.forEachTile((tile) => {
      if (this.game.isLand(tile)) {
        landTiles.push(tile);
      }
    });

    const playerCount = this.game.allPlayers().length;
    const hardCap =
      playerCount >= this.tuning.gameplay.sitePlacement.largeLobbyPlayers
        ? this.tuning.gameplay.sitePlacement.largeLobbySiteCap
        : this.tuning.gameplay.sitePlacement.standardSiteCap;
    const maxSites = Math.min(
      hardCap,
      Math.max(
        this.tuning.gameplay.sitePlacement.minimumSites,
        Math.floor(
          landTiles.length /
            this.tuning.gameplay.sitePlacement.landTilesPerSite,
        ),
      ),
    );
    const minSpacing = Math.max(
      35,
      Math.floor(Math.sqrt(this.game.numLandTiles()) / 3),
    );
    const shuffled = this.random.shuffleArray(landTiles);

    const selected: TileRef[] = [];
    for (const tile of shuffled) {
      const farEnough = selected.every(
        (existing) => this.game.manhattanDist(existing, tile) >= minSpacing,
      );
      if (!farEnough) {
        continue;
      }
      selected.push(tile);
      if (selected.length >= maxSites) {
        break;
      }
    }

    this.vaultSites = selected.map((tile, index) => ({
      id: index + 1,
      tile,
      controllerID: null,
      controlTicks: 0,
      cooldownTicks: 0,
      passiveOwnerID: null,
      nextPassiveGoldTick: 0,
      reducedRewardNextCapture: false,
      uncontrolledSinceTick: 0,
      vacantAlertFiredAtTick: -1,
      accumulatedPassiveGold: 0n,
    }));
  }

  private handleQueuedCommands(ticks: number): void {
    const commands = this.game.drainVaultFrontCommands();
    if (commands.length === 0) {
      return;
    }

    for (const command of commands) {
      const player = this.game.playerBySmallID(command.playerSmallID);
      if (!player.isPlayer() || !player.isAlive()) {
        continue;
      }
      // Rate limit: max 5 commands per 10-tick window per player
      const pid = command.playerSmallID;
      const timestamps = this.commandTimestamps.get(pid) ?? [];
      const windowStart = ticks - this.tuning.commandRateWindowTicks;
      const recent = timestamps.filter((t) => t > windowStart);
      if (recent.length >= this.tuning.commandRateMaxPerWindow) {
        continue;
      }
      recent.push(ticks);
      this.commandTimestamps.set(pid, recent);
      this.handleCommand(player, command, ticks);
    }
  }

  private handleCommand(
    player: Player,
    command: VaultFrontCommand,
    ticks: number,
  ): void {
    switch (command.type) {
      case "reroute_city":
      case "reroute_port":
      case "reroute_factory":
      case "reroute_silo":
      case "reroute_safest":
        this.applyRerouteCommand(player, command.type, ticks);
        return;
      case "escort":
        this.applyEscortCommand(player, ticks);
        return;
      case "jam_breaker":
        this.applyJamBreakerCommand(player, ticks);
        return;
      case "ghost_route":
        this.applyGhostRouteCommand(player, ticks);
        return;
      case "vault_heist":
        this.applyVaultHeistCommand(player, ticks);
        return;
      case "purchase_intel":
        this.applyPurchaseIntelCommand(player, ticks, false);
        return;
      case "purchase_deep_intel":
        this.applyPurchaseIntelCommand(player, ticks, true);
        return;
      case "sabotage":
        this.applySabotageCommand(player, command, ticks);
        return;
      case "bribe":
        this.applyBribeCommand(player, command, ticks);
        return;
      case "trade_deal":
        this.applyTradeDealCommand(player, command, ticks);
        return;
      case "sell_intel":
        this.applySellIntelCommand(player, ticks);
        return;
      default:
        return;
    }
  }

  private commandUnitType(
    command:
      | "reroute_city"
      | "reroute_port"
      | "reroute_factory"
      | "reroute_silo"
      | "reroute_safest",
  ): UnitType | undefined {
    if (command === "reroute_port") return UnitType.Port;
    if (command === "reroute_factory") return UnitType.Factory;
    if (command === "reroute_silo") return UnitType.MissileSilo;
    if (command === "reroute_safest") return undefined;
    return UnitType.City;
  }

  private applyRerouteCommand(
    player: Player,
    command:
      | "reroute_city"
      | "reroute_port"
      | "reroute_factory"
      | "reroute_silo"
      | "reroute_safest",
    ticks: number,
  ): void {
    const preferred = this.commandUnitType(command);
    if (preferred !== undefined) {
      this.preferredConvoyDestination.set(player.smallID(), preferred);
    }

    const active = this.convoys
      .filter((convoy) => convoy.ownerID === player.smallID())
      .sort((a, b) => a.ticksRemaining - b.ticksRemaining)[0];
    if (!active) {
      this.game.displayMessage(
        command === "reroute_safest"
          ? "No active Vault Convoy to reroute yet."
          : "Vault Convoy preference updated for your next launch.",
        MessageType.CHAT,
        player.id(),
      );
      return;
    }

    const currentTile = this.convoyProgressTile(active);
    const destination = this.bestConvoyDestination(
      player,
      currentTile,
      preferred,
      command,
    );
    if (destination === active.destinationTile) {
      return;
    }
    active.destinationTile = destination;
    const distance = this.game.manhattanDist(currentTile, destination);
    active.ticksRemaining = Math.max(
      this.tuning.gameplay.rewardDynamics.rerouteTravelMinTicks,
      Math.min(
        this.tuning.gameplay.rewardDynamics.travelMaxTicks,
        Math.floor(
          distance / this.tuning.gameplay.rewardDynamics.travelDistanceDivisor,
        ),
      ),
    );
    active.totalTicks = Math.max(active.totalTicks, active.ticksRemaining + 1);
    const routeRisk = this.routeRiskScore(player, currentTile, destination);
    const updatedPlan = this.convoyRewardPlan(
      player,
      distance,
      routeRisk,
      ticks,
      active.rewardScale,
    );
    active.routeDistance = distance;
    active.routeRisk = routeRisk;
    active.rewardMultiplier = updatedPlan.rewardMultiplier;
    active.strengthMultiplier = updatedPlan.strengthMultiplier;
    active.phaseMultiplier = updatedPlan.phaseMultiplier;
    active.riskMultiplier = updatedPlan.riskMultiplier;
    active.rewardMath = updatedPlan.rewardMath;
    active.goldReward = updatedPlan.goldReward;
    active.troopsReward = updatedPlan.troopsReward;
    active.reroutes += 1;
    active.interceptProbability = this.computeInterceptProbability(
      player,
      currentTile,
      destination,
    );

    this.emitActivity(
      "convoy_rerouted",
      currentTile,
      player.smallID(),
      null,
      "Vault Convoy rerouted",
      120,
    );
    this.game.stats().vaultConvoyRerouted(player);
    this.game.displayMessage(
      command === "reroute_safest"
        ? `Vault Convoy rerouted to safest lane. New ETA ${Math.ceil(active.ticksRemaining / 10)}s.`
        : `Vault Convoy rerouted. New ETA ${Math.ceil(active.ticksRemaining / 10)}s.`,
      MessageType.CHAT,
      player.id(),
    );
  }

  private applyEscortCommand(player: Player, ticks: number): void {
    const until = ticks + this.mutatorBalance.escortDurationTicks;
    this.escortUntilTick.set(player.smallID(), until);

    for (const convoy of this.convoys) {
      if (convoy.ownerID === player.smallID()) {
        convoy.escortShield = Math.max(
          convoy.escortShield,
          this.tuning.gameplay.rewardDynamics.standardEscortStrength,
        );
      }
    }

    const anchor = player.spawnTile();
    this.game.stats().vaultConvoyEscortCommand(player);
    if (anchor !== undefined) {
      this.emitActivity(
        "convoy_escorted",
        anchor,
        player.smallID(),
        null,
        "Vault Convoy escort active",
        130,
      );
      this.contributeToSquadObjective(player, ticks, anchor);
    }
    this.game.displayMessage(
      "Escort command active: your Vault Convoys can evade one intercept.",
      MessageType.CHAT,
      player.id(),
    );
  }

  private applyJamBreakerCommand(player: Player, ticks: number): void {
    const cooldownUntil =
      this.jamBreakerCooldownUntil.get(player.smallID()) ?? 0;
    if (ticks < cooldownUntil) {
      return;
    }
    if (player.gold() < this.tuning.jamBreakerGoldCost) {
      const shortfall = this.tuning.jamBreakerGoldCost - player.gold();
      this.game.displayMessage(
        `Jam Breaker requires ${this.tuning.jamBreakerGoldCost.toLocaleString()} gold (short ${shortfall.toLocaleString()}).`,
        MessageType.ATTACK_FAILED,
        player.id(),
      );
      return;
    }
    player.removeGold(this.tuning.jamBreakerGoldCost);
    this.game.stats().defenseFactoryJamBreaker(player);
    this.jamBreakerCooldownUntil.set(
      player.smallID(),
      ticks + this.mutatorBalance.jamBreakerCooldownTicks,
    );

    let deniedPulse = false;
    for (const [playerID, beacon] of this.beacons.entries()) {
      if (playerID === player.smallID()) continue;
      const other = this.game.playerBySmallID(playerID);
      if (!other.isPlayer() || player.isFriendly(other)) continue;
      if (beacon.maskedUntil > ticks) {
        deniedPulse = true;
      }
      beacon.maskedUntil = Math.min(
        beacon.maskedUntil,
        ticks + this.tuning.jamBreakerMaskClampTicks,
      );
      beacon.charge = Math.max(
        0,
        beacon.charge - this.tuning.gameplay.defense.jamChargeReduction,
      );
    }

    const anchor = player.spawnTile();
    if (anchor !== undefined) {
      this.emitActivity(
        "jam_breaker",
        anchor,
        player.smallID(),
        null,
        "Jam Breaker triggered",
        150,
      );
      this.contributeToSquadObjective(player, ticks, anchor);
    }
    this.updateExecutionChainPulseDeny(player, ticks, deniedPulse);
    this.game.displayMessage(
      "Jam Breaker active: enemy intel masking pulse duration reduced.",
      MessageType.CHAT,
      player.id(),
    );
  }

  private applyGhostRouteCommand(player: Player, ticks: number): void {
    const cooldownUntil =
      this.ghostRouteCooldownUntil.get(player.smallID()) ?? 0;
    if (ticks < cooldownUntil) return;

    const convoy = this.convoys.find(
      (c) => c.ownerID === player.smallID() && !c.ghostConvoy,
    );
    if (!convoy) return;

    convoy.ghostConvoy = true;
    this.ghostRouteCooldownUntil.set(
      player.smallID(),
      ticks + this.tuning.ghostRouteCooldownTicks,
    );

    this.emitActivity(
      "convoy_rerouted",
      convoy.sourceTile,
      player.smallID(),
      null,
      "Ghost route activated — convoy is cloaked",
      60,
    );
  }

  // ── Vault Heist ──────────────────────────────────────────────────────────

  private applyVaultHeistCommand(player: Player, ticks: number): void {
    const pid = player.smallID();
    if (this.heistActivated.has(pid)) {
      this.game.displayMessage(
        "Vault Heist is already primed on your active convoy.",
        MessageType.CHAT,
        player.id(),
      );
      return;
    }
    if (ticks < (this.heistCooldownUntil.get(pid) ?? 0)) {
      this.game.displayMessage(
        "Vault Heist is on cooldown.",
        MessageType.CHAT,
        player.id(),
      );
      return;
    }
    if (player.numTilesOwned() > this.tuning.gameplay.heist.maxTerritories) {
      this.game.displayMessage(
        "Vault Heist is only available when you control 2 or fewer territories.",
        MessageType.CHAT,
        player.id(),
      );
      return;
    }
    if (player.gold() < this.tuning.heistActivationCost) {
      this.game.displayMessage(
        `Vault Heist requires ${this.tuning.heistActivationCost.toLocaleString()} gold.`,
        MessageType.CHAT,
        player.id(),
      );
      return;
    }
    const convoy = this.convoys.find((c) => c.ownerID === pid);
    if (!convoy) {
      this.game.displayMessage(
        "Vault Heist requires an active convoy in transit.",
        MessageType.CHAT,
        player.id(),
      );
      return;
    }
    player.addGold(-this.tuning.heistActivationCost);
    this.heistActivated.add(pid);
    this.heistConvoyId.set(pid, convoy.id);
    this.game.displayMessage(
      `VAULT HEIST primed — convoy will extract gold from the next vault site it reaches.`,
      MessageType.CAPTURED_ENEMY_UNIT,
      player.id(),
    );
  }

  private resolveHeistOnArrival(
    convoy: VaultConvoy,
    destTile: TileRef,
    ticks: number,
  ): void {
    const pid = convoy.ownerID;
    if (!this.heistActivated.has(pid)) return;
    if (this.heistConvoyId.get(pid) !== convoy.id) return;

    const site = this.vaultSites.find(
      (s) => s.tile === destTile && s.passiveOwnerID !== null,
    );
    if (!site) {
      this.heistActivated.delete(pid);
      this.heistConvoyId.delete(pid);
      return;
    }

    const stolenRaw =
      site.accumulatedPassiveGold /
      BigInt(this.tuning.gameplay.heist.stolenGoldDivisor);
    const stolen =
      stolenRaw > this.tuning.heistGoldCap
        ? this.tuning.heistGoldCap
        : stolenRaw;
    if (stolen <= 0n) {
      this.heistActivated.delete(pid);
      this.heistConvoyId.delete(pid);
      return;
    }

    const victimID = site.passiveOwnerID;
    const victim =
      victimID !== null ? this.game.playerBySmallID(victimID) : null;
    if (victim?.isPlayer() && victim.isAlive()) {
      victim.addGold(-stolen);
    }
    const heistPlayer = this.game.playerBySmallID(pid);
    if (heistPlayer.isPlayer()) {
      heistPlayer.addGold(stolen, destTile);
    }
    site.accumulatedPassiveGold -= stolen;

    this.heistActivated.delete(pid);
    this.heistConvoyId.delete(pid);
    this.heistCooldownUntil.set(pid, ticks + this.tuning.heistCooldownTicks);

    this.game.addUpdate({
      type: GameUpdateType.HeistExecuted,
      heistPlayerID: pid,
      victimPlayerID: victimID,
      goldStolen: Number(stolen),
      tile: destTile,
    });
    this.emitActivity(
      "heist_executed",
      destTile,
      pid,
      victimID,
      `VAULT HEIST! +${stolen.toLocaleString()}g extracted`,
      200,
    );
    if (heistPlayer.isPlayer()) {
      this.game.displayMessage(
        `VAULT HEIST succeeded! Extracted ${stolen.toLocaleString()} gold from the vault.`,
        MessageType.CAPTURED_ENEMY_UNIT,
        heistPlayer.id(),
        stolen,
      );
    }
  }

  // ── Bounty Board ─────────────────────────────────────────────────────────

  private trackConvoyIntercept(
    interceptorID: number,
    victimID: number,
    ticks: number,
  ): void {
    const bounty = this.activeBounties.get(victimID);
    if (bounty && ticks <= bounty.expiresAtTick) {
      const interceptor = this.game.playerBySmallID(interceptorID);
      if (interceptor.isPlayer() && interceptor.isAlive()) {
        interceptor.addGold(bounty.reward);
        bounty.chargesLeft--;
        this.game.addUpdate({
          type: GameUpdateType.BountyCollected,
          collectorPlayerID: interceptorID,
          targetPlayerID: victimID,
          rewardGold: Number(bounty.reward),
          chargesLeft: bounty.chargesLeft,
        });
        this.emitActivity(
          "bounty_collected",
          interceptor.isPlayer()
            ? (interceptor.tiles()[0] ??
                this.vaultSites[0]?.tile ??
                (0 as unknown as TileRef))
            : (0 as unknown as TileRef),
          interceptorID,
          victimID,
          `Bounty collected! +${bounty.reward.toLocaleString()}g`,
          180,
        );
        this.game.displayMessage(
          `Bounty claimed! +${bounty.reward.toLocaleString()} gold for intercepting ${this.game.playerBySmallID(victimID).isPlayer() ? (this.game.playerBySmallID(victimID) as Player).displayName() : "unknown"}'s convoy.`,
          MessageType.CAPTURED_ENEMY_UNIT,
          interceptor.id(),
          bounty.reward,
        );
      }
      if (bounty.chargesLeft <= 0) {
        this.activeBounties.delete(victimID);
      }
      return;
    }

    const interceptsMap =
      this.convoyInterceptsBy.get(victimID) ?? new Map<number, number>();
    const count = (interceptsMap.get(interceptorID) ?? 0) + 1;
    interceptsMap.set(interceptorID, count);
    this.convoyInterceptsBy.set(victimID, interceptsMap);

    if (
      count >= this.tuning.bountyThreshold &&
      !this.activeBounties.has(victimID)
    ) {
      const expiresAt = ticks + this.tuning.bountyDurationTicks;
      this.activeBounties.set(victimID, {
        reward: this.tuning.bountyReward,
        chargesLeft: this.tuning.bountyCharges,
        expiresAtTick: expiresAt,
      });
      this.game.addUpdate({
        type: GameUpdateType.BountyBoardActivated,
        targetPlayerID: victimID,
        rewardGold: Number(this.tuning.bountyReward),
        chargesLeft: this.tuning.bountyCharges,
        expiresAtTick: expiresAt,
      });
      const target = this.game.playerBySmallID(victimID);
      const targetName = target.isPlayer() ? target.displayName() : "unknown";
      this.game.displayMessage(
        `BOUNTY BOARD: ${targetName} has a ${this.tuning.bountyReward.toLocaleString()} gold bounty! Intercept their next convoy to collect.`,
        MessageType.ATTACK_REQUEST,
        null,
      );
    }
  }

  // ── Warchest Hunt ────────────────────────────────────────────────────────

  private checkWarchestHunt(ticks: number): void {
    if (
      this.warchestHuntFired ||
      ticks < this.tuning.gameplay.warchest.triggerTick ||
      !this.game.config().vaultSitesEnabled()
    )
      return;
    if (ticks > this.tuning.gameplay.warchest.triggerTick) {
      this.warchestHuntFired = true;
      return;
    }

    this.warchestHuntFired = true;
    const players = this.game.players().filter((p) => p.isAlive());
    if (players.length < 2) return;

    const leader = players.reduce((best, p) =>
      p.gold() > best.gold() ? p : best,
    );
    this.warchestMarkPlayerID = leader.smallID();
    this.warchestHuntUntilTick = ticks + this.tuning.warchestHuntDurationTicks;

    this.game.addUpdate({
      type: GameUpdateType.WarchestHuntStarted,
      markPlayerID: leader.smallID(),
      durationTicks: this.tuning.warchestHuntDurationTicks,
      interceptMultiplier: Number(this.tuning.warchestHuntMultiplier),
    });
    this.game.displayMessage(
      `WARCHEST HUNT: ${leader.displayName()} is THE MARK! Convoys hitting their vaults carry 2× gold for the next 120 seconds.`,
      MessageType.ATTACK_REQUEST,
      null,
    );
  }

  // ── Map Events System ─────────────────────────────────────────────────────

  private tickMapEvents(ticks: number): void {
    if (!this.game.config().vaultSitesEnabled()) return;

    if (this.activeMapEvent !== null && ticks >= this.mapEventUntilTick) {
      this.game.addUpdate({
        type: GameUpdateType.MapEventExpired,
        eventType: this.activeMapEvent,
      });
      this.activeMapEvent = null;
      this.nextMapEventTick =
        ticks +
        this.tuning.mapEventMinIntervalTicks +
        this.random.nextInt(
          0,
          this.tuning.mapEventMaxIntervalTicks -
            this.tuning.mapEventMinIntervalTicks,
        );
    }

    if (this.activeMapEvent === null && ticks >= this.nextMapEventTick) {
      const idx = this.random.nextInt(0, this.tuning.mapEventPool.length - 1);
      const eventType = this.tuning.mapEventPool[idx];
      const duration =
        this.tuning.gameplay.mapEvents.durationBaseTicks +
        this.random.nextInt(
          0,
          this.tuning.gameplay.mapEvents.durationJitterTicks,
        );
      this.activeMapEvent = eventType;
      this.mapEventUntilTick = ticks + duration;

      this.game.addUpdate({
        type: GameUpdateType.MapEventFired,
        eventType,
        durationTicks: duration,
        startTick: ticks,
      });
      this.game.displayMessage(
        `MAP EVENT: ${this.mapEventLabel(eventType)} is active for ${Math.ceil(duration / 10)}s!`,
        MessageType.ATTACK_REQUEST,
        null,
      );
    }
  }

  private mapEventLabel(event: MapEventType): string {
    const labels: Record<MapEventType, string> = {
      vault_bonanza: "Vault Bonanza (2× site rewards)",
      supply_disruption: "Supply Disruption (convoy dispatch locked)",
      intelligence_breach: "Intelligence Breach (all routes visible)",
      gold_rush: "Gold Rush (3× next delivery, then site resets)",
      siege_protocol: "Siege Protocol (territory expansion blocked)",
      diplomatic_window: "Diplomatic Window (no combat damage)",
    };
    return labels[event] ?? event;
  }

  private isMapEventActive(eventType: MapEventType): boolean {
    return this.activeMapEvent === eventType;
  }

  // ── Match Intel Layer ─────────────────────────────────────────────────────

  private applyPurchaseIntelCommand(
    player: Player,
    ticks: number,
    deep: boolean,
  ): void {
    const cost = deep ? this.tuning.deepIntelCost : this.tuning.intelCost;
    if (player.gold() < cost) {
      this.game.displayMessage(
        `Intel requires ${cost.toLocaleString()} gold.`,
        MessageType.CHAT,
        player.id(),
      );
      return;
    }
    player.addGold(-cost);
    const untilTick = ticks + this.tuning.intelDurationTicks;
    if (deep) {
      this.deepIntelActiveUntilTick.set(player.smallID(), untilTick);
      this.intelActiveUntilTick.set(player.smallID(), untilTick);
    } else {
      this.intelActiveUntilTick.set(player.smallID(), untilTick);
    }
    const label = deep ? "Deep Intel" : "Intel";
    this.game.displayMessage(
      `${label} purchased — enemy convoy routes revealed for ${Math.ceil(this.tuning.intelDurationTicks / 10)}s.`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      player.id(),
    );
  }

  private applySellIntelCommand(player: Player, ticks: number): void {
    const sellerID = player.smallID();
    const hasIntel =
      (this.intelActiveUntilTick.get(sellerID) ?? 0) > ticks ||
      (this.deepIntelActiveUntilTick.get(sellerID) ?? 0) > ticks;

    if (!hasIntel) {
      this.game.displayMessage(
        "No active intel to sell — purchase Intel first.",
        MessageType.CHAT,
        player.id(),
      );
      return;
    }

    const buyers = this.game
      .players()
      .filter(
        (p) =>
          p.smallID() !== sellerID &&
          p.isAlive() &&
          p.isPlayer() &&
          (this.intelActiveUntilTick.get(p.smallID()) ?? 0) <= ticks,
      );

    if (buyers.length === 0) {
      this.game.displayMessage(
        "No buyers available — all players already have active intel.",
        MessageType.CHAT,
        player.id(),
      );
      return;
    }

    const hasDeep = (this.deepIntelActiveUntilTick.get(sellerID) ?? 0) > ticks;
    const halfDuration = Math.floor(
      this.tuning.intelDurationTicks /
        this.tuning.gameplay.intelligence.saleDurationDivisor,
    );
    const rewardPerBuyer =
      this.tuning.intelCost /
      BigInt(this.tuning.gameplay.intelligence.sellerRewardDivisor);
    const untilTick = ticks + halfDuration;

    for (const buyer of buyers) {
      if (hasDeep) {
        this.deepIntelActiveUntilTick.set(buyer.smallID(), untilTick);
      }
      this.intelActiveUntilTick.set(buyer.smallID(), untilTick);
      this.game.displayMessage(
        `${player.displayName()} sold you route intel — enemy convoys visible for ${Math.ceil(halfDuration / 10)}s.`,
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        buyer.id(),
      );
    }

    const earned = rewardPerBuyer * BigInt(buyers.length);
    player.addGold(earned);
    this.game.displayMessage(
      `Intel sold to ${buyers.length} player${buyers.length > 1 ? "s" : ""} — earned ${earned.toLocaleString()} gold.`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      player.id(),
    );
    const anchor = player.spawnTile() ?? this.game.ref(0, 0);
    this.emitActivity(
      "map_event",
      anchor,
      player.smallID(),
      null,
      "Intel Broadcast",
      60,
    );
  }

  // ── Economic Warfare ──────────────────────────────────────────────────────

  private applySabotageCommand(
    player: Player,
    command: VaultFrontCommand,
    ticks: number,
  ): void {
    const targetID = command.targetPlayerSmallID;
    if (targetID === undefined) return;
    if (player.gold() < this.tuning.sabotageCost) {
      this.game.displayMessage(
        `Sabotage requires ${this.tuning.sabotageCost.toLocaleString()} gold.`,
        MessageType.CHAT,
        player.id(),
      );
      return;
    }
    player.addGold(-this.tuning.sabotageCost);
    const charges =
      this.sabotageCharges.get(targetID) ?? new Map<number, number>();
    charges.set(
      player.smallID(),
      (charges.get(player.smallID()) ?? 0) + this.tuning.sabotageChargesPerUse,
    );
    this.sabotageCharges.set(targetID, charges);
    const target = this.game.playerBySmallID(targetID);
    const targetName = target.isPlayer() ? target.displayName() : "unknown";
    this.game.displayMessage(
      `Sabotage deployed against ${targetName}. Their next ${this.tuning.sabotageChargesPerUse} convoys pay a 15% gold toll.`,
      MessageType.ATTACK_REQUEST,
      player.id(),
    );
    this.game.displayMessage(
      `${player.displayName()} has sabotaged your convoy routes — next ${this.tuning.sabotageChargesPerUse} deliveries taxed 15%.`,
      MessageType.UNIT_CAPTURED_BY_ENEMY,
      target.isPlayer() ? target.id() : null,
    );
  }

  private applyBribeCommand(
    player: Player,
    command: VaultFrontCommand,
    ticks: number,
  ): void {
    const targetID = command.targetPlayerSmallID;
    if (targetID === undefined) return;
    if (
      player.gold() <
      this.tuning.bribeCost *
        BigInt(this.tuning.gameplay.economicWarfare.bribeBuyerCostMultiplier)
    ) {
      this.game.displayMessage(
        `Bribe requires ${(
          this.tuning.bribeCost *
          BigInt(this.tuning.gameplay.economicWarfare.bribeBuyerCostMultiplier)
        ).toLocaleString()} gold.`,
        MessageType.CHAT,
        player.id(),
      );
      return;
    }
    player.addGold(-this.tuning.bribeCost);
    const target = this.game.playerBySmallID(targetID);
    if (target.isPlayer() && target.isAlive()) {
      target.addGold(this.tuning.bribeCost);
      const currentDelay = this.dispatchDelayUntilTick.get(targetID) ?? 0;
      this.dispatchDelayUntilTick.set(
        targetID,
        Math.max(currentDelay, ticks + this.tuning.bribeDelayTicks),
      );
      this.game.displayMessage(
        `Bribe accepted. Your next convoy dispatch is delayed 60 seconds. (+${this.tuning.bribeCost.toLocaleString()}g received)`,
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        target.id(),
        this.tuning.bribeCost,
      );
      this.game.displayMessage(
        `Bribe sent to ${target.displayName()} — their dispatch delayed 60s.`,
        MessageType.CHAT,
        player.id(),
      );
    }
  }

  private applyTradeDealCommand(
    player: Player,
    command: VaultFrontCommand,
    _ticks: number,
  ): void {
    const targetID = command.targetPlayerSmallID;
    if (targetID === undefined) return;
    const target = this.game.playerBySmallID(targetID);
    if (!target.isPlayer()) return;
    this.tradeDealNextConvoy.set(player.smallID(), targetID);
    this.game.displayMessage(
      `Trade deal offered to ${target.displayName()} — 8% of your next convoy delivery shared.`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      player.id(),
    );
  }

  private updateComebackState(ticks: number): void {
    const players = this.game.players().filter((player) => player.isAlive());
    if (players.length <= 1) return;

    const avgStrength =
      players.reduce(
        (acc, player) => acc + this.playerStrengthScore(player),
        0,
      ) / players.length;
    if (avgStrength <= 0) return;

    const minute8Tick =
      this.game.config().numSpawnPhaseTurns() +
      this.tuning.gameplay.comeback.minute8Tick;

    for (const player of players) {
      const playerID = player.smallID();
      const ratio = this.playerStrengthScore(player) / avgStrength;
      const behind = ratio < this.tuning.surgeBehindThresholdRatio;
      const started = this.behindSinceTick.get(playerID) ?? -1;
      const surgeUntil = this.surgeUntilTick.get(playerID) ?? 0;

      if (behind) {
        if (started < 0) {
          this.behindSinceTick.set(playerID, ticks);
        } else if (
          ticks - started >= this.tuning.surgeActivationHoldTicks &&
          ticks >= surgeUntil
        ) {
          const nextSurgeUntil = ticks + this.tuning.surgeDurationTicks;
          this.surgeUntilTick.set(playerID, nextSurgeUntil);
          this.behindSinceTick.set(playerID, ticks);
          const anchor = player.spawnTile();
          if (anchor !== undefined) {
            this.emitActivity(
              "comeback_surge",
              anchor,
              playerID,
              null,
              "Comeback surge active",
              140,
            );
          }
          this.game.stats().comebackSurgeActivated(player);
          this.game.displayMessage(
            "Comeback Surge active: extra bonus on vault recapture and convoy interceptions.",
            MessageType.CHAT,
            player.id(),
          );
        }
      } else {
        this.behindSinceTick.set(playerID, -1);
      }

      if (
        ticks >= minute8Tick &&
        !this.minute8BehindMarked.has(playerID) &&
        behind
      ) {
        this.minute8BehindMarked.add(playerID);
        this.game.stats().minute8Behind(player);
      }
    }
  }

  private playerStrengthScore(player: Player): number {
    const tiles = Math.max(1, player.numTilesOwned());
    const troops = Math.max(1, player.troops());
    const gold = Math.max(1, Number(player.gold()));
    return (
      tiles * this.tuning.gameplay.comeback.strengthTileWeight +
      troops * this.tuning.gameplay.comeback.strengthTroopWeight +
      Math.sqrt(gold) * this.tuning.gameplay.comeback.strengthGoldWeight
    );
  }

  private tickVaultSites(ticks: number): void {
    for (const site of this.vaultSites) {
      this.syncPassiveOwner(site);
      this.tickVaultPassiveIncome(site, ticks);

      if (site.cooldownTicks > 0) {
        site.cooldownTicks--;
        const reopenWindowTicks = Math.min(
          this.tuning.gameplay.vault.reopenWindowMaxTicks,
          Math.floor(
            this.mutatorBalance.vaultCooldownTicks *
              this.tuning.gameplay.vault.reopenWindowMultiplier,
          ),
        );
        if (site.cooldownTicks <= reopenWindowTicks) {
          const challenger = this.game.owner(site.tile);
          if (
            challenger.isPlayer() &&
            site.passiveOwnerID !== null &&
            challenger.smallID() !== site.passiveOwnerID
          ) {
            site.cooldownTicks = 0;
            site.reducedRewardNextCapture = true;
          }
        }
        if (site.cooldownTicks > 0) {
          continue;
        }
      }

      const owner = this.game.owner(site.tile);
      if (!owner.isPlayer()) {
        site.controllerID = null;
        // Contested mutator: capture progress decays when no one holds the tile
        if (this.weeklyMutator === "contested" && site.controlTicks > 0) {
          site.controlTicks = Math.max(0, site.controlTicks - 1);
        } else {
          site.controlTicks = 0;
        }
        // Track vacancy for the "Vacant Vault" bonus mechanic
        if (site.passiveOwnerID === null) {
          if (site.uncontrolledSinceTick === 0) {
            site.uncontrolledSinceTick = ticks;
          }
          const vacantTicks = ticks - site.uncontrolledSinceTick;
          if (
            vacantTicks >= this.tuning.gameplay.vault.vacantWarningTicks &&
            site.vacantAlertFiredAtTick < site.uncontrolledSinceTick
          ) {
            site.vacantAlertFiredAtTick = ticks;
            site.reducedRewardNextCapture = false;
            this.game.displayMessage(
              `Vault ${site.id} is unclaimed — next capture pays double rewards!`,
              MessageType.ATTACK_REQUEST,
              null,
            );
          }
        } else {
          site.uncontrolledSinceTick = 0;
        }
        continue;
      }
      site.uncontrolledSinceTick = 0;

      if (site.controllerID !== owner.smallID()) {
        site.controllerID = owner.smallID();
        site.controlTicks = 1;
      } else {
        site.controlTicks++;
      }

      if (site.controlTicks < this.mutatorBalance.vaultCaptureTicks) {
        continue;
      }

      this.emitActivity(
        "vault_captured",
        site.tile,
        owner.smallID(),
        null,
        `Vault ${site.id} captured`,
        150,
      );
      this.game.stats().vaultCaptured(owner, this.game.ticks());
      this.game.stats().vaultInteraction(owner);
      this.applyCaptureSurgeBonus(owner, site);
      if (this.weeklyMutator === "rally_point") {
        owner.addTroops(this.tuning.gameplay.vault.rallyPointTroops);
        this.game.displayMessage(
          "Rally Point: +1,200 troops from vault capture.",
          MessageType.RECEIVED_GOLD_FROM_TRADE,
          owner.id(),
        );
      }
      this.updateExecutionChainCapture(owner, ticks);
      this.openSquadObjectiveWindow(owner, site, ticks);
      this.updateChainGuardian(owner, site.tile, ticks);

      const vacantBonus =
        site.vacantAlertFiredAtTick > 0 &&
        site.vacantAlertFiredAtTick >= site.uncontrolledSinceTick
          ? this.tuning.gameplay.vault.vacantCaptureMultiplier
          : 1;
      this.startConvoy(
        owner,
        site,
        ticks,
        site.reducedRewardNextCapture
          ? this.tuning.gameplay.vault.reducedCaptureMultiplier
          : vacantBonus,
      );
      site.controllerID = null;
      site.controlTicks = 0;
      site.cooldownTicks = this.mutatorBalance.vaultCooldownTicks;
      // Reset previous owner's chain if site changes hands
      if (
        site.passiveOwnerID !== null &&
        site.passiveOwnerID !== owner.smallID()
      ) {
        this.consecutiveVaultCaptures.set(site.passiveOwnerID, 0);
      }
      site.passiveOwnerID = owner.smallID();
      site.nextPassiveGoldTick =
        ticks + this.mutatorBalance.vaultPassiveIncomeIntervalTicks;
      site.reducedRewardNextCapture = false;
      site.uncontrolledSinceTick = 0;
      site.vacantAlertFiredAtTick = -1;
    }
    this.checkLastStand(ticks);
  }

  private checkLastStand(ticks: number): void {
    const sitesPerPlayer = new Map<number, number>();
    for (const site of this.vaultSites) {
      if (site.passiveOwnerID !== null) {
        sitesPerPlayer.set(
          site.passiveOwnerID,
          (sitesPerPlayer.get(site.passiveOwnerID) ?? 0) + 1,
        );
      }
    }
    for (const [playerID, count] of sitesPerPlayer.entries()) {
      if (
        count >= this.tuning.lastStandSiteThreshold &&
        !this.lastStandTriggeredBy.has(playerID)
      ) {
        this.lastStandTriggeredBy.add(playerID);
        const bonusEnd = ticks + this.tuning.lastStandBonusDurationTicks;
        for (const opponent of this.game.players()) {
          if (opponent.smallID() !== playerID) {
            this.lastStandBonusUntilTick.set(opponent.smallID(), bonusEnd);
          }
        }
        const triggerPlayer = this.game.playerBySmallID(playerID);
        const name = triggerPlayer.isPlayer()
          ? triggerPlayer.name()
          : "A player";
        this.game.displayMessage(
          `LAST STAND! ${name} controls ${count} vault sites. All opponents gain +40% convoy gold for 90s!`,
          MessageType.ATTACK_REQUEST,
          null,
        );
        this.game.addUpdate({
          type: GameUpdateType.LastStandActivated,
          triggerPlayerID: playerID,
          siteCount: count,
          bonusDurationTicks: this.tuning.lastStandBonusDurationTicks,
          opponentGoldMultiplier: this.tuning.lastStandOpponentGoldMultiplier,
        });
      }
    }
    // Clean up expired last-stand entries so re-triggering is possible next game
    for (const [pid, until] of this.lastStandBonusUntilTick.entries()) {
      if (until <= ticks) {
        this.lastStandBonusUntilTick.delete(pid);
      }
    }
  }

  private syncPassiveOwner(site: VaultSite): void {
    if (site.passiveOwnerID === null) {
      return;
    }
    const owner = this.game.playerBySmallID(site.passiveOwnerID);
    const tileOwner = this.game.owner(site.tile);
    if (
      !owner.isPlayer() ||
      !owner.isAlive() ||
      !tileOwner.isPlayer() ||
      tileOwner.smallID() !== site.passiveOwnerID
    ) {
      site.passiveOwnerID = null;
      site.nextPassiveGoldTick = 0;
      site.reducedRewardNextCapture = false;
    }
  }

  private tickVaultPassiveIncome(site: VaultSite, ticks: number): void {
    if (site.passiveOwnerID === null || ticks < site.nextPassiveGoldTick) {
      return;
    }
    const owner = this.game.playerBySmallID(site.passiveOwnerID);
    if (!owner.isPlayer() || !owner.isAlive()) {
      site.passiveOwnerID = null;
      site.nextPassiveGoldTick = 0;
      return;
    }

    const passiveGold = this.mutatorBalance.vaultPassiveGoldPerMinute;
    owner.addGold(passiveGold, site.tile);
    site.accumulatedPassiveGold += passiveGold;
    this.game.stats().vaultPassiveGold(owner, passiveGold);
    this.game.displayMessage(
      `Vault ${site.id} generated +${passiveGold.toLocaleString()} gold passive income.`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      owner.id(),
      passiveGold,
    );
    this.emitActivity(
      "vault_passive_income",
      site.tile,
      owner.smallID(),
      null,
      `Vault ${site.id} passive +${this.bigintToSafeNumber(passiveGold).toLocaleString()}g`,
      120,
    );
    site.nextPassiveGoldTick =
      ticks + this.mutatorBalance.vaultPassiveIncomeIntervalTicks;
  }

  private hasSurgeActive(player: Player): boolean {
    return (this.surgeUntilTick.get(player.smallID()) ?? 0) > this.game.ticks();
  }

  private applyCaptureSurgeBonus(player: Player, site: VaultSite): void {
    if (!this.hasSurgeActive(player)) {
      return;
    }
    player.addGold(this.tuning.surgeCaptureGoldBonus, site.tile);
    this.game.displayMessage(
      `Comeback Surge bonus: +${this.tuning.surgeCaptureGoldBonus} gold from vault recapture.`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      player.id(),
      this.tuning.surgeCaptureGoldBonus,
    );
  }

  private applyInterceptSurgeBonus(interceptor: Player, tile: TileRef): void {
    if (!this.hasSurgeActive(interceptor)) {
      return;
    }
    const bonus = BigInt(
      Math.floor(
        this.tuning.gameplay.comeback.interceptBaseGold *
          this.tuning.surgeInterceptGoldMultiplier,
      ),
    );
    interceptor.addGold(bonus, tile);
    interceptor.addTroops(this.tuning.gameplay.comeback.interceptTroops);
    this.game.displayMessage(
      "Comeback Surge bonus: interception reward amplified.",
      MessageType.CHAT,
      interceptor.id(),
    );
  }

  private laneFogActivitySuppressed(
    activity:
      | "vault_captured"
      | "vault_passive_income"
      | "convoy_launched"
      | "convoy_rerouted"
      | "convoy_escorted"
      | "convoy_intercepted"
      | "convoy_delivered"
      | "beacon_pulse"
      | "jam_breaker"
      | "comeback_surge"
      | "ghost_reveal"
      | "heist_executed"
      | "bounty_collected"
      | "map_event"
      | "chain_guardian_earned"
      | "breach_window_opened"
      | "vault_breach_victory",
  ): boolean {
    return (
      this.weeklyMutator === "lane_fog" &&
      (activity === "convoy_launched" ||
        activity === "convoy_rerouted" ||
        activity === "convoy_escorted")
    );
  }

  private resetExecutionChain(playerID: number): void {
    this.executionChainStep.set(playerID, 0);
    this.executionChainExpiresAtTick.set(playerID, 0);
  }

  private updateExecutionChainCapture(player: Player, ticks: number): void {
    const playerID = player.smallID();
    this.executionChainStep.set(playerID, 1);
    this.executionChainExpiresAtTick.set(
      playerID,
      ticks + this.mutatorBalance.executionChainWindowTicks,
    );
  }

  private updateExecutionChainConvoyDelivered(
    player: Player,
    ticks: number,
  ): void {
    const playerID = player.smallID();
    const step = this.executionChainStep.get(playerID) ?? 0;
    const expiresAt = this.executionChainExpiresAtTick.get(playerID) ?? 0;
    if (step !== 1 || ticks > expiresAt) {
      this.resetExecutionChain(playerID);
      return;
    }
    this.executionChainStep.set(playerID, 2);
    this.executionChainExpiresAtTick.set(
      playerID,
      ticks + this.mutatorBalance.executionChainWindowTicks,
    );
  }

  private updateExecutionChainPulseDeny(
    player: Player,
    ticks: number,
    deniedPulse: boolean,
  ): void {
    const playerID = player.smallID();
    if (!deniedPulse) return;
    const step = this.executionChainStep.get(playerID) ?? 0;
    const expiresAt = this.executionChainExpiresAtTick.get(playerID) ?? 0;
    if (step !== 2 || ticks > expiresAt) {
      this.resetExecutionChain(playerID);
      return;
    }
    const streakMultiplier =
      this.weeklyMutator === "execution_rush"
        ? this.tuning.gameplay.rewardDynamics.executionRushRewardMultiplier
        : this.tuning.cleanExecutionStreakConvoyMultiplier;
    this.executionStreakNextConvoyMultiplier.set(playerID, streakMultiplier);
    this.game.stats().cleanExecutionStreak(player);
    this.resetExecutionChain(playerID);
    this.game.displayMessage(
      `Clean execution chain complete. Next Vault Convoy rewards +${Math.round((streakMultiplier - 1) * 100)}%.`,
      MessageType.CHAT,
      player.id(),
    );
  }

  private updateChainGuardian(
    player: Player,
    tile: TileRef,
    ticks: number,
  ): void {
    const pid = player.smallID();
    const prev = this.consecutiveVaultCaptures.get(pid) ?? 0;
    const next = prev + 1;
    this.consecutiveVaultCaptures.set(pid, next);
    if (next === this.tuning.chainGuardianThreshold) {
      this.consecutiveVaultCaptures.set(pid, 0);
      this.emitActivity(
        "chain_guardian_earned",
        tile,
        pid,
        null,
        "Chain Guardian — 3 vault captures in a row!",
        ticks,
      );
    }
  }

  private sweepExpiredSquadObjectives(ticks: number): void {
    this.squadObjectiveWindows = this.squadObjectiveWindows.filter(
      (window) => window.expiresAtTick > ticks && !window.rewarded,
    );
  }

  private openSquadObjectiveWindow(
    owner: Player,
    site: VaultSite,
    ticks: number,
  ): void {
    this.squadObjectiveWindows.push({
      siteID: site.id,
      ownerID: owner.smallID(),
      anchorTile: site.tile,
      expiresAtTick: ticks + this.tuning.squadObjectiveWindowTicks,
      participants: new Set([owner.smallID()]),
      rewarded: false,
    });
  }

  private contributeToSquadObjective(
    actor: Player,
    ticks: number,
    tile: TileRef,
  ): void {
    this.sweepExpiredSquadObjectives(ticks);
    for (const window of this.squadObjectiveWindows) {
      if (window.rewarded || ticks > window.expiresAtTick) continue;
      const owner = this.game.playerBySmallID(window.ownerID);
      if (!owner.isPlayer() || !owner.isAlive()) continue;
      if (owner.smallID() !== actor.smallID() && !owner.isFriendly(actor))
        continue;
      if (
        this.game.manhattanDist(tile, window.anchorTile) >
        this.tuning.squadObjectiveRadius
      ) {
        continue;
      }
      window.participants.add(actor.smallID());
      if (window.participants.size < 2) continue;
      window.rewarded = true;
      for (const participantID of window.participants) {
        const participant = this.game.playerBySmallID(participantID);
        if (!participant.isPlayer() || !participant.isAlive()) continue;
        participant.addGold(
          this.tuning.squadObjectiveGoldBonus,
          window.anchorTile,
        );
        participant.addTroops(this.tuning.squadObjectiveTroopsBonus);
        this.game.stats().squadObjectiveCompleted(participant);
        this.game.displayMessage(
          "Squad objective complete: coordinated Vault window bonus awarded.",
          MessageType.CHAT,
          participant.id(),
          this.tuning.squadObjectiveGoldBonus,
        );
      }
    }
  }

  private strengthAdjustmentMultiplier(player: Player): number {
    const alive = this.game.players().filter((p) => p.isAlive());
    if (alive.length === 0) return 1;
    const avgStrength =
      alive.reduce((acc, p) => acc + this.playerStrengthScore(p), 0) /
      alive.length;
    if (avgStrength <= 0.01) return 1;
    const ratio = this.playerStrengthScore(player) / avgStrength;
    return Math.max(
      this.tuning.gameplay.rewardDynamics.minimumStrengthMultiplier,
      Math.min(
        this.tuning.gameplay.rewardDynamics.maximumStrengthMultiplier,
        this.tuning.gameplay.rewardDynamics.strengthIntercept -
          (ratio - 1) * this.tuning.gameplay.rewardDynamics.strengthSlope,
      ),
    );
  }

  private phaseAdjustmentMultiplier(ticks: number): number {
    const elapsedAfterSpawn = Math.max(
      0,
      ticks - this.game.config().numSpawnPhaseTurns(),
    );
    if (elapsedAfterSpawn < this.tuning.gameplay.rewardDynamics.earlyPhaseTicks)
      return this.tuning.gameplay.rewardDynamics.earlyPhaseMultiplier;
    if (elapsedAfterSpawn < this.tuning.gameplay.rewardDynamics.latePhaseTicks)
      return this.tuning.gameplay.rewardDynamics.middlePhaseMultiplier;
    return this.tuning.gameplay.rewardDynamics.latePhaseMultiplier;
  }

  private routeRiskScore(
    owner: Player,
    source: TileRef,
    destination: TileRef,
  ): number {
    const srcX = this.game.x(source);
    const srcY = this.game.y(source);
    const dstX = this.game.x(destination);
    const dstY = this.game.y(destination);

    let hostileSamples = 0;
    const samples = this.tuning.gameplay.rewardDynamics.routeRiskSamples;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = Math.round(srcX + (dstX - srcX) * t);
      const y = Math.round(srcY + (dstY - srcY) * t);
      if (!this.game.isValidCoord(x, y)) continue;
      const tileOwner = this.game.owner(this.game.ref(x, y));
      if (
        tileOwner.isPlayer() &&
        tileOwner.smallID() !== owner.smallID() &&
        !owner.isFriendly(tileOwner)
      ) {
        hostileSamples++;
      }
    }
    const baseRisk = hostileSamples / samples;
    if (this.weeklyMutator === "lane_fog") {
      return Math.min(
        1,
        baseRisk + this.tuning.gameplay.rewardDynamics.laneFogRiskBonus,
      );
    }
    return baseRisk;
  }

  /**
   * Estimates intercept probability (0–100) by sampling the corridor between
   * source and destination at fine intervals and checking hostile territory
   * presence within a ±2-tile corridor width around each sample point.
   *
   * More accurate than `routeRisk` which only checks on-route tiles; this
   * catches adjacent enemy territory that could easily overflow the path.
   */
  private computeInterceptProbability(
    owner: Player,
    source: TileRef,
    destination: TileRef,
  ): number {
    const srcX = this.game.x(source);
    const srcY = this.game.y(source);
    const dstX = this.game.x(destination);
    const dstY = this.game.y(destination);

    const samples = this.tuning.gameplay.rewardDynamics.corridorRiskSamples;
    const corridorHalfWidth =
      this.tuning.gameplay.rewardDynamics.corridorHalfWidth;
    let hostileWeight = 0;
    let totalWeight = 0;

    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const cx = Math.round(srcX + (dstX - srcX) * t);
      const cy = Math.round(srcY + (dstY - srcY) * t);

      for (let dx = -corridorHalfWidth; dx <= corridorHalfWidth; dx++) {
        for (let dy = -corridorHalfWidth; dy <= corridorHalfWidth; dy++) {
          const x = cx + dx;
          const y = cy + dy;
          if (!this.game.isValidCoord(x, y)) continue;
          // Weight center tiles more heavily
          const w = 1 / (1 + Math.abs(dx) + Math.abs(dy));
          totalWeight += w;
          const tileOwner = this.game.owner(this.game.ref(x, y));
          if (
            tileOwner.isPlayer() &&
            tileOwner.smallID() !== owner.smallID() &&
            !owner.isFriendly(tileOwner)
          ) {
            hostileWeight += w;
          }
        }
      }
    }

    if (totalWeight === 0) return 0;
    const raw = hostileWeight / totalWeight;
    return Math.round(Math.min(100, raw * 100));
  }

  private convoyRewardPlan(
    owner: Player,
    distance: number,
    routeRisk: number,
    ticks: number,
    rewardScale: number,
  ): ConvoyRewardPlan {
    const tuning = this.game.config().vaultConvoyRewardTuning();
    const strengthMultiplier = this.strengthAdjustmentMultiplier(owner);
    const phaseMultiplier = this.phaseAdjustmentMultiplier(ticks);
    const alive = this.game.players().filter((p) => p.isAlive());
    const avgStrength =
      alive.length > 0
        ? alive.reduce((acc, p) => acc + this.playerStrengthScore(p), 0) /
          alive.length
        : this.playerStrengthScore(owner);
    const ownerStrength = this.playerStrengthScore(owner);
    return planConvoyReward(
      {
        ownerStrength,
        averageStrength: avgStrength,
        distance,
        routeRisk,
        rewardScale,
        strengthMultiplier,
        phaseMultiplier,
      },
      tuning,
    );
  }

  private startConvoy(
    owner: Player,
    site: VaultSite,
    ticks: number,
    rewardScale: number,
  ): void {
    const streakMultiplier =
      this.executionStreakNextConvoyMultiplier.get(owner.smallID()) ?? 1;
    const lastStandBonus =
      (this.lastStandBonusUntilTick.get(owner.smallID()) ?? 0) > ticks
        ? this.tuning.lastStandOpponentGoldMultiplier
        : 1;
    const goldRushBonus =
      this.weeklyMutator === "gold_rush"
        ? this.tuning.gameplay.rewardDynamics.goldRushRewardMultiplier
        : 1;
    const finalRewardScale =
      rewardScale * streakMultiplier * lastStandBonus * goldRushBonus;
    this.executionStreakNextConvoyMultiplier.set(owner.smallID(), 1);
    const preferred = this.preferredConvoyDestination.get(owner.smallID());
    const destinationTile = this.bestConvoyDestination(
      owner,
      site.tile,
      preferred,
    );
    const distance = this.game.manhattanDist(site.tile, destinationTile);
    const travelTicks = Math.max(
      this.tuning.gameplay.rewardDynamics.travelMinTicks,
      Math.min(
        this.tuning.gameplay.rewardDynamics.travelMaxTicks,
        Math.floor(
          distance / this.tuning.gameplay.rewardDynamics.travelDistanceDivisor,
        ),
      ),
    );
    const routeRisk = this.routeRiskScore(owner, site.tile, destinationTile);
    const rewardPlan = this.convoyRewardPlan(
      owner,
      distance,
      routeRisk,
      ticks,
      finalRewardScale,
    );
    let escorted =
      (this.escortUntilTick.get(owner.smallID()) ?? 0) > ticks ? 1 : 0;
    if (this.weeklyMutator === "shield_escort") {
      escorted = Math.max(
        escorted,
        this.tuning.gameplay.rewardDynamics.shieldEscortStrength,
      );
    } else if (this.weeklyMutator === "no_mercy") {
      escorted = 0;
    }

    this.convoys.push({
      id: this.nextConvoyID++,
      ownerID: owner.smallID(),
      sourceTile: site.tile,
      destinationTile,
      ticksRemaining: travelTicks,
      totalTicks: travelTicks,
      goldReward: rewardPlan.goldReward,
      troopsReward: rewardPlan.troopsReward,
      rewardMultiplier: rewardPlan.rewardMultiplier,
      rewardScale: rewardPlan.rewardScale,
      strengthMultiplier: rewardPlan.strengthMultiplier,
      phaseMultiplier: rewardPlan.phaseMultiplier,
      riskMultiplier: rewardPlan.riskMultiplier,
      routeRisk,
      routeDistance: distance,
      rewardMath: rewardPlan.rewardMath,
      escortShield: escorted,
      reroutes: 0,
      interceptProbability: this.computeInterceptProbability(
        owner,
        site.tile,
        destinationTile,
      ),
      ghostConvoy: false,
    });
    this.game.stats().vaultConvoyLaunched(owner);
    this.game.stats().vaultInteraction(owner);

    this.game.displayMessage(
      `Vault site ${site.id} breached. Extraction Vault Convoy launched.`,
      MessageType.ATTACK_REQUEST,
      null,
    );
    this.game.displayMessage(
      `Your Vault Convoy departs. ETA ${Math.ceil(travelTicks / 10)}s.`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      owner.id(),
      rewardPlan.goldReward,
    );
    if (streakMultiplier > 1) {
      this.game.displayMessage(
        `Execution streak bonus applied (+${Math.round((streakMultiplier - 1) * 100)}% convoy rewards).`,
        MessageType.CHAT,
        owner.id(),
      );
    }

    this.emitActivity(
      "convoy_launched",
      site.tile,
      owner.smallID(),
      null,
      `Vault Convoy launched from vault ${site.id}`,
      130,
    );
    this.debugVault("start_convoy", {
      convoyID: this.nextConvoyID - 1,
      ownerID: owner.smallID(),
      siteID: site.id,
      sourceTile: site.tile,
      destinationTile,
      etaSeconds: Math.ceil(travelTicks / 10),
      routeRisk,
      routeDistance: distance,
      rewardGold: this.bigintToSafeNumber(rewardPlan.goldReward),
      rewardTroops: rewardPlan.troopsReward,
      rewardScale: rewardPlan.rewardScale,
    });
  }

  private bestConvoyDestination(
    owner: Player,
    sourceTile: TileRef,
    preferredType?: UnitType,
    commandHint?:
      | "reroute_city"
      | "reroute_port"
      | "reroute_factory"
      | "reroute_silo"
      | "reroute_safest",
  ): TileRef {
    const allStructures = owner.units(
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
      UnitType.MissileSilo,
    );
    if (allStructures.length === 0) {
      return owner.spawnTile() ?? sourceTile;
    }

    const preferredStructures =
      preferredType === undefined
        ? allStructures
        : allStructures.filter(
            (structure) => structure.type() === preferredType,
          );
    const structures =
      preferredStructures.length > 0 ? preferredStructures : allStructures;

    if (commandHint === "reroute_safest") {
      let safest = structures[0].tile();
      let safestRisk = Number.POSITIVE_INFINITY;
      let safestDistance = Number.POSITIVE_INFINITY;
      for (const structure of structures) {
        const tile = structure.tile();
        const risk = this.routeRiskScore(owner, sourceTile, tile);
        const dist = this.game.manhattanDist(sourceTile, tile);
        if (
          risk < safestRisk ||
          (Math.abs(risk - safestRisk) < 0.0001 && dist < safestDistance)
        ) {
          safest = tile;
          safestRisk = risk;
          safestDistance = dist;
        }
      }
      return safest;
    }

    let best = structures[0].tile();
    let bestDist = this.game.manhattanDist(best, sourceTile);
    for (const structure of structures) {
      const d = this.game.manhattanDist(sourceTile, structure.tile());
      if (d < bestDist) {
        best = structure.tile();
        bestDist = d;
      }
    }
    return best;
  }

  private tickConvoys(ticks: number): void {
    const remaining: VaultConvoy[] = [];

    for (const convoy of this.convoys) {
      const owner = this.game.playerBySmallID(convoy.ownerID);
      if (!owner.isPlayer() || !owner.isAlive()) {
        continue;
      }

      const currentTile = this.convoyProgressTile(convoy);

      // Refresh intercept probability every 30 ticks so the gauge stays live
      if (
        ticks %
          this.tuning.gameplay.rewardDynamics.interceptRiskRefreshTicks ===
        0
      ) {
        convoy.interceptProbability = this.computeInterceptProbability(
          owner,
          currentTile,
          convoy.destinationTile,
        );
      }

      const interceptor = this.hostileOwnerAtTile(owner, currentTile);
      if (interceptor) {
        const escortActive =
          (this.escortUntilTick.get(owner.smallID()) ?? 0) > ticks;
        if (escortActive && convoy.escortShield > 0) {
          convoy.escortShield -= 1;
          this.game.displayMessage(
            "Vault Convoy escort evaded an intercept attempt.",
            MessageType.CHAT,
            owner.id(),
          );
          this.game.displayMessage(
            `${owner.displayName()}'s Vault Convoy escaped with escort support.`,
            MessageType.ATTACK_REQUEST,
            interceptor.id(),
          );
          remaining.push(convoy);
          continue;
        }

        let gold =
          convoy.goldReward /
          BigInt(this.tuning.gameplay.rewardDynamics.convoyInterceptDivisor);
        const troops = Math.floor(
          convoy.troopsReward /
            this.tuning.gameplay.rewardDynamics.convoyInterceptDivisor,
        );

        // Warchest Hunt: 2× intercept gold when targeting the mark's convoys
        if (
          this.warchestMarkPlayerID === owner.smallID() &&
          ticks <= this.warchestHuntUntilTick
        ) {
          gold *= this.tuning.warchestHuntMultiplier;
        }

        interceptor.addGold(gold, currentTile);
        interceptor.addTroops(troops);
        this.applyInterceptSurgeBonus(interceptor, currentTile);
        this.game.stats().vaultConvoyIntercepted(interceptor);
        this.game.stats().vaultConvoyLost(owner, this.game.ticks());
        this.game.stats().vaultInteraction(interceptor);
        this.resetExecutionChain(owner.smallID());
        this.contributeToSquadObjective(interceptor, ticks, currentTile);

        // Bounty Board tracking
        this.trackConvoyIntercept(
          interceptor.smallID(),
          owner.smallID(),
          ticks,
        );

        // Sabotage charges on interceptor's convoys (track owner perspective)
        const ownerSabotageCharges =
          this.sabotageCharges.get(owner.smallID()) ?? new Map();
        for (const [saboteurID, charges] of ownerSabotageCharges) {
          if (charges > 0) {
            const toll =
              gold / BigInt(Math.round(1 / this.tuning.sabotageTollFraction));
            owner.addGold(-toll < 0n ? 0n : -toll);
            ownerSabotageCharges.set(saboteurID, Math.max(0, charges - 1));
          }
        }

        this.game.displayMessage(
          `You captured a Vault Convoy in transit from ${owner.displayName()} (+${gold.toLocaleString()} gold, +${troops.toLocaleString()} troops).`,
          MessageType.CAPTURED_ENEMY_UNIT,
          interceptor.id(),
          gold,
        );
        this.game.displayMessage(
          `${interceptor.displayName()} captured your Vault Convoy (enemy gained +${gold.toLocaleString()} gold, +${troops.toLocaleString()} troops).`,
          MessageType.UNIT_CAPTURED_BY_ENEMY,
          owner.id(),
        );

        this.emitActivity(
          "convoy_intercepted",
          currentTile,
          interceptor.smallID(),
          owner.smallID(),
          `Convoy intercepted +${gold.toLocaleString()}g +${troops.toLocaleString()}t`,
          150,
        );
        continue;
      }

      convoy.ticksRemaining--;
      if (convoy.ticksRemaining > 0) {
        remaining.push(convoy);
        continue;
      }

      // Heist: resolve before standard delivery gold
      this.resolveHeistOnArrival(convoy, convoy.destinationTile, ticks);

      // Sabotage toll on delivery
      const deliverySabotageCharges =
        this.sabotageCharges.get(owner.smallID()) ?? new Map();
      let goldAfterSabotage = convoy.goldReward;
      for (const [, charges] of deliverySabotageCharges) {
        if (charges > 0) {
          const toll = BigInt(
            Math.floor(
              Number(convoy.goldReward) * this.tuning.sabotageTollFraction,
            ),
          );
          goldAfterSabotage =
            goldAfterSabotage > toll ? goldAfterSabotage - toll : 0n;
          for (const [sid, sc] of deliverySabotageCharges) {
            deliverySabotageCharges.set(sid, Math.max(0, sc - 1));
          }
          break;
        }
      }

      // Trade deal: share fraction with a target player
      const tradeDealTarget = this.tradeDealNextConvoy.get(owner.smallID());
      if (tradeDealTarget !== undefined) {
        this.tradeDealNextConvoy.delete(owner.smallID());
        const shareGold = BigInt(
          Math.floor(
            Number(goldAfterSabotage) * this.tuning.tradeDealShareFraction,
          ),
        );
        const tradeTarget = this.game.playerBySmallID(tradeDealTarget);
        if (tradeTarget.isPlayer() && tradeTarget.isAlive()) {
          tradeTarget.addGold(shareGold);
          this.game.displayMessage(
            `Trade deal: ${shareGold.toLocaleString()} gold shared with ${tradeTarget.displayName()}.`,
            MessageType.RECEIVED_GOLD_FROM_TRADE,
            owner.id(),
          );
        }
      }

      owner.addGold(goldAfterSabotage, convoy.destinationTile);
      owner.addTroops(convoy.troopsReward);
      this.game.stats().vaultConvoyDelivered(owner, this.game.ticks());
      this.game.stats().vaultInteraction(owner);
      this.updateExecutionChainConvoyDelivered(owner, ticks);
      this.contributeToSquadObjective(owner, ticks, convoy.destinationTile);
      this.advanceVaultPressure(owner, ticks, convoy.destinationTile);

      this.game.displayMessage(
        `Vault Convoy delivered (+${convoy.goldReward.toLocaleString()} gold, +${convoy.troopsReward.toLocaleString()} troops).`,
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        owner.id(),
        convoy.goldReward,
      );

      this.emitActivity(
        "convoy_delivered",
        convoy.destinationTile,
        owner.smallID(),
        null,
        `Convoy delivered +${convoy.goldReward.toLocaleString()}g +${convoy.troopsReward.toLocaleString()}t`,
        130,
      );

      if (convoy.ghostConvoy) {
        this.emitActivity(
          "ghost_reveal",
          convoy.destinationTile,
          owner.smallID(),
          null,
          `Ghost convoy revealed! +${convoy.goldReward.toLocaleString()}g`,
          160,
        );
      }
    }

    this.convoys = remaining;
  }

  private tickCountersurveillance(ticks: number): void {
    for (const player of this.game.players()) {
      const playerID = player.smallID();
      const factoryCount = player.unitCount(UnitType.Factory);
      const cityCount = player.unitCount(UnitType.City);

      let state = this.beacons.get(playerID);
      if (!state) {
        state = {
          charge: 0,
          cooldownUntil: 0,
          maskedUntil: 0,
        };
        this.beacons.set(playerID, state);
      }

      const chargeGain =
        this.tuning.gameplay.defense.baseChargeGain +
        factoryCount * this.tuning.gameplay.defense.factoryChargeGain +
        cityCount * this.tuning.gameplay.defense.cityChargeGain;
      state.charge = Math.min(
        this.tuning.beaconChargeCap,
        state.charge + chargeGain,
      );

      if (factoryCount <= 0 || !player.isAlive()) {
        continue;
      }
      if (ticks < state.cooldownUntil) {
        continue;
      }
      if (state.charge < this.tuning.beaconTriggerCost) {
        continue;
      }

      const anchorTile = this.pickBeaconAnchorTile(player);
      if (anchorTile === undefined) {
        continue;
      }

      state.charge -= this.tuning.beaconTriggerCost;
      state.cooldownUntil =
        ticks + this.mutatorBalance.beaconPulseCooldownTicks;
      state.maskedUntil = ticks + this.tuning.beaconPulseDurationTicks;
      state.anchorTile = anchorTile;

      const pulseSeconds = Math.ceil(this.tuning.beaconPulseDurationTicks / 10);
      this.game.displayMessage(
        `Defense Factory pulse active: troop intel hidden for ${pulseSeconds}s.`,
        MessageType.CHAT,
        player.id(),
      );

      for (const other of this.game.players()) {
        if (other.smallID() === playerID) {
          continue;
        }
        this.game.displayMessage(
          `${player.displayName()} activated a Defense Factory pulse. Their troop intel is obscured temporarily.`,
          MessageType.ATTACK_REQUEST,
          other.id(),
        );
      }

      this.emitActivity(
        "beacon_pulse",
        anchorTile,
        playerID,
        null,
        "Defense Factory pulse",
        140,
      );
      this.contributeToSquadObjective(player, ticks, anchorTile);
      this.game
        .stats()
        .defenseFactoryPulse(player, this.tuning.beaconPulseDurationTicks);
    }
  }

  private pickBeaconAnchorTile(player: Player): TileRef | undefined {
    const factories = player
      .units(UnitType.Factory)
      .filter((unit) => !unit.isUnderConstruction());
    if (factories.length > 0) {
      return this.random.randElement(factories).tile();
    }
    return player.spawnTile();
  }

  private hostileOwnerAtTile(owner: Player, tile: TileRef): Player | null {
    const tileOwner = this.game.owner(tile);
    if (!tileOwner.isPlayer()) {
      return null;
    }
    if (tileOwner.smallID() === owner.smallID()) {
      return null;
    }
    if (tileOwner.isFriendly(owner)) {
      return null;
    }
    return tileOwner;
  }

  private convoyProgressTile(convoy: VaultConvoy): TileRef {
    const srcX = this.game.x(convoy.sourceTile);
    const srcY = this.game.y(convoy.sourceTile);
    const dstX = this.game.x(convoy.destinationTile);
    const dstY = this.game.y(convoy.destinationTile);

    const progress =
      convoy.totalTicks > 0
        ? Math.max(
            0,
            Math.min(
              1,
              (convoy.totalTicks - convoy.ticksRemaining) / convoy.totalTicks,
            ),
          )
        : 1;

    const x = Math.max(
      0,
      Math.min(
        this.game.width() - 1,
        Math.round(srcX + (dstX - srcX) * progress),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        this.game.height() - 1,
        Math.round(srcY + (dstY - srcY) * progress),
      ),
    );
    return this.game.ref(x, y);
  }

  private emitActivity(
    activity:
      | "vault_captured"
      | "vault_passive_income"
      | "convoy_launched"
      | "convoy_rerouted"
      | "convoy_escorted"
      | "convoy_intercepted"
      | "convoy_delivered"
      | "beacon_pulse"
      | "jam_breaker"
      | "comeback_surge"
      | "ghost_reveal"
      | "heist_executed"
      | "bounty_collected"
      | "map_event"
      | "chain_guardian_earned"
      | "breach_window_opened"
      | "vault_breach_victory",
    tile: TileRef,
    sourcePlayerID: number | null,
    targetPlayerID: number | null,
    label: string,
    durationTicks: number,
  ): void {
    if (this.laneFogActivitySuppressed(activity)) {
      return;
    }
    const tuning = this.game.config().vaultConvoyRewardTuning();
    const liveTicks = Math.max(
      0,
      this.game.ticks() - this.game.config().numSpawnPhaseTurns(),
    );
    if (liveTicks < tuning.lowSignalEarlyWindowTicks) {
      const lowSignal =
        activity === "convoy_launched" ||
        activity === "convoy_rerouted" ||
        activity === "convoy_escorted";
      if (lowSignal) {
        return;
      }
    }
    this.statusProjectionCritical = true;
    this.statusProjectionDirty = true;
    this.game.addUpdate({
      type: GameUpdateType.VaultFrontActivity,
      activity,
      tile,
      sourcePlayerID,
      targetPlayerID,
      label,
      durationTicks,
    });
  }

  private projectedSiteReward(site: VaultSite): {
    projectedGoldReward: number;
    projectedTroopsReward: number;
    projectedRewardMultiplier: number;
    projectedRewardScale: number;
    projectedStrengthMultiplier: number;
    projectedPhaseMultiplier: number;
    projectedRiskMultiplier: number;
    projectedDistance: number;
    projectedRisk: number;
    rewardMath: string;
  } {
    const tileOwner = this.game.owner(site.tile);
    const candidate =
      (site.passiveOwnerID !== null
        ? this.game.playerBySmallID(site.passiveOwnerID)
        : site.controllerID !== null
          ? this.game.playerBySmallID(site.controllerID)
          : tileOwner) ?? tileOwner;
    const owner =
      candidate && candidate.isPlayer() && candidate.isAlive()
        ? candidate
        : (this.game.players().find((p) => p.isAlive()) ?? null);
    const tuning = this.game.config().vaultConvoyRewardTuning();
    if (!owner) {
      return {
        projectedGoldReward: tuning.minGoldReward,
        projectedTroopsReward: tuning.minTroopsReward,
        projectedRewardMultiplier: 1,
        projectedRewardScale: 1,
        projectedStrengthMultiplier: 1,
        projectedPhaseMultiplier: 1,
        projectedRiskMultiplier: 1,
        projectedDistance: 0,
        projectedRisk: 0,
        rewardMath: "Reward model unavailable",
      };
    }
    const preferred = this.preferredConvoyDestination.get(owner.smallID());
    const destination = this.bestConvoyDestination(owner, site.tile, preferred);
    const distance = this.game.manhattanDist(site.tile, destination);
    const risk = this.routeRiskScore(owner, site.tile, destination);
    const rewardScale = site.reducedRewardNextCapture
      ? this.tuning.gameplay.vault.reducedCaptureMultiplier
      : 1;
    const plan = this.convoyRewardPlan(
      owner,
      distance,
      risk,
      this.game.ticks(),
      rewardScale,
    );
    return {
      projectedGoldReward: this.bigintToSafeNumber(plan.goldReward),
      projectedTroopsReward: plan.troopsReward,
      projectedRewardMultiplier: plan.rewardMultiplier,
      projectedRewardScale: plan.rewardScale,
      projectedStrengthMultiplier: plan.strengthMultiplier,
      projectedPhaseMultiplier: plan.phaseMultiplier,
      projectedRiskMultiplier: plan.riskMultiplier,
      projectedDistance: distance,
      projectedRisk: risk,
      rewardMath: plan.rewardMath,
    };
  }

  private buildConvoyReroutePreviews(
    owner: Player,
    convoy: VaultConvoy,
    ticks: number,
  ): Array<{
    command:
      | "reroute_city"
      | "reroute_port"
      | "reroute_factory"
      | "reroute_silo"
      | "reroute_safest";
    destinationTile: TileRef;
    etaSeconds: number;
    routeRisk: number;
    routeDistance: number;
    rewardMultiplier: number;
    rewardScale: number;
    strengthMultiplier: number;
    phaseMultiplier: number;
    riskMultiplier: number;
    goldReward: number;
    troopsReward: number;
    rewardMath: string;
    deltaGold: number;
    deltaTroops: number;
    deltaEtaSeconds: number;
    deltaRisk: number;
  }> {
    const currentTile = this.convoyProgressTile(convoy);
    const currentEta = Math.ceil(convoy.ticksRemaining / 10);
    const currentGold = this.bigintToSafeNumber(convoy.goldReward);
    const currentTroops = convoy.troopsReward;
    const commands = [
      "reroute_city",
      "reroute_port",
      "reroute_factory",
      "reroute_silo",
      "reroute_safest",
    ] as const;

    return commands.map((command) => {
      const preferred = this.commandUnitType(command);
      const destinationTile = this.bestConvoyDestination(
        owner,
        currentTile,
        preferred,
        command,
      );
      const distance = this.game.manhattanDist(currentTile, destinationTile);
      const travelTicks = Math.max(
        this.tuning.gameplay.rewardDynamics.rerouteTravelMinTicks,
        Math.min(
          this.tuning.gameplay.rewardDynamics.travelMaxTicks,
          Math.floor(
            distance /
              this.tuning.gameplay.rewardDynamics.travelDistanceDivisor,
          ),
        ),
      );
      const routeRisk = this.routeRiskScore(
        owner,
        currentTile,
        destinationTile,
      );
      const plan = this.convoyRewardPlan(
        owner,
        distance,
        routeRisk,
        ticks,
        convoy.rewardScale,
      );
      const gold = this.bigintToSafeNumber(plan.goldReward);
      const troops = plan.troopsReward;
      const etaSeconds = Math.ceil(travelTicks / 10);
      return {
        command,
        destinationTile,
        etaSeconds,
        routeRisk,
        routeDistance: distance,
        rewardMultiplier: plan.rewardMultiplier,
        rewardScale: plan.rewardScale,
        strengthMultiplier: plan.strengthMultiplier,
        phaseMultiplier: plan.phaseMultiplier,
        riskMultiplier: plan.riskMultiplier,
        goldReward: gold,
        troopsReward: troops,
        rewardMath: plan.rewardMath,
        deltaGold: gold - currentGold,
        deltaTroops: troops - currentTroops,
        deltaEtaSeconds: etaSeconds - currentEta,
        deltaRisk: routeRisk - convoy.routeRisk,
      };
    });
  }

  private maybePublishStatusUpdate(ticks: number): void {
    if (!this.statusProjectionDirty) return;
    const cadenceElapsed =
      ticks - this.lastStatusProjectionTick >=
      this.tuning.statusProjectionCadenceTicks;
    if (!this.statusProjectionCritical && !cadenceElapsed) return;
    this.publishStatusUpdate(ticks);
  }

  public statusProjectionPosture(): {
    cadenceTicks: number;
    builds: number;
    publishes: number;
    deduplicated: number;
    p95BuildMs: number;
    lastDigest: number | null;
    buildSampleCount: number;
  } {
    const sorted = [...this.statusProjectionBuildSamplesMs].sort(
      (a, b) => a - b,
    );
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    return {
      cadenceTicks: this.tuning.statusProjectionCadenceTicks,
      builds: this.statusProjectionBuilds,
      publishes: this.statusProjectionPublishes,
      deduplicated: this.statusProjectionDeduplicated,
      p95BuildMs: sorted[p95Index] ?? 0,
      lastDigest: this.lastStatusProjectionDigest,
      buildSampleCount: sorted.length,
    };
  }

  private publishStatusUpdate(ticks = this.game.ticks()): void {
    const buildStartedAt = performance.now();
    const statusUpdate: VaultFrontStatusUpdate = {
      type: GameUpdateType.VaultFrontStatus,
      weeklyMutator: this.weeklyMutator,
      captureTicksRequired: this.mutatorBalance.vaultCaptureTicks,
      cooldownTicksTotal: this.mutatorBalance.vaultCooldownTicks,
      passiveGoldPerMinute: this.bigintToSafeNumber(
        this.mutatorBalance.vaultPassiveGoldPerMinute,
      ),
      jamBreakerGoldCost: this.bigintToSafeNumber(
        this.tuning.jamBreakerGoldCost,
      ),
      escortDurationTicks: this.mutatorBalance.escortDurationTicks,
      sites: this.vaultSites.map((site) => {
        const projected = this.projectedSiteReward(site);
        return {
          id: site.id,
          tile: site.tile,
          controllerID: site.controllerID,
          controlTicks: site.controlTicks,
          cooldownTicks: site.cooldownTicks,
          passiveOwnerID: site.passiveOwnerID,
          nextPassiveIncomeTick: site.nextPassiveGoldTick,
          reducedRewardNextCapture: site.reducedRewardNextCapture,
          projectedGoldReward: projected.projectedGoldReward,
          projectedTroopsReward: projected.projectedTroopsReward,
          projectedRewardMultiplier: projected.projectedRewardMultiplier,
          projectedRewardScale: projected.projectedRewardScale,
          projectedStrengthMultiplier: projected.projectedStrengthMultiplier,
          projectedPhaseMultiplier: projected.projectedPhaseMultiplier,
          projectedRiskMultiplier: projected.projectedRiskMultiplier,
          projectedDistance: projected.projectedDistance,
          projectedRisk: projected.projectedRisk,
          rewardMath: projected.rewardMath,
        };
      }),
      convoys: this.convoys.map((convoy) => {
        const owner = this.game.playerBySmallID(convoy.ownerID);
        const reroutePreviews =
          owner && owner.isPlayer()
            ? this.buildConvoyReroutePreviews(owner, convoy, this.game.ticks())
            : [];
        return {
          id: convoy.id,
          ownerID: convoy.ownerID,
          sourceTile: convoy.sourceTile,
          destinationTile: convoy.destinationTile,
          ticksRemaining: convoy.ticksRemaining,
          totalTicks: convoy.totalTicks,
          escortShield: convoy.escortShield,
          goldReward: this.bigintToSafeNumber(convoy.goldReward),
          troopsReward: convoy.troopsReward,
          rewardMultiplier: convoy.rewardMultiplier,
          rewardScale: convoy.rewardScale,
          strengthMultiplier: convoy.strengthMultiplier,
          phaseMultiplier: convoy.phaseMultiplier,
          riskMultiplier: convoy.riskMultiplier,
          routeRisk: convoy.routeRisk,
          routeDistance: convoy.routeDistance,
          rewardMath: convoy.rewardMath,
          interceptProbability: convoy.interceptProbability,
          reroutePreviews,
          isGhost: convoy.ghostConvoy,
        };
      }),
      beacons: [...this.beacons.entries()].map(([playerID, state]) => {
        const player = this.game.playerBySmallID(playerID);
        const factoryCount =
          player && player.isPlayer() ? player.unitCount(UnitType.Factory) : 0;
        return {
          playerID,
          charge: state.charge,
          cooldownUntilTick: state.cooldownUntil,
          maskedUntilTick: state.maskedUntil,
          jamBreakerCooldownUntilTick:
            this.jamBreakerCooldownUntil.get(playerID) ?? 0,
          escortUntilTick: this.escortUntilTick.get(playerID) ?? 0,
          anchorTile: state.anchorTile,
          factoryCount,
        };
      }),
      executionChains: this.buildExecutionChainStates(),
      surges: this.buildSurgeStates(),
      squadObjectives: this.buildSquadObjectiveStates(),
      pressure: this.buildPressureStates(),
    };
    this.statusProjectionBuilds += 1;
    this.statusProjectionBuildSamplesMs.push(
      performance.now() - buildStartedAt,
    );
    if (this.statusProjectionBuildSamplesMs.length > 64) {
      this.statusProjectionBuildSamplesMs.shift();
    }
    const serialized = JSON.stringify(statusUpdate);
    const digest = simpleHash(serialized);
    this.lastStatusProjectionTick = ticks;
    this.statusProjectionDirty = false;
    this.statusProjectionCritical = false;
    // The hash is useful low-cardinality posture, but equality also checks the
    // canonical projection so a 32-bit collision can never suppress a change.
    if (
      digest === this.lastStatusProjectionDigest &&
      serialized === this.lastStatusProjectionSerialized
    ) {
      this.statusProjectionDeduplicated += 1;
      return;
    }
    this.lastStatusProjectionDigest = digest;
    this.lastStatusProjectionSerialized = serialized;
    this.statusProjectionPublishes += 1;
    this.game.addUpdate(statusUpdate);
    this.game.setVaultSiteControllerIDs(
      new Set(
        this.vaultSites
          .filter((s) => s.controllerID !== null)
          .map((s) => s.controllerID as number),
      ),
    );
    this.debugPublishedStatus(statusUpdate);
  }

  private buildPressureStates(): Record<number, VaultFrontPressureState> {
    const result: Record<number, VaultFrontPressureState> = {};
    for (const [playerID, state] of this.vaultPressureStates.entries()) {
      result[playerID] = projectVaultPressure(
        state,
        this.game.ticks(),
        DEFAULT_VAULT_PRESSURE_CONFIG,
      );
    }
    return result;
  }

  private sweepExpiredBreachWindows(ticks: number): void {
    if (this.vaultBreachVictorID !== null) return;
    for (const [playerID, state] of this.vaultPressureStates.entries()) {
      const transition = expireVaultPressureWindow(state, ticks);
      this.vaultPressureStates.set(playerID, transition.state);
    }
  }

  private advanceVaultPressure(
    owner: Player,
    ticks: number,
    tile: TileRef,
  ): void {
    if (this.vaultBreachVictorID !== null || this.game.getWinner() !== null) {
      return;
    }

    const playerID = owner.smallID();
    const transition = deliverToVaultPressure(
      this.vaultPressureStates.get(playerID) ?? initialVaultPressureState(),
      ticks,
    );
    this.vaultPressureStates.set(playerID, transition.state);
    if (
      transition.events.some((event) => event.type === "vault-breach-victory")
    ) {
      this.vaultBreachVictorID = playerID;
      this.emitActivity(
        "vault_breach_victory",
        tile,
        playerID,
        null,
        `${owner.displayName()} secured a Vault Breach victory`,
        240,
      );
      this.game.displayMessage(
        `${owner.displayName()} completed the Vault Breach!`,
        MessageType.CHAT,
        null,
      );
      this.game.setWinner(owner.team() ?? owner, this.game.stats().stats());
      this.active = false;
      return;
    }
    if (
      !transition.events.some((event) => event.type === "breach-window-opened")
    ) {
      return;
    }
    this.emitActivity(
      "breach_window_opened",
      tile,
      playerID,
      null,
      `${owner.displayName()} opened a Vault Breach Window`,
      180,
    );
    this.game.displayMessage(
      `${owner.displayName()} reached maximum Vault Pressure — stop their next delivery!`,
      MessageType.ATTACK_REQUEST,
      null,
    );
  }

  private buildExecutionChainStates(): Record<
    number,
    VaultFrontExecutionChainState
  > {
    const result: Record<number, VaultFrontExecutionChainState> = {};
    for (const [playerID, step] of this.executionChainStep.entries()) {
      const expiresAtTick = this.executionChainExpiresAtTick.get(playerID) ?? 0;
      result[playerID] = { step, expiresAtTick };
    }
    return result;
  }

  private buildSurgeStates(): Record<number, VaultFrontSurgeState> {
    const result: Record<number, VaultFrontSurgeState> = {};
    const now = this.game.ticks();
    for (const [playerID, surgeUntil] of this.surgeUntilTick.entries()) {
      result[playerID] = {
        active: surgeUntil > now,
        surgeUntilTick: surgeUntil,
      };
    }
    return result;
  }

  private buildSquadObjectiveStates(): VaultFrontSquadObjectiveState[] {
    return this.squadObjectiveWindows.map((w) => ({
      siteID: w.siteID,
      ownerID: w.ownerID,
      anchorTile: w.anchorTile,
      expiresAtTick: w.expiresAtTick,
      rewarded: w.rewarded,
    }));
  }

  private vaultDebugEnabled(): boolean {
    return (
      (
        globalThis as {
          __OPENFRONT_VAULT_DEBUG__?: boolean;
          __VAULTFRONT_DEBUG__?: boolean;
        }
      ).__OPENFRONT_VAULT_DEBUG__ === true ||
      (
        globalThis as {
          __OPENFRONT_VAULT_DEBUG__?: boolean;
          __VAULTFRONT_DEBUG__?: boolean;
        }
      ).__VAULTFRONT_DEBUG__ === true
    );
  }

  private debugVault(stage: string, payload: Record<string, unknown>): void {
    if (!this.vaultDebugEnabled()) return;
    console.debug(`[VaultFrontExecution:${stage}]`, payload);
  }

  private debugPublishedStatus(statusUpdate: {
    convoys: Array<{
      id: number;
      ownerID: number;
      sourceTile: TileRef;
      destinationTile: TileRef;
      goldReward: number;
      troopsReward: number;
    }>;
    sites: Array<{
      id: number;
      controllerID: number | null;
      passiveOwnerID: number | null;
      cooldownTicks: number;
    }>;
  }): void {
    const key = statusUpdate.convoys
      .map(
        (convoy) =>
          `${convoy.id}:${convoy.ownerID}:${convoy.sourceTile}:${convoy.destinationTile}`,
      )
      .join("|");
    if (key === this.lastPublishedConvoyDebugKey) return;
    this.lastPublishedConvoyDebugKey = key;
    this.debugVault("publish_status", {
      convoyCount: statusUpdate.convoys.length,
      convoys: statusUpdate.convoys.map((convoy) => ({
        id: convoy.id,
        ownerID: convoy.ownerID,
        sourceTile: convoy.sourceTile,
        destinationTile: convoy.destinationTile,
        goldReward: convoy.goldReward,
        troopsReward: convoy.troopsReward,
      })),
      sites: statusUpdate.sites.map((site) => ({
        id: site.id,
        controllerID: site.controllerID,
        passiveOwnerID: site.passiveOwnerID,
        cooldownTicks: site.cooldownTicks,
      })),
    });
  }

  private bigintToSafeNumber(value: bigint): number {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    if (value >= max) {
      return Number.MAX_SAFE_INTEGER;
    }
    if (value <= 0n) {
      return 0;
    }
    return Number(value);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
