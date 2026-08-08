import { reportClientCrash } from "./Api";

/**
 * S99 audit #183: global client crash/error beacon. ClientGameRunner's
 * tick/render loop has no window.onerror or unhandledrejection listener, so
 * a mid-match bug in a rendering layer previously produced zero telemetry --
 * the player just saw a frozen game. This never sends raw stack text, only
 * a short bounded message and an FNV-1a digest of the stack for grouping.
 */

function hashStack(stack: string): string {
  let hash = 2166136261;
  for (let index = 0; index < stack.length; index += 1) {
    hash ^= stack.charCodeAt(index);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const MAX_MESSAGE_LENGTH = 500;
let installed = false;

function truncate(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH
    ? message.slice(0, MAX_MESSAGE_LENGTH)
    : message;
}

export function installClientCrashReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    void reportClientCrash({
      kind: "error",
      message: truncate(event.message || "unknown error"),
      stackHash: event.error?.stack ? hashStack(event.error.stack) : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "unhandled rejection";
    const stack = reason instanceof Error ? reason.stack : undefined;
    void reportClientCrash({
      kind: "unhandledrejection",
      message: truncate(message),
      stackHash: stack ? hashStack(stack) : undefined,
    });
  });
}

export const __testables = { hashStack, truncate };
