import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import {
  EmojiMessage,
  GameUpdates,
  Gold,
  MessageType,
  NameViewData,
  PlayerID,
  PlayerType,
  Team,
  Tick,
  TrainType,
  UnitType,
} from "./Game";
import { TileRef } from "./GameMap";

export interface GameUpdateViewData {
  tick: number;
  updates: GameUpdates;
  /**
   * Packed tile updates as `[tileRef, state]` uint32 pairs.
   *
   * `tileRef` is a `TileRef` (fits in uint32), and `state` is the packed per-tile
   * state (`uint16`) stored in a `uint32` lane.
   */
  packedTileUpdates: Uint32Array;
  /**
   * Optional packed motion plan records.
   *
   * When present, this buffer is expected to be transferred worker -> main
   * (similar to `packedTileUpdates`) to avoid structured-clone copies.
   */
  packedMotionPlans?: Uint32Array;
  playerNameViewData: Record<string, NameViewData>;
  tickExecutionDuration?: number;
  pendingTurns?: number;
}

export interface ErrorUpdate {
  errMsg: string;
  stack?: string;
}

export enum GameUpdateType {
  // Tile updates are delivered via `packedTileUpdates` on the outer GameUpdateViewData.
  Tile,
  Unit,
  Player,
  DisplayEvent,
  DisplayChatEvent,
  AllianceRequest,
  AllianceRequestReply,
  BrokeAlliance,
  AllianceExpired,
  AllianceExtension,
  TargetPlayer,
  Emoji,
  Win,
  Hash,
  UnitIncoming,
  BonusEvent,
  RailroadDestructionEvent,
  RailroadConstructionEvent,
  RailroadSnapEvent,
  ConquestEvent,
  EmbargoEvent,
  GamePaused,
  VaultFrontStatus,
  VaultFrontActivity,
  LastStandActivated,
  HeistExecuted,
  BountyBoardActivated,
  BountyCollected,
  WarchestHuntStarted,
  MapEventFired,
  MapEventExpired,
  MissionComplete,
}

export type GameUpdate =
  | UnitUpdate
  | PlayerUpdate
  | AllianceRequestUpdate
  | AllianceRequestReplyUpdate
  | BrokeAllianceUpdate
  | AllianceExpiredUpdate
  | DisplayMessageUpdate
  | DisplayChatMessageUpdate
  | TargetPlayerUpdate
  | EmojiUpdate
  | WinUpdate
  | HashUpdate
  | UnitIncomingUpdate
  | AllianceExtensionUpdate
  | BonusEventUpdate
  | RailroadConstructionUpdate
  | RailroadDestructionUpdate
  | RailroadSnapUpdate
  | ConquestUpdate
  | EmbargoUpdate
  | GamePausedUpdate
  | VaultFrontStatusUpdate
  | VaultFrontActivityUpdate
  | LastStandActivatedUpdate
  | HeistExecutedUpdate
  | BountyBoardActivatedUpdate
  | BountyCollectedUpdate
  | WarchestHuntStartedUpdate
  | MapEventFiredUpdate
  | MapEventExpiredUpdate
  | MissionCompleteUpdate;

export interface LastStandActivatedUpdate {
  type: GameUpdateType.LastStandActivated;
  /** Small ID of the player who triggered Last Stand by holding 5+ vault sites */
  triggerPlayerID: number;
  /** Number of vault sites that player holds */
  siteCount: number;
  /** Duration in ticks that the bonus window lasts */
  bonusDurationTicks: number;
  /** Gold multiplier applied to all opponents during the bonus window */
  opponentGoldMultiplier: number;
}

export interface BonusEventUpdate {
  type: GameUpdateType.BonusEvent;
  player: PlayerID;
  tile: TileRef;
  gold: number;
  troops: number;
}

export interface RailroadConstructionUpdate {
  type: GameUpdateType.RailroadConstructionEvent;
  id: number;
  tiles: TileRef[];
}

export interface RailroadDestructionUpdate {
  type: GameUpdateType.RailroadDestructionEvent;
  id: number;
}

export interface RailroadSnapUpdate {
  type: GameUpdateType.RailroadSnapEvent;
  originalId: number;
  newId1: number;
  newId2: number;
  tiles1: TileRef[];
  tiles2: TileRef[];
}

export interface ConquestUpdate {
  type: GameUpdateType.ConquestEvent;
  conquerorId: PlayerID;
  conqueredId: PlayerID;
  gold: Gold;
}

export interface UnitUpdate {
  type: GameUpdateType.Unit;
  unitType: UnitType;
  troops: number;
  id: number;
  ownerID: number;
  lastOwnerID?: number;
  // TODO: make these tilerefs
  pos: TileRef;
  lastPos: TileRef;
  isActive: boolean;
  reachedTarget: boolean;
  retreating: boolean;
  targetable: boolean;
  markedForDeletion: number | false;
  targetUnitId?: number; // Only for trade ships
  targetTile?: TileRef; // Only for nukes
  health?: number;
  underConstruction?: boolean;
  missileTimerQueue: number[];
  level: number;
  hasTrainStation: boolean;
  trainType?: TrainType; // Only for trains
  loaded?: boolean; // Only for trains
}

