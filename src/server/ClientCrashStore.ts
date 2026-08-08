/**
 * Privacy-minimal, process-local client crash/error telemetry (S99 audit
 * #183). No raw stack text, URLs, or PII ever cross the wire or get stored
 * -- only a bounded message, a stack digest, and gameplay context (tick,
 * gameId) the client itself already has.
 */
export interface ClientCrashEvent {
  actorKey: string;
  kind: "error" | "unhandledrejection";
  message: string;
  stackHash: string | null;
  tick: number | null;
  gameId: string | null;
  at: number;
}

const MAX_RETAINED = 500;

export class ClientCrashStore {
  private events: ClientCrashEvent[] = [];

  record(event: ClientCrashEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_RETAINED) {
      this.events.splice(0, this.events.length - MAX_RETAINED);
    }
  }

  summary() {
    const byMessage = new Map<string, number>();
    for (const event of this.events) {
      const key = `${event.kind}:${event.message}`;
      byMessage.set(key, (byMessage.get(key) ?? 0) + 1);
    }
    return {
      generatedAt: Date.now(),
      storage: "process-local" as const,
      total: this.events.length,
      topSignatures: [...byMessage.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([signature, count]) => ({ signature, count })),
    };
  }
}

export const clientCrashStore = new ClientCrashStore();
