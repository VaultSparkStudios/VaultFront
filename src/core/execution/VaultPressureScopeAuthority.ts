import { Game, Player } from "../game/Game";
import { VaultFrontPressureState } from "../game/GameUpdates";
import {
  DEFAULT_VAULT_PRESSURE_CONFIG,
  deliverToVaultPressure,
  expireVaultPressureWindow,
  initialVaultPressureState,
  projectVaultPressure,
  type VaultPressureKernelState,
  type VaultPressureTransition,
} from "./VaultPressureKernel";

export interface VaultPressureScope {
  key: string;
  kind: "player" | "team";
  memberIDs: number[];
}

/** Owns the mapping between competitive sides and the pure pressure kernel. */
export class VaultPressureScopeAuthority {
  private readonly scopeStates = new Map<string, VaultPressureKernelState>();
  private readonly contributors = new Map<string, Map<number, number>>();

  constructor(
    private readonly game: Game,
    private readonly playerProjection: Map<number, VaultPressureKernelState>,
  ) {}

  seed(players = this.players()): void {
    for (const player of players) {
      if (!this.playerProjection.has(player.smallID())) {
        this.playerProjection.set(
          player.smallID(),
          initialVaultPressureState(),
        );
      }
    }
    this.ensureScopes();
  }

  deliver(
    owner: Player,
    ticks: number,
  ): { scope: VaultPressureScope; transition: VaultPressureTransition } {
    this.ensureScopes();
    const scope = this.scope(owner);
    const transition = deliverToVaultPressure(
      this.scopeStates.get(scope.key) ?? initialVaultPressureState(),
      ticks,
    );
    this.scopeStates.set(scope.key, transition.state);
    this.syncProjection(scope, transition.state);
    const contributions =
      this.contributors.get(scope.key) ?? new Map<number, number>();
    contributions.set(
      owner.smallID(),
      (contributions.get(owner.smallID()) ?? 0) + 1,
    );
    this.contributors.set(scope.key, contributions);
    return { scope, transition };
  }

  expire(ticks: number): void {
    this.ensureScopes();
    for (const [scopeKey, state] of this.scopeStates) {
      const transition = expireVaultPressureWindow(state, ticks);
      this.scopeStates.set(scopeKey, transition.state);
      const scope = this.players()
        .map((player) => this.scope(player))
        .find((candidate) => candidate.key === scopeKey);
      if (!scope) throw new Error(`Unknown Vault Pressure scope: ${scopeKey}`);
      this.syncProjection(scope, transition.state);
    }
  }

  project(ticks: number): Record<number, VaultFrontPressureState> {
    this.ensureScopes();
    return Object.fromEntries(
      this.players().map((player) => {
        const scope = this.scope(player);
        const state =
          this.scopeStates.get(scope.key) ??
          this.playerProjection.get(player.smallID()) ??
          initialVaultPressureState();
        return [
          player.smallID(),
          {
            ...projectVaultPressure(
              state,
              ticks,
              DEFAULT_VAULT_PRESSURE_CONFIG,
            ),
            scope: scope.kind,
            scopeKey: scope.key,
            contributors: Object.fromEntries(
              this.contributors.get(scope.key)?.entries() ?? [],
            ),
          },
        ];
      }),
    );
  }

  private players(): Player[] {
    const source = this.game as Game & { players?: () => Player[] };
    return typeof source.allPlayers === "function"
      ? [...source.allPlayers()]
      : (source.players?.() ?? []);
  }

  private scope(owner: Player): VaultPressureScope {
    const team = typeof owner.team === "function" ? owner.team() : null;
    const memberIDs =
      team === null
        ? [owner.smallID()]
        : this.players()
            .filter((player) => player.team() === team)
            .map((player) => player.smallID())
            .sort((a, b) => a - b);
    return {
      key: team === null ? `player:${owner.smallID()}` : `team:${team}`,
      kind: team === null ? "player" : "team",
      memberIDs,
    };
  }

  private ensureScopes(): void {
    for (const player of this.players()) {
      const scope = this.scope(player);
      if (this.scopeStates.has(scope.key)) continue;
      const inherited =
        scope.memberIDs
          .map((id) => this.playerProjection.get(id))
          .find((state) => state !== undefined) ?? initialVaultPressureState();
      this.scopeStates.set(scope.key, inherited);
      this.syncProjection(scope, inherited);
    }
  }

  private syncProjection(
    scope: VaultPressureScope,
    state: VaultPressureKernelState,
  ): void {
    for (const playerID of scope.memberIDs) {
      this.playerProjection.set(playerID, state);
    }
  }
}
