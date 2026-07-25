import {
  Difficulty,
  Execution,
  Game,
  Nation,
  Player,
  PlayerID,
  Relation,
  TerrainType,
  UnitType,
  VaultFrontCommandType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { assertNever, simpleHash } from "../Util";
import { NationAllianceBehavior } from "./nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "./nation/NationEmojiBehavior";
import { NationMIRVBehavior } from "./nation/NationMIRVBehavior";
import { NationNukeBehavior } from "./nation/NationNukeBehavior";
import { NationStructureBehavior } from "./nation/NationStructureBehavior";
import { NationWarshipBehavior } from "./nation/NationWarshipBehavior";
import { SpawnExecution } from "./SpawnExecution";
import { AiAttackBehavior } from "./utils/AiAttackBehavior";
import {
  balanceGold,
  DEFAULT_VAULT_GAMEPLAY_BALANCE,
} from "./VaultFrontBalance";

const NATION_BALANCE = DEFAULT_VAULT_GAMEPLAY_BALANCE.ai.nation;
const JAM_BREAKER_GOLD_COST = balanceGold(
  DEFAULT_VAULT_GAMEPLAY_BALANCE.defense.jamBreakerGoldCost,
);

export class NationExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private behaviorsInitialized = false;
  private emojiBehavior!: NationEmojiBehavior;
  private mirvBehavior!: NationMIRVBehavior;
  private attackBehavior!: AiAttackBehavior;
  private allianceBehavior!: NationAllianceBehavior;
  private warshipBehavior!: NationWarshipBehavior;
  private nukeBehavior!: NationNukeBehavior;
  private structureBehavior!: NationStructureBehavior;
  private mg: Game;
  private player: Player | null = null;

  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;

  private readonly embargoMalusApplied = new Set<PlayerID>();
  private nextVaultFrontCommandTick = 0;
  private vaultFrontRoutePreferenceIndex = 0;

  constructor(
    private gameID: GameID,
    private nation: Nation, // Nation contains PlayerInfo with PlayerType.Nation
  ) {
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
    this.triggerRatio = this.random.nextInt(50, 60) / 100;
    this.reserveRatio = this.random.nextInt(30, 40) / 100;
    this.expandRatio = this.random.nextInt(10, 20) / 100;
  }

  init(mg: Game) {
    this.mg = mg;
    this.applyNationEmphasis();
    this.attackRate = this.getAttackRate();
    this.attackTick = this.random.nextInt(0, this.attackRate);

    if (!this.mg.hasPlayer(this.nation.playerInfo.id)) {
      this.player = this.mg.addPlayer(this.nation.playerInfo);
    } else {
      this.player = this.mg.player(this.nation.playerInfo.id);
    }
  }

  private applyNationEmphasis(): void {
    // 0 => troops focus, 100 => gold/economy focus
    const emphasis = this.mg.config().nationGoldTroopEmphasis() / 100;

    // Gold focus waits longer before committing troops and expands more conservatively.
    this.triggerRatio = this.clampRatio(
      this.triggerRatio + this.lerp(-0.08, 0.12, emphasis),
    );
    this.reserveRatio = this.clampRatio(
      this.reserveRatio + this.lerp(-0.06, 0.14, emphasis),
    );
    this.expandRatio = this.clampRatio(
      this.expandRatio + this.lerp(0.08, -0.08, emphasis),
    );
  }

  private lerp(min: number, max: number, t: number): number {
    return min + (max - min) * t;
  }

  private clampRatio(value: number): number {
    return Math.max(0.05, Math.min(0.95, value));
  }

  private getAttackRate(): number {
    const { difficulty } = this.mg.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return this.random.nextInt(65, 80); // Slower reactions
      case Difficulty.Medium:
        return this.random.nextInt(55, 70);
      case Difficulty.Hard:
        return this.random.nextInt(45, 60);
      case Difficulty.Impossible:
        return this.random.nextInt(30, 50); // Faster reactions
      default:
        assertNever(difficulty);
    }
  }

  tick(ticks: number) {
    // Ship tracking
    if (
      this.behaviorsInitialized &&
      this.player !== null &&
      this.player.isAlive() &&
      this.mg.config().gameConfig().difficulty !== Difficulty.Easy
    ) {
      this.warshipBehavior.trackShipsAndRetaliate();
    }

    if (this.player === null) {
      return;
    }

    if (this.mg.inSpawnPhase()) {
      if (ticks % this.attackRate !== this.attackTick) {
        return;
      }
      // Place nations without a spawn cell (Dynamically created for HumansVsNations) randomly by SpawnExecution
      if (this.nation.spawnCell === undefined) {
        this.mg.addExecution(
          new SpawnExecution(this.gameID, this.nation.playerInfo),
        );
        return;
      }

      // If team spawn areas are configured and the nation's spawn cell
      // is outside its team's area, spawn randomly within the area instead.
      const team = this.player.team();
      if (team !== null) {
        const area = this.mg.teamSpawnArea(team);
        if (area !== undefined) {
          const cell = this.nation.spawnCell;
          const inArea =
            cell.x >= area.x &&
            cell.x < area.x + area.width &&
            cell.y >= area.y &&
            cell.y < area.y + area.height;
          if (!inArea) {
            this.mg.addExecution(
              new SpawnExecution(this.gameID, this.nation.playerInfo),
            );
            return;
          }
        }
      }

      // Select a tile near the position defined in the map manifest
      const rl = this.randomSpawnLand();

      if (rl === null) {
        console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
        return;
      }

      this.mg.addExecution(
        new SpawnExecution(this.gameID, this.nation.playerInfo, rl),
      );
      return;
    }

    if (!this.player.isAlive()) {
      //removeOnDeath is called from nation's PlayerExecution
      this.active = false;
      return;
    }

    if (!this.behaviorsInitialized) {
      this.initializeBehaviors();
      this.attackBehavior.forceSendAttack(this.mg.terraNullius());
      return;
    }

    if (ticks % this.attackRate !== this.attackTick) {
      // Call handleStructures twice between regular attack ticks (at 1/3 and 2/3 of the interval)
      // Otherwise it is possible that we earn more gold than we can spend
      // The alternative is placing multiple structures in handleStructures, but that causes problems
      if (this.player.isAlive()) {
        const offset = ticks % this.attackRate;
        const oneThird =
          (this.attackTick + Math.floor(this.attackRate / 3)) % this.attackRate;
        const twoThirds =
          (this.attackTick + Math.floor((this.attackRate * 2) / 3)) %
          this.attackRate;
        if (offset === oneThird || offset === twoThirds) {
          this.structureBehavior.handleStructures();
        }
      }
      return;
    }

    this.emojiBehavior.maybeSendCasualEmoji();
    this.updateRelationsFromEmbargos();
    this.allianceBehavior.handleAllianceRequests();
    this.allianceBehavior.handleAllianceExtensionRequests();
    this.mirvBehavior.considerMIRV();
    this.structureBehavior.handleStructures();
    this.warshipBehavior.maybeSpawnWarship();
    this.handleEmbargoesToHostileNations();
    this.maybeIssueVaultFrontCommand(ticks);
    this.attackBehavior.maybeAttack();
    this.warshipBehavior.counterWarshipInfestation();
    this.nukeBehavior.maybeSendNuke();
  }

  private maybeIssueVaultFrontCommand(ticks: number): void {
    const player = this.player;
    if (!player || !player.isAlive()) return;
    if (ticks < this.nextVaultFrontCommandTick) return;

    const pressure = this.hostileNeighborPressure(player);
    const defenseStructures =
      player.unitsOwned(UnitType.DefensePost) +
      player.unitsOwned(UnitType.SAMLauncher);
    const econBias = this.mg.config().nationGoldTroopEmphasis() / 100;

    // Strength ratio vs all alive players (comeback surge awareness)
    const allPlayers = this.mg
      .players()
      .filter((p) => p.isAlive() && p.isPlayer());
    const avgTiles =
      allPlayers.length > 0
        ? allPlayers.reduce((sum, p) => sum + p.tiles().size, 0) /
          allPlayers.length
        : 1;
    const strengthRatio = avgTiles > 0 ? player.tiles().size / avgTiles : 1;
    const isBehind = strengthRatio < NATION_BALANCE.behindStrengthRatio;

    const canAffordJam = player.gold() >= JAM_BREAKER_GOLD_COST;

    const highPressure = pressure >= NATION_BALANCE.highPressure; // slightly lower threshold than before
    const mediumPressure = pressure >= NATION_BALANCE.mediumPressure;
    const lowPressure = pressure < NATION_BALANCE.lowPressure;
    let command: VaultFrontCommandType | null = null;

    if (
      highPressure &&
      defenseStructures > 0 &&
      canAffordJam &&
      this.random.chance(NATION_BALANCE.jamChanceDivisor)
    ) {
      // Use jam_breaker aggressively when under siege AND can afford it
      command = "jam_breaker";
    } else if (
      (pressure >= NATION_BALANCE.escortPressure || isBehind) &&
      this.random.chance(
        isBehind
          ? NATION_BALANCE.behindEscortChanceDivisor
          : NATION_BALANCE.standardEscortChanceDivisor,
      )
    ) {
      // Escort more eagerly when losing — protects convoys that give comeback bonuses
      command = "escort";
    } else if (
      mediumPressure &&
      this.random.chance(NATION_BALANCE.pressureRerouteChanceDivisor)
    ) {
      command = this.nextRerouteCommand(true);
    } else if (
      lowPressure &&
      !isBehind &&
      this.random.chance(
        econBias >= NATION_BALANCE.economyBiasThreshold
          ? NATION_BALANCE.economyRerouteChanceHighBias
          : NATION_BALANCE.economyRerouteChanceLowBias,
      )
    ) {
      command = this.nextRerouteCommand(false);
    } else if (
      isBehind &&
      lowPressure &&
      this.random.chance(NATION_BALANCE.safeBehindRerouteChanceDivisor)
    ) {
      // When behind but safe: reroute to most economic destination
      command = "reroute_city";
    }

    if (command !== null) {
      this.mg.queueVaultFrontCommand({
        playerSmallID: player.smallID(),
        type: command,
        issuedAtTick: ticks,
      });
      // Tighter timing windows for more responsive bot behavior
      this.nextVaultFrontCommandTick =
        command === "jam_breaker"
          ? ticks +
            this.random.nextInt(
              NATION_BALANCE.jamCooldownMinTicks,
              NATION_BALANCE.jamCooldownMaxTicks,
            )
          : command === "escort"
            ? ticks +
              this.random.nextInt(
                NATION_BALANCE.escortCooldownMinTicks,
                NATION_BALANCE.escortCooldownMaxTicks,
              )
            : ticks +
              this.random.nextInt(
                NATION_BALANCE.rerouteCooldownMinTicks,
                NATION_BALANCE.rerouteCooldownMaxTicks,
              );
    } else {
      this.nextVaultFrontCommandTick = highPressure
        ? ticks +
          this.random.nextInt(
            NATION_BALANCE.highPressureRetryMinTicks,
            NATION_BALANCE.highPressureRetryMaxTicks,
          )
        : ticks +
          this.random.nextInt(
            NATION_BALANCE.idleRetryMinTicks,
            NATION_BALANCE.idleRetryMaxTicks,
          );
    }
  }

  private hostileNeighborPressure(player: Player): number {
    const neighbors = player
      .neighbors()
      .filter((n) => n.isPlayer()) as Player[];
    if (neighbors.length === 0) return 0;
    const hostile = neighbors.filter(
      (other) => !player.isFriendly(other),
    ).length;
    return hostile / neighbors.length;
  }

  private nextRerouteCommand(underPressure: boolean): VaultFrontCommandType {
    const safeOrder: VaultFrontCommandType[] = [
      "reroute_safest",
      "reroute_port",
      "reroute_silo",
      "reroute_factory",
      "reroute_city",
    ];
    const econOrder: VaultFrontCommandType[] = [
      "reroute_city",
      "reroute_factory",
      "reroute_port",
      "reroute_silo",
    ];
    const order = underPressure ? safeOrder : econOrder;
    const command = order[this.vaultFrontRoutePreferenceIndex % order.length];
    this.vaultFrontRoutePreferenceIndex++;
    return command;
  }

  private initializeBehaviors(): void {
    if (this.player === null) throw new Error("Player not initialized");

    this.emojiBehavior = new NationEmojiBehavior(
      this.random,
      this.mg,
      this.player,
    );
    this.mirvBehavior = new NationMIRVBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.allianceBehavior = new NationAllianceBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.warshipBehavior = new NationWarshipBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.attackBehavior = new AiAttackBehavior(
      this.random,
      this.mg,
      this.player,
      this.triggerRatio,
      this.reserveRatio,
      this.expandRatio,
      this.allianceBehavior,
      this.emojiBehavior,
    );
    this.nukeBehavior = new NationNukeBehavior(
      this.random,
      this.mg,
      this.player,
      this.attackBehavior,
      this.emojiBehavior,
    );
    this.structureBehavior = new NationStructureBehavior(
      this.random,
      this.mg,
      this.player,
      this.mg.config().nationGoldTroopEmphasis(),
    );
    this.behaviorsInitialized = true;
  }

  private randomSpawnLand(): TileRef | null {
    if (this.nation.spawnCell === undefined) throw new Error("not initialized");

    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.nation.spawnCell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (this.mg.isLand(tile) && !this.mg.hasOwner(tile)) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }

  private updateRelationsFromEmbargos() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      const embargoMalus = -20;
      if (
        other.hasEmbargoAgainst(player) &&
        !this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, embargoMalus);
        this.embargoMalusApplied.add(other.id());
      } else if (
        !other.hasEmbargoAgainst(player) &&
        this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, -embargoMalus);
        this.embargoMalusApplied.delete(other.id());
      }
    });
  }

  private handleEmbargoesToHostileNations() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      /* When player is hostile starts embargo. Do not stop until neutral again */
      if (
        player.relation(other) <= Relation.Hostile &&
        !player.hasEmbargoAgainst(other) &&
        !player.isOnSameTeam(other)
      ) {
        player.addEmbargo(other, false);
      } else if (
        player.relation(other) >= Relation.Neutral &&
        player.hasEmbargoAgainst(other) &&
        this.mg.config().gameConfig().difficulty !== Difficulty.Hard &&
        this.mg.config().gameConfig().difficulty !== Difficulty.Impossible
      ) {
        player.stopEmbargo(other);
      } else if (
        player.relation(other) >= Relation.Friendly &&
        player.hasEmbargoAgainst(other) &&
        this.mg.config().gameConfig().difficulty !== Difficulty.Impossible
      ) {
        player.stopEmbargo(other);
      }
    });
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
