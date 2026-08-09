/**
 * Bounded, process-local server-process crash telemetry (S99 second-order
 * follow-up to audit #183: client crashes are captured and queryable via
 * ClientCrashStore, but a Worker/Master process crash previously only
 * produced an unstructured log line with no structured record or summary).
 */
export interface ServerCrashEvent {
  process: "worker" | "master";
  processId: number | null;
  kind: "uncaughtException" | "unhandledRejection";
  message: string;
  at: number;
}

const MAX_RETAINED = 500;
const MAX_MESSAGE_LENGTH = 500;

export function truncateServerCrashMessage(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH)}...`
    : message;
}

export class ServerCrashStore {
  private events: ServerCrashEvent[] = [];

  record(event: ServerCrashEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_RETAINED) {
      this.events.splice(0, this.events.length - MAX_RETAINED);
    }
  }

  summary() {
    const byMessage = new Map<string, number>();
    for (const event of this.events) {
      const key = `${event.process}:${event.kind}:${event.message}`;
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

export const serverCrashStore = new ServerCrashStore();
