import type { Player } from "../game/Game";
import type { Stats } from "../game/Stats";

/**
 * Deterministic pairwise revenge state. A victim earns one revenge counter
 * only by later intercepting the same player who most recently intercepted
 * their convoy.
 */
export class RivalryRevengeTracker {
  private readonly lastInterceptorByVictim = new Map<number, number>();

  record(interceptor: Player, victim: Player, stats: Stats): void {
    const interceptorID = interceptor.smallID();
    const victimID = victim.smallID();
    if (this.lastInterceptorByVictim.get(interceptorID) === victimID) {
      stats.vaultRivalryRevenge(interceptor);
      this.lastInterceptorByVictim.delete(interceptorID);
    }
    this.lastInterceptorByVictim.set(victimID, interceptorID);
  }
}
