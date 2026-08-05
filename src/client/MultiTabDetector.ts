export class MultiTabDetector {
  private readonly tabId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  private readonly lockKey = "multi-tab-lock";
  private readonly heartbeatIntervalMs = 1_000;
  private readonly staleThresholdMs = 3_000;

  private heartbeatTimer: number | null = null;
  private penaltyTimer: number | null = null;
  private listening = false;
  private isPunished = false;
  private punishmentCount = 0;
  private startPenaltyCallback: (duration: number) => void = () => {};
  private readonly storageHandler = (event: StorageEvent) =>
    this.onStorageEvent(event);
  private readonly beforeUnloadHandler = () => this.onBeforeUnload();

  public startMonitoring(startPenalty: (duration: number) => void): void {
    this.startPenaltyCallback = startPenalty;
    if (!this.listening) {
      window.addEventListener("storage", this.storageHandler);
      window.addEventListener("beforeunload", this.beforeUnloadHandler);
      this.listening = true;
    }
    if (this.heartbeatTimer !== null) return;
    this.writeLock();
    this.heartbeatTimer = window.setInterval(
      () => this.heartbeat(),
      this.heartbeatIntervalMs,
    );
  }

  public stopMonitoring(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.penaltyTimer !== null) {
      clearTimeout(this.penaltyTimer);
      this.penaltyTimer = null;
    }
    const lock = this.readLock();
    if (lock?.owner === this.tabId) localStorage.removeItem(this.lockKey);
    if (this.listening) {
      window.removeEventListener("storage", this.storageHandler);
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
      this.listening = false;
    }
    this.isPunished = false;
    this.startPenaltyCallback = () => {};
  }

  private heartbeat(): void {
    const now = Date.now();
    const lock = this.readLock();
    if (
      !lock ||
      lock.owner === this.tabId ||
      now - lock.timestamp > this.staleThresholdMs
    ) {
      this.writeLock();
      this.isPunished = false;
      return;
    }
    if (!this.isPunished) this.applyPunishment();
  }

  private onStorageEvent(event: StorageEvent): void {
    if (event.key !== this.lockKey || !event.newValue) return;
    const other = this.parseLock(event.newValue);
    if (!other) return;
    if (other.owner !== this.tabId && !this.isPunished) this.applyPunishment();
  }

  private onBeforeUnload(): void {
    const lock = this.readLock();
    if (lock?.owner === this.tabId) localStorage.removeItem(this.lockKey);
  }

  private applyPunishment(): void {
    this.isPunished = true;
    this.punishmentCount += 1;
    const delay = 10_000;
    this.startPenaltyCallback(delay);
    if (this.penaltyTimer !== null) clearTimeout(this.penaltyTimer);
    this.penaltyTimer = window.setTimeout(() => {
      this.penaltyTimer = null;
      this.isPunished = false;
    }, delay);
  }

  private writeLock(): void {
    localStorage.setItem(
      this.lockKey,
      JSON.stringify({ owner: this.tabId, timestamp: Date.now() }),
    );
  }

  private parseLock(raw: string): { owner: string; timestamp: number } | null {
    try {
      const value = JSON.parse(raw) as { owner?: unknown; timestamp?: unknown };
      if (
        typeof value.owner !== "string" ||
        value.owner.length === 0 ||
        value.owner.length > 128 ||
        typeof value.timestamp !== "number" ||
        !Number.isFinite(value.timestamp)
      ) {
        return null;
      }
      return { owner: value.owner, timestamp: value.timestamp };
    } catch {
      return null;
    }
  }

  private readLock(): { owner: string; timestamp: number } | null {
    const raw = localStorage.getItem(this.lockKey);
    return raw ? this.parseLock(raw) : null;
  }

  public debugStateForTest() {
    return {
      listening: this.listening,
      running: this.heartbeatTimer !== null,
      penaltyPending: this.penaltyTimer !== null,
      punishmentCount: this.punishmentCount,
    };
  }
}
