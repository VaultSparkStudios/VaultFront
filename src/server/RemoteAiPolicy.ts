import { AiDeadlineError, withAiDeadline } from "./CanonicalAiEvidence";

/**
 * Process-local cost firewall for optional remote AI features.
 *
 * Remote calls are disabled unless both an explicit enable flag and a positive
 * hourly cap are present. This keeps the public/default profile cost-neutral
 * even when a provider key is available in the runtime environment.
 */

export type RemoteAiFeature =
  | "narrator"
  | "coach"
  | "briefing"
  | "debrief"
  | "diplomacy"
  | "intel"
  | "tournament"
  | "other";

export interface RemoteAiPosture {
  enabled: boolean;
  keyConfigured: boolean;
  maxCallsPerHour: number;
  callsUsed: number;
  callsRemaining: number;
  enforcementScope: "process-local-per-worker";
  windowStartedAt: number;
  callsByFeature: Readonly<Partial<Record<RemoteAiFeature, number>>>;
  providerBoundReservations: number;
  deniedReservations: number;
  completedCalls: number;
  failedCalls: number;
  timedOutCalls: number;
  cancelledCalls: number;
  costProfile: "cost-neutral" | "metered-hard-cap";
  reason: "disabled" | "missing-key" | "zero-cap" | "ready" | "cap-exhausted";
}

interface WindowState {
  startedAt: number;
  calls: number;
  deniedReservations: number;
  byFeature: Partial<Record<RemoteAiFeature, number>>;
  completedCalls: number;
  failedCalls: number;
  timedOutCalls: number;
  cancelledCalls: number;
}

const HOUR_MS = 60 * 60 * 1000;
const MAX_CONFIGURABLE_CALLS_PER_HOUR = 500;
let state: WindowState = {
  startedAt: Date.now(),
  calls: 0,
  deniedReservations: 0,
  byFeature: {},
  completedCalls: 0,
  failedCalls: 0,
  timedOutCalls: 0,
  cancelledCalls: 0,
};

function configuredCap(env: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(
    env.VAULTFRONT_REMOTE_AI_MAX_CALLS_PER_HOUR ?? "0",
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_CONFIGURABLE_CALLS_PER_HOUR);
}

function refreshWindow(now: number): void {
  if (now - state.startedAt >= HOUR_MS || now < state.startedAt) {
    state = {
      startedAt: now,
      calls: 0,
      deniedReservations: 0,
      byFeature: {},
      completedCalls: 0,
      failedCalls: 0,
      timedOutCalls: 0,
      cancelledCalls: 0,
    };
  }
}

export function remoteAiPosture(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): RemoteAiPosture {
  refreshWindow(now);
  const enabled = env.VAULTFRONT_REMOTE_AI_ENABLED === "true";
  const keyConfigured = Boolean(env.ANTHROPIC_API_KEY);
  const maxCallsPerHour = configuredCap(env);
  const callsRemaining = Math.max(0, maxCallsPerHour - state.calls);

  let reason: RemoteAiPosture["reason"] = "ready";
  if (!enabled) reason = "disabled";
  else if (!keyConfigured) reason = "missing-key";
  else if (maxCallsPerHour === 0) reason = "zero-cap";
  else if (callsRemaining === 0) reason = "cap-exhausted";

  const available = reason === "ready";
  return {
    enabled,
    keyConfigured,
    maxCallsPerHour,
    callsUsed: state.calls,
    callsRemaining,
    enforcementScope: "process-local-per-worker",
    windowStartedAt: state.startedAt,
    callsByFeature: { ...state.byFeature },
    providerBoundReservations: state.calls,
    deniedReservations: state.deniedReservations,
    completedCalls: state.completedCalls,
    failedCalls: state.failedCalls,
    timedOutCalls: state.timedOutCalls,
    cancelledCalls: state.cancelledCalls,
    costProfile: available ? "metered-hard-cap" : "cost-neutral",
    reason,
  };
}

/** Cheap guard for queueing/UI paths; it does not consume budget. */
export function canAttemptRemoteAi(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return remoteAiPosture(env).reason === "ready";
}

/** Reserve exactly one provider call immediately before invoking the SDK. */
export function reserveRemoteAiCall(
  feature: RemoteAiFeature,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): { allowed: boolean; posture: RemoteAiPosture } {
  const posture = remoteAiPosture(env, now);
  if (posture.reason !== "ready") {
    state.deniedReservations += 1;
    return { allowed: false, posture: remoteAiPosture(env, now) };
  }

  state.calls += 1;
  state.byFeature[feature] = (state.byFeature[feature] ?? 0) + 1;
  return { allowed: true, posture: remoteAiPosture(env, now) };
}

/**
 * Execute one already-reserved provider call through the canonical bounded
 * cancellation boundary. Reservations are never refunded: the outcome
 * counters explain what happened after provider-bound capacity was consumed.
 */
export async function executeReservedRemoteAiCall<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  try {
    const result = await withAiDeadline(operation, timeoutMs, parentSignal);
    state.completedCalls += 1;
    return result;
  } catch (error) {
    if (error instanceof AiDeadlineError) {
      state.timedOutCalls += 1;
    } else if (
      parentSignal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      state.cancelledCalls += 1;
    } else {
      state.failedCalls += 1;
    }
    throw error;
  }
}

export function remoteAiUsageByFeature(): Readonly<
  Partial<Record<RemoteAiFeature, number>>
> {
  return { ...state.byFeature };
}

/** Test-only reset; intentionally explicit so production code cannot refund calls. */
export function resetRemoteAiPolicyForTests(now = Date.now()): void {
  state = {
    startedAt: now,
    calls: 0,
    deniedReservations: 0,
    byFeature: {},
    completedCalls: 0,
    failedCalls: 0,
    timedOutCalls: 0,
    cancelledCalls: 0,
  };
}