export interface AttackUpdate {
  attackerID: number;
  targetID: number;
  troops: number;
  id: string;
  retreating: boolean;
}

export interface PlayerUpdate {
  type: GameUpdateType.Player;
  nameViewData?: NameViewData;
  clientID: ClientID | null;
  name: string;
  displayName: string;
  id: PlayerID;
  team?: Team;
  smallID: number;
  playerType: PlayerType;
  isAlive: boolean;
  isDisconnected: boolean;
  tilesOwned: number;
  gold: Gold;
  goldTroopFocus: number;
  troops: number;
  allies: number[];
  embargoes: Set<PlayerID>;
  isTraitor: boolean;
  traitorRemainingTicks?: number;
  targets: number[];
  outgoingEmojis: EmojiMessage[];
  outgoingAttacks: AttackUpdate[];
  incomingAttacks: AttackUpdate[];
  outgoingAllianceRequests: PlayerID[];
  alliances: AllianceView[];
  hasSpawned: boolean;
  betrayals: number;
  lastDeleteUnitTick: Tick;
  isLobbyCreator: boolean;
}

export interface AllianceView {
  id: number;
  other: PlayerID;
  createdAt: Tick;
  expiresAt: Tick;
  hasExtensionRequest: boolean;
}

export interface AllianceRequestUpdate {
  type: GameUpdateType.AllianceRequest;
  requestorID: number;
  recipientID: number;
  createdAt: Tick;
}

export interface AllianceRequestReplyUpdate {
  type: GameUpdateType.AllianceRequestReply;
  request: AllianceRequestUpdate;
  accepted: boolean;
}

export interface BrokeAllianceUpdate {
  type: GameUpdateType.BrokeAlliance;
  traitorID: number;
  betrayedID: number;
  allianceID: number;
}

export interface AllianceExpiredUpdate {
  type: GameUpdateType.AllianceExpired;
  player1ID: number;
  player2ID: number;
}

export interface AllianceExtensionUpdate {
  type: GameUpdateType.AllianceExtension;
  playerID: number;
  allianceID: number;
}

export interface TargetPlayerUpdate {
  type: GameUpdateType.TargetPlayer;
  playerID: number;
  targetID: number;
}

export interface EmojiUpdate {
  type: GameUpdateType.Emoji;
  emoji: EmojiMessage;
}

export interface DisplayMessageUpdate {
  type: GameUpdateType.DisplayEvent;
  message: string;
  messageType: MessageType;
  goldAmount?: bigint;
  playerID: number | null;
  params?: Record<string, string | number>;
}

export type DisplayChatMessageUpdate = {
  type: GameUpdateType.DisplayChatEvent;
  key: string;
  category: string;
  target: string | undefined;
  playerID: number | null;
  isFrom: boolean;
  recipient: string;
};

export interface WinUpdate {
  type: GameUpdateType.Win;
  allPlayersStats: AllPlayersStats;
  winner: Winner;
}

export interface HashUpdate {
  type: GameUpdateType.Hash;
  tick: Tick;
  hash: number;
}

export interface UnitIncomingUpdate {
  type: GameUpdateType.UnitIncoming;
  unitID: number;
  message: string;
  messageType: MessageType;
  playerID: number;
}

export interface EmbargoUpdate {
  type: GameUpdateType.EmbargoEvent;
  event: "start" | "stop";
  playerID: number;
  embargoedID: number;
}

export interface GamePausedUpdate {
  type: GameUpdateType.GamePaused;
  paused: boolean;
}

export interface VaultFrontSiteState {
  id: number;
  tile: TileRef;
  controllerID: number | null;
  controlTicks: number;
  cooldownTicks: number;
  passiveOwnerID: number | null;
  nextPassiveIncomeTick: Tick;
  reducedRewardNextCapture: boolean;
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
}

export interface VaultFrontReroutePreview {
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
}

export interface VaultFrontConvoyState {
  id: number;
  ownerID: number;
  sourceTile: TileRef;
  destinationTile: TileRef;
  ticksRemaining: number;
  totalTicks: number;
  escortShield: number;
  goldReward: number;
  troopsReward: number;
  rewardMultiplier: number;
  rewardScale: number;
  strengthMultiplier: number;
  phaseMultiplier: number;
  riskMultiplier: number;
  routeRisk: number;
  routeDistance: number;
  rewardMath: string;
  /** 0–100 intercept probability based on enemy troop density near the convoy corridor */
  interceptProbability: number;
  reroutePreviews?: VaultFrontReroutePreview[];
  /** True when owner activated ghost-route; ETA is hidden from opponents */
  isGhost: boolean;
}

export interface VaultFrontBeaconState {
  playerID: number;
  charge: number;
  cooldownUntilTick: Tick;
  maskedUntilTick: Tick;
  jamBreakerCooldownUntilTick: Tick;
  escortUntilTick: Tick;
  anchorTile?: TileRef;
  factoryCount: number;
}

