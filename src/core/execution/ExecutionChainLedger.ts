import type {
  VaultFrontExecutionChainResetReason,
  VaultFrontExecutionChainState,
} from "../game/GameUpdates";

type ExecutionChainStep = 0 | 1 | 2;

export class ExecutionChainLedger {
  private readonly states = new Map<number, VaultFrontExecutionChainState>();

  seed(playerID: number): void {
    if (this.states.has(playerID)) return;
    this.states.set(playerID, {
      step: 0,
      expiresAtTick: 0,
      lastResetReason: null,
      lastResetTick: 0,
      lastResetFromStep: 0,
    });
  }

  step(playerID: number): ExecutionChainStep {
    return this.state(playerID).step;
  }

  isExpired(playerID: number, ticks: number): boolean {
    const state = this.state(playerID);
    return state.step > 0 && ticks > state.expiresAtTick;
  }

  matches(
    playerID: number,
    expectedStep: ExecutionChainStep,
    ticks: number,
  ): boolean {
    const state = this.state(playerID);
    return state.step === expectedStep && ticks <= state.expiresAtTick;
  }

  progress(
    playerID: number,
    step: ExecutionChainStep,
    expiresAtTick: number,
  ): void {
    const state = this.state(playerID);
    this.states.set(playerID, { ...state, step, expiresAtTick });
  }

  reset(
    playerID: number,
    reason: VaultFrontExecutionChainResetReason,
    ticks: number,
  ): void {
    const state = this.state(playerID);
    const recordsAttemptFromZero =
      reason === "delivery_out_of_order" ||
      reason === "pulse_deny_out_of_order";
    this.states.set(playerID, {
      ...state,
      step: 0,
      expiresAtTick: 0,
      ...(state.step > 0 || recordsAttemptFromZero
        ? {
            lastResetReason: reason,
            lastResetTick: ticks,
            lastResetFromStep: state.step,
          }
        : {}),
    });
  }

  project(): Record<number, VaultFrontExecutionChainState> {
    return Object.fromEntries(
      [...this.states].map(([playerID, state]) => [playerID, { ...state }]),
    );
  }

  private state(playerID: number): VaultFrontExecutionChainState {
    this.seed(playerID);
    return this.states.get(playerID)!;
  }
}
