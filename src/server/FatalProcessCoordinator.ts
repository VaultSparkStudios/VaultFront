import type { NextFunction, Request, RequestHandler, Response } from "express";

export type FatalProcessKind = "uncaughtException" | "unhandledRejection";

export interface FatalProcessEvent {
  process: "master" | "worker";
  processId: number | null;
  kind: FatalProcessKind;
  message: string;
  at: number;
}

interface FatalProcessCoordinatorDependencies {
  process: FatalProcessEvent["process"];
  processId?: number | null;
  timeoutMs?: number;
  now?: () => number;
  record(event: FatalProcessEvent): void;
  stopAdmission(): void;
  drain(): Promise<void>;
  exportCrash(): Promise<void>;
  exit(code: 1): void;
  reportFailure?(phase: string, error: unknown): void;
}

const DEFAULT_FATAL_TIMEOUT_MS = 6_000;
const HEALTH_PATHS = new Set(["/_health", "/api/vaultfront/readiness"]);

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function boundedMessage(reason: unknown): string {
  const message = errorMessage(reason);
  return message.length > 500 ? `${message.slice(0, 500)}...` : message;
}

/**
 * Owns the one-way transition from an accepting server process to a bounded,
 * fail-closed fatal drain. The injected edges make the authority testable
 * without installing process listeners or terminating the test runner.
 */
export class FatalProcessCoordinator {
  private accepting = true;
  private fatalRun: Promise<void> | null = null;
  private exitRequested = false;

  constructor(
    private readonly dependencies: FatalProcessCoordinatorDependencies,
  ) {}

  isAccepting(): boolean {
    return this.accepting;
  }

  admissionMiddleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (this.accepting || HEALTH_PATHS.has(req.path)) {
        next();
        return;
      }
      res.status(503).json({
        error: "Server process is draining after a fatal error",
        code: "fatal-process-draining",
      });
    };
  }

  handleFatal(kind: FatalProcessKind, reason: unknown): Promise<void> {
    if (this.fatalRun) return this.fatalRun;

    this.accepting = false;
    const event: FatalProcessEvent = {
      process: this.dependencies.process,
      processId: this.dependencies.processId ?? null,
      kind,
      message: boundedMessage(reason),
      at: (this.dependencies.now ?? Date.now)(),
    };

    try {
      this.dependencies.record(event);
    } catch (error) {
      this.dependencies.reportFailure?.("record", error);
    }
    try {
      this.dependencies.stopAdmission();
    } catch (error) {
      this.dependencies.reportFailure?.("stop-admission", error);
    }

    this.fatalRun = this.finishFatalDrain();
    return this.fatalRun;
  }

  private async finishFatalDrain(): Promise<void> {
    const work = Promise.allSettled([
      Promise.resolve().then(() => this.dependencies.drain()),
      Promise.resolve().then(() => this.dependencies.exportCrash()),
    ]).then((results) => {
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") {
          this.dependencies.reportFailure?.(
            index === 0 ? "drain" : "export-crash",
            result.reason,
          );
        }
      }
    });

    const timeoutMs = Math.max(
      1,
      this.dependencies.timeoutMs ?? DEFAULT_FATAL_TIMEOUT_MS,
    );
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
      void work.finally(() => {
        clearTimeout(timer);
        resolve();
      });
    });

    if (!this.exitRequested) {
      this.exitRequested = true;
      this.dependencies.exit(1);
    }
  }
}