export interface VaultFrontExecutionChainState {
  /** Which step the chain is on for this player: 0 = no chain, 1 = captured, 2 = delivered */
  step: 0 | 1 | 2;
  /** Tick at which the current step expires (0 when no chain active) */
  expiresAtTick: Tick;
}

export interface VaultFrontSurgeState {
  /** Whether comeback surge is currently active for this player */
  active: boolean;
  /** Tick at which surge expires (0 when inactive) */
  surgeUntilTick: Tick;
}

export interface VaultFrontSquadObjectiveState {
  /** Vault site ID this objective is centered on */
  siteID: number;
  /** The owning player's small ID */
  ownerID: number;
  /** Map tile at the center of the objective radius */
  anchorTile: TileRef;
  /** Tick at which the window closes */
  expiresAtTick: Tick;
  /** True once the squad bonus has been awarded */
  rewarded: boolean;
}

export interface VaultFrontPressureState {
  /** Bounded delivery pressure accumulated toward a Breach Window. */
  pressure: number;
  /** Pressure required to open a Breach Window. */
  threshold: number;
  /** Tick at which the active window closes, or 0 when no window is open. */
  breachWindowUntilTick: Tick;
  /** Deliveries still required during the active window to secure victory. */
  deliveriesRequired: 0 | 1;
  /** True once this player/team secured a Vault Breach victory. */
  victorySecured: boolean;
  /** Competitive ownership of this state; team members receive one projection. */
  scope: "player" | "team";
  /** Stable simulation key, never a client-authored identifier. */
  scopeKey: string;
  /** Delivery contributions keyed by actor small ID. */
  contributors: Record<number, number>;
}

export interface VaultFrontStatusUpdate {
  type: GameUpdateType.VaultFrontStatus;
  weeklyMutator:
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
    | "execution_rush";
  captureTicksRequired: number;
  cooldownTicksTotal: number;
  passiveGoldPerMinute?: number;
  jamBreakerGoldCost?: number;
  escortDurationTicks?: number;
  /** Authoritative duration of the current execution-chain window. */
  executionChainWindowTicks: number;
  /** Authoritative next-convoy reward multiplier for a completed chain. */
  executionChainRewardMultiplier: number;
  sites: VaultFrontSiteState[];
  convoys: VaultFrontConvoyState[];
  beacons: VaultFrontBeaconState[];
  /** Execution chain state keyed by player small ID */
  executionChains: Record<number, VaultFrontExecutionChainState>;
  /** Comeback surge state keyed by player small ID */
  surges: Record<number, VaultFrontSurgeState>;
  /** Active squad objective windows (visible to all players) */
  squadObjectives: VaultFrontSquadObjectiveState[];
  /** Vault Pressure state keyed by player small ID. */
  pressure: Record<number, VaultFrontPressureState>;
}

export interface VaultFrontActivityUpdate {
  type: GameUpdateType.VaultFrontActivity;
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
    | "vault_breach_victory";
  tile: TileRef;
  sourcePlayerID: number | null;
  targetPlayerID: number | null;
  label: string;
  durationTicks: number;
}

export interface HeistExecutedUpdate {
  type: GameUpdateType.HeistExecuted;
  /** Small ID of the player who executed the heist */
  heistPlayerID: number;
  /** Small ID of the vault site controller whose gold was stolen */
  victimPlayerID: number | null;
  /** Gold extracted from the site (safe number) */
  goldStolen: number;
  tile: TileRef;
}

export interface BountyBoardActivatedUpdate {
  type: GameUpdateType.BountyBoardActivated;
  /** Small ID of the player who has a bounty on them */
  targetPlayerID: number;
  /** Gold reward for intercepting target's next convoy */
  rewardGold: number;
  /** Number of intercepts the bounty covers */
  chargesLeft: number;
  /** Tick at which the bounty expires */
  expiresAtTick: number;
}

export interface BountyCollectedUpdate {
  type: GameUpdateType.BountyCollected;
  /** Small ID of the collector */
  collectorPlayerID: number;
  /** Small ID of the bounty target */
  targetPlayerID: number;
  /** Gold paid out */
  rewardGold: number;
  /** Remaining charges */
  chargesLeft: number;
}

export interface WarchestHuntStartedUpdate {
  type: GameUpdateType.WarchestHuntStarted;
  /** Small ID of the marked player (gold leader at tick 500) */
  markPlayerID: number;
  /** Duration in ticks the hunt window lasts */
  durationTicks: number;
  /** Gold multiplier applied to intercepts targeting the mark's convoys */
  interceptMultiplier: number;
}

export type MapEventType =
  | "vault_bonanza"
  | "supply_disruption"
  | "intelligence_breach"
  | "gold_rush"
  | "siege_protocol"
  | "diplomatic_window";

export interface MapEventFiredUpdate {
  type: GameUpdateType.MapEventFired;
  eventType: MapEventType;
  durationTicks: number;
  startTick: number;
}

export interface MapEventExpiredUpdate {
  type: GameUpdateType.MapEventExpired;
  eventType: MapEventType;
}

export interface MissionCompleteUpdate {
  type: GameUpdateType.MissionComplete;
  playerID: number;
  objectiveText: string;
  bonusElo: number;
}
