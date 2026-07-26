export interface PostMatchSessionSnapshot {
  generation: number;
  active: boolean;
  timers: number;
  animationFrames: number;
  pendingTasks: number;
}

export type PostMatchSessionClosure = "hidden" | "superseded";
export type PostMatchTaskOutcome =
  "completed" | "timedOut" | "failed" | "cancelled";

export interface PostMatchSessionReceipt {
  schemaVersion: "1.0";
  generation: number;
  startedAt: number;
  endedAt: number;
  lifetimeMs: number;
  closure: PostMatchSessionClosure;
  degraded: boolean;
  tasks: {
    started: number;
    completed: readonly string[];
    timedOut: readonly string[];
    failed: readonly string[];
    cancelled: readonly string[];
  };
  resourcesCleared: {
    timers: number;
    animationFrames: number;
  };
}

type Clock = () => number;

export class PostMatchSessionScope {
  private active = true;
  private readonly timers = new Map<
    ReturnType<typeof setTimeout>,
    (() => void) | null
  >();
  private readonly animationFrames = new Set<number>();
  private readonly pendingTasks = new Map<number, string>();
  private readonly taskOutcomes: Record<PostMatchTaskOutcome, string[]> = {
    completed: [],
    timedOut: [],
    failed: [],
    cancelled: [],
  };
  private taskSequence = 0;
  private readonly startedAt: number;
  private finalReceipt: PostMatchSessionReceipt | null = null;

  constructor(
    readonly generation: number,
    private readonly now: Clock = Date.now,
  ) {
    this.startedAt = now();
  }

  isCurrent(): boolean {
    return this.active;
  }

  commit(callback: () => void): boolean {
    if (!this.active) return false;
    callback();
    return true;
  }

  timeout(callback: () => void, delayMs: number): void {
    if (!this.active) return;
    const handle = setTimeout(
      () => {
        this.timers.delete(handle);
        if (this.active) callback();
      },
      Math.max(0, delayMs),
    );
    this.timers.set(handle, null);
  }

  delay(delayMs: number): Promise<boolean> {
    if (!this.active) return Promise.resolve(false);
    return new Promise((resolve) => {
      const handle = setTimeout(
        () => {
          this.timers.delete(handle);
          resolve(this.active);
        },
        Math.max(0, delayMs),
      );
      this.timers.set(handle, () => resolve(false));
    });
  }

  animationFrame(callback: (now: number) => void): void {
    if (!this.active) return;
    const handle = requestAnimationFrame((now) => {
      this.animationFrames.delete(handle);
      if (this.active) callback(now);
    });
    this.animationFrames.add(handle);
  }

  async settle<T>(
    task: Promise<T>,
    deadlineMs: number,
    label = "optional-task",
  ): Promise<T | undefined> {
    if (!this.active) return undefined;
    const taskId = ++this.taskSequence;
    this.pendingTasks.set(taskId, label);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: T | undefined, outcome: PostMatchTaskOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(handle);
        this.timers.delete(handle);
        this.pendingTasks.delete(taskId);
        this.taskOutcomes[outcome].push(label);
        resolve(this.active && outcome === "completed" ? value : undefined);
      };
      const handle = setTimeout(
        () => finish(undefined, "timedOut"),
        Math.max(0, deadlineMs),
      );
      this.timers.set(handle, () => finish(undefined, "cancelled"));
      void task.then(
        (value) => finish(value, "completed"),
        () => finish(undefined, "failed"),
      );
    });
  }

  cancel(closure: PostMatchSessionClosure): PostMatchSessionReceipt {
    if (this.finalReceipt) return this.finalReceipt;
    const resourcesCleared = {
      timers: this.timers.size,
      animationFrames: this.animationFrames.size,
    };
    this.active = false;
    for (const [handle, resolveCanceled] of this.timers) {
      clearTimeout(handle);
      resolveCanceled?.();
    }
    this.timers.clear();
    for (const handle of this.animationFrames) cancelAnimationFrame(handle);
    this.animationFrames.clear();
    const endedAt = this.now();
    const tasks = {
      started: this.taskSequence,
      completed: Object.freeze([...this.taskOutcomes.completed]),
      timedOut: Object.freeze([...this.taskOutcomes.timedOut]),
      failed: Object.freeze([...this.taskOutcomes.failed]),
      cancelled: Object.freeze([...this.taskOutcomes.cancelled]),
    };
    this.finalReceipt = Object.freeze({
      schemaVersion: "1.0",
      generation: this.generation,
      startedAt: this.startedAt,
      endedAt,
      lifetimeMs: Math.max(0, endedAt - this.startedAt),
      closure,
      degraded:
        tasks.timedOut.length + tasks.failed.length + tasks.cancelled.length >
        0,
      tasks: Object.freeze(tasks),
      resourcesCleared: Object.freeze(resourcesCleared),
    });
    return this.finalReceipt;
  }

  snapshot(): PostMatchSessionSnapshot {
    return {
      generation: this.generation,
      active: this.active,
      timers: this.timers.size,
      animationFrames: this.animationFrames.size,
      pendingTasks: this.pendingTasks.size,
    };
  }
}

/** Owns one recap generation and issues one source-derived receipt on closure. */
export class PostMatchSessionOrchestrator {
  private generation = 0;
  private current: PostMatchSessionScope | null = null;
  private latestReceipt: PostMatchSessionReceipt | null = null;

  constructor(
    private readonly onReceipt?: (receipt: PostMatchSessionReceipt) => void,
    private readonly now: Clock = Date.now,
  ) {}

  begin(): PostMatchSessionScope {
    this.cancel("superseded");
    this.current = new PostMatchSessionScope(++this.generation, this.now);
    return this.current;
  }

  active(): PostMatchSessionScope | null {
    return this.current?.isCurrent() ? this.current : null;
  }

  cancel(closure: PostMatchSessionClosure = "hidden"): void {
    if (!this.current) return;
    this.latestReceipt = this.current.cancel(closure);
    this.current = null;
    try {
      this.onReceipt?.(this.latestReceipt);
    } catch {
      // Receipt consumers cannot compromise lifecycle cleanup.
    }
  }

  receipt(): PostMatchSessionReceipt | null {
    return this.latestReceipt;
  }

  snapshot(): PostMatchSessionSnapshot {
    return (
      this.current?.snapshot() ?? {
        generation: this.generation,
        active: false,
        timers: 0,
        animationFrames: 0,
        pendingTasks: 0,
      }
    );
  }
}
