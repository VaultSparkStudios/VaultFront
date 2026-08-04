export interface TelemetryHandle {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface TelemetryShutdownReport {
  attempted: number;
  completed: number;
  failures: string[];
  timedOut: boolean;
}

const handles = new Map<string, TelemetryHandle>();
let activeShutdown: Promise<TelemetryShutdownReport> | null = null;

export function registerTelemetryHandle(
  name: string,
  handle: TelemetryHandle,
): () => void {
  if (handles.has(name))
    throw new Error(`telemetry handle already registered: ${name}`);
  handles.set(name, handle);
  return () => handles.delete(name);
}

async function drain(
  handlesSnapshot: [string, TelemetryHandle][],
): Promise<TelemetryShutdownReport> {
  const failures: string[] = [];
  let completed = 0;
  for (const [name, handle] of handlesSnapshot) {
    let failed = false;
    try {
      await handle.forceFlush();
    } catch (error) {
      failed = true;
      failures.push(
        `${name}.forceFlush: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      await handle.shutdown();
    } catch (error) {
      failed = true;
      failures.push(
        `${name}.shutdown: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!failed) completed += 1;
  }
  return {
    attempted: handlesSnapshot.length,
    completed,
    failures,
    timedOut: false,
  };
}

export function shutdownTelemetry(
  timeoutMs = 5_000,
): Promise<TelemetryShutdownReport> {
  if (activeShutdown) return activeShutdown;
  const snapshot = [...handles.entries()];
  activeShutdown = new Promise<TelemetryShutdownReport>((resolve) => {
    const timer = setTimeout(
      () =>
        resolve({
          attempted: snapshot.length,
          completed: 0,
          failures: ["telemetry shutdown exceeded bounded deadline"],
          timedOut: true,
        }),
      timeoutMs,
    );
    void drain(snapshot).then((report) => {
      clearTimeout(timer);
      resolve(report);
    });
  });
  return activeShutdown;
}

export function resetTelemetryLifecycleForTests(): void {
  handles.clear();
  activeShutdown = null;
}
