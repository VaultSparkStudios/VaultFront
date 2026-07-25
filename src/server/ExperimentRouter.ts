import { z } from "zod";
import { ExperimentIntegrityGate } from "./ExperimentIntegrity";

type RouteHandler = (req: any, res: any) => unknown;

export interface ExperimentRouteApp {
  get(path: string, ...handlers: RouteHandler[]): unknown;
  post(path: string, ...handlers: RouteHandler[]): unknown;
}

type ExperimentPolicyId =
  | "experiment-dock-event"
  | "experiment-recap-event"
  | "experiment-runtime-event"
  | "experiment-outcome-observation";

export interface ExperimentRouterDependencies {
  resolveIdentity(req: any): Promise<string | null>;
  resolveActor(req: any): Promise<{ persistentId: string } | null>;
  authorize(
    policyId: ExperimentPolicyId,
    context: { hasVerifiedActor: boolean },
    res: any,
  ): boolean;
  assertPolicyBinding(
    policyId: ExperimentPolicyId,
    method: "POST",
    path: string,
  ): void;
  isAdmin(req: any): boolean;
}

const DockVariantSchema = z.enum(["top", "stack"]);
const RecapVariantSchema = z.enum(["goal_focus", "requeue_focus"]);
const RuntimeRewardVariantSchema = z.enum(["control", "high_risk_high_reward"]);
const RuntimeHudVariantSchema = z.enum(["default", "mobile_priority"]);
const ExperimentEventIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const EventNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/);

const DockEventSchema = z.object({
  eventId: ExperimentEventIdSchema,
  event: EventNameSchema,
  variant: DockVariantSchema.optional(),
  value: z.literal(1).default(1),
});
const RecapEventSchema = z.object({
  eventId: ExperimentEventIdSchema,
  event: EventNameSchema,
  variant: RecapVariantSchema.optional(),
  value: z.literal(1).default(1),
});
const RuntimeEventSchema = z.object({
  eventId: ExperimentEventIdSchema,
  event: EventNameSchema,
  rewardVariant: RuntimeRewardVariantSchema.optional(),
  hudVariant: RuntimeHudVariantSchema.optional(),
  value: z.literal(1).default(1),
});
const OutcomeTelemetrySchema = z
  .object({
    eventId: ExperimentEventIdSchema,
    gameId: z.string().min(1).max(64),
    recapCtaVariant: RecapVariantSchema.optional(),
    recapCtaClicked: z.boolean().optional(),
    requeueClicked: z.boolean().optional(),
    hud: z.object({
      vaultNoticeJumps: z.number().int().min(0).max(10_000),
      objectiveRailClicks: z.number().int().min(0).max(10_000),
      timelineJumps: z.number().int().min(0).max(10_000),
    }),
  })
  .strict();

type DockVariant = z.infer<typeof DockVariantSchema>;
type RecapVariant = z.infer<typeof RecapVariantSchema>;
type RuntimeRewardVariant = z.infer<typeof RuntimeRewardVariantSchema>;
type RuntimeHudVariant = z.infer<typeof RuntimeHudVariantSchema>;
type OutcomeTelemetry = z.infer<typeof OutcomeTelemetrySchema>;

interface Assignment<T extends string> {
  experimentId: T;
  assignedAt: number;
}
interface DockAssignment extends Assignment<"dock_layout_v1"> {
  variant: DockVariant;
}
interface RecapAssignment extends Assignment<"recap_cta_v1"> {
  variant: RecapVariant;
}
interface RuntimeAssignment extends Assignment<"vault_runtime_v1"> {
  rewardVariant: RuntimeRewardVariant;
  hudVariant: RuntimeHudVariant;
}
interface EventStats {
  assignedUsers: number;
  events: Record<string, number>;
  eventHistory: Array<{ at: number; event: string; value: number }>;
}
interface RuntimeStats {
  assignedUsers: number;
  events: Record<string, number>;
}
interface OutcomeBucket {
  observations: number;
  hudTotals: {
    vaultNoticeJumps: number;
    objectiveRailClicks: number;
    timelineJumps: number;
  };
  recapCtaClicks: number;
  requeueClicks: number;
  recapVariant: Record<RecapVariant, number>;
}

const OBJECTIVE_EVENTS = new Set([
  "leaderboard_open_top",
  "leaderboard_open_stack",
  "team_leaderboard_open_top",
  "team_leaderboard_open_stack",
  "hud_objective_rail_click",
  "hud_vault_notice_jump",
  "hud_timeline_jump",
]);
const EVENT_HISTORY_LIMIT = 800;
const TREND_WINDOW_MS = 5 * 60 * 1000;
const GUARDRAIL_MIN_ASSIGNED = 60;
const GUARDRAIL_MIN_OBJECTIVE_EVENTS = 40;
const EXPERIMENT_STORAGE_POSTURE = Object.freeze({
  assignments: "process-local",
  aggregates: "process-local",
  resetBoundary: "worker-restart",
});

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function emptyOutcomeBucket(): OutcomeBucket {
  return {
    observations: 0,
    hudTotals: {
      vaultNoticeJumps: 0,
      objectiveRailClicks: 0,
      timelineJumps: 0,
    },
    recapCtaClicks: 0,
    requeueClicks: 0,
    recapVariant: { goal_focus: 0, requeue_focus: 0 },
  };
}

export class ExperimentControlPlane {
  private readonly dockAssignments = new Map<string, DockAssignment>();
  private readonly recapAssignments = new Map<string, RecapAssignment>();
  private readonly runtimeAssignments = new Map<string, RuntimeAssignment>();
  private readonly dockStats = new Map<DockVariant, EventStats>([
    ["top", { assignedUsers: 0, events: {}, eventHistory: [] }],
    ["stack", { assignedUsers: 0, events: {}, eventHistory: [] }],
  ]);
  private readonly recapStats = new Map<RecapVariant, EventStats>([
    ["goal_focus", { assignedUsers: 0, events: {}, eventHistory: [] }],
    ["requeue_focus", { assignedUsers: 0, events: {}, eventHistory: [] }],
  ]);
  private readonly runtimeRewardStats = new Map<
    RuntimeRewardVariant,
    RuntimeStats
  >([
    ["control", { assignedUsers: 0, events: {} }],
    ["high_risk_high_reward", { assignedUsers: 0, events: {} }],
  ]);
  private readonly runtimeHudStats = new Map<RuntimeHudVariant, RuntimeStats>([
    ["default", { assignedUsers: 0, events: {} }],
    ["mobile_priority", { assignedUsers: 0, events: {} }],
  ]);
  private readonly outcomeBuckets = new Map<string, OutcomeBucket>();
  private readonly integrity = new ExperimentIntegrityGate();

  integritySnapshot() {
    return this.integrity.snapshot();
  }

  ensureDockAssignment(identity: string): DockAssignment {
    const existing = this.dockAssignments.get(identity);
    if (existing) return existing;
    const variant: DockVariant =
      stableHash(identity) % 2 === 0 ? "top" : "stack";
    const assignment: DockAssignment = {
      experimentId: "dock_layout_v1",
      variant,
      assignedAt: Date.now(),
    };
    this.dockAssignments.set(identity, assignment);
    this.dockStats.get(variant)!.assignedUsers += 1;
    return assignment;
  }

  ensureRecapAssignment(identity: string): RecapAssignment {
    const existing = this.recapAssignments.get(identity);
    if (existing) return existing;
    const variant: RecapVariant =
      stableHash(`${identity}:recap`) % 2 === 0
        ? "goal_focus"
        : "requeue_focus";
    const assignment: RecapAssignment = {
      experimentId: "recap_cta_v1",
      variant,
      assignedAt: Date.now(),
    };
    this.recapAssignments.set(identity, assignment);
    this.recapStats.get(variant)!.assignedUsers += 1;
    return assignment;
  }

  ensureRuntimeAssignment(identity: string): RuntimeAssignment {
    const existing = this.runtimeAssignments.get(identity);
    if (existing) return existing;
    const rewardVariant: RuntimeRewardVariant =
      stableHash(`${identity}:vault_runtime:reward`) % 2 === 0
        ? "control"
        : "high_risk_high_reward";
    const hudVariant: RuntimeHudVariant =
      stableHash(`${identity}:vault_runtime:hud`) % 2 === 0
        ? "default"
        : "mobile_priority";
    const assignment: RuntimeAssignment = {
      experimentId: "vault_runtime_v1",
      rewardVariant,
      hudVariant,
      assignedAt: Date.now(),
    };
    this.runtimeAssignments.set(identity, assignment);
    this.runtimeRewardStats.get(rewardVariant)!.assignedUsers += 1;
    this.runtimeHudStats.get(hudVariant)!.assignedUsers += 1;
    return assignment;
  }

  checkDockEvent(identity: string, input: z.infer<typeof DockEventSchema>) {
    const assignment = this.ensureDockAssignment(identity);
    const verdict = this.integrity.check({
      eventId: `dock:${input.eventId}`,
      value: input.value,
      serverVariants: [assignment.variant],
      clientVariants: [input.variant],
    });
    if (!verdict.ok) return verdict;
    this.recordEvent(this.dockStats.get(assignment.variant)!, input);
    return { ok: true as const, assignment };
  }

  checkRecapEvent(identity: string, input: z.infer<typeof RecapEventSchema>) {
    const assignment = this.ensureRecapAssignment(identity);
    const verdict = this.integrity.check({
      eventId: `recap:${input.eventId}`,
      value: input.value,
      serverVariants: [assignment.variant],
      clientVariants: [input.variant],
    });
    if (!verdict.ok) return verdict;
    this.recordEvent(this.recapStats.get(assignment.variant)!, input);
    return { ok: true as const, assignment };
  }

  checkRuntimeEvent(
    identity: string,
    input: z.infer<typeof RuntimeEventSchema>,
  ) {
    const assignment = this.ensureRuntimeAssignment(identity);
    const verdict = this.integrity.check({
      eventId: `runtime:${input.eventId}`,
      value: input.value,
      serverVariants: [assignment.rewardVariant, assignment.hudVariant],
      clientVariants: [input.rewardVariant, input.hudVariant],
    });
    if (!verdict.ok) return verdict;
    for (const stats of [
      this.runtimeRewardStats.get(assignment.rewardVariant),
      this.runtimeHudStats.get(assignment.hudVariant),
    ]) {
      if (stats)
        stats.events[input.event] =
          (stats.events[input.event] ?? 0) + input.value;
    }
    return { ok: true as const, assignment };
  }

  dockSummary() {
    const top = this.dockStats.get("top")!;
    const stack = this.dockStats.get("stack")!;
    return {
      experimentId: "dock_layout_v1" as const,
      storage: EXPERIMENT_STORAGE_POSTURE,
      generatedAt: Date.now(),
      variants: { top, stack },
      assignedTotal: top.assignedUsers + stack.assignedUsers,
      guardrail: this.buildDockGuardrail(top, stack),
      integrity: this.integrity.snapshot(),
    };
  }

  recapSummary() {
    const goal = this.recapStats.get("goal_focus")!;
    const requeue = this.recapStats.get("requeue_focus")!;
    const goalClicks =
      (goal.events.recap_goal_click ?? 0) + (goal.events.recap_goal_saved ?? 0);
    const requeueClicks = requeue.events.recap_requeue_click ?? 0;
    return {
      experimentId: "recap_cta_v1" as const,
      storage: EXPERIMENT_STORAGE_POSTURE,
      generatedAt: Date.now(),
      assignedTotal: goal.assignedUsers + requeue.assignedUsers,
      variants: { goal_focus: goal, requeue_focus: requeue },
      cta: {
        goalFocusRate: Number(
          (goal.assignedUsers > 0
            ? goalClicks / goal.assignedUsers
            : 0
          ).toFixed(4),
        ),
        requeueFocusRate: Number(
          (requeue.assignedUsers > 0
            ? requeueClicks / requeue.assignedUsers
            : 0
          ).toFixed(4),
        ),
      },
      integrity: this.integrity.snapshot(),
    };
  }

  runtimeSummary() {
    return {
      experimentId: "vault_runtime_v1" as const,
      storage: EXPERIMENT_STORAGE_POSTURE,
      generatedAt: Date.now(),
      rewardVariants: Object.fromEntries(this.runtimeRewardStats.entries()),
      hudVariants: Object.fromEntries(this.runtimeHudStats.entries()),
      integrity: this.integrity.snapshot(),
    };
  }

  unifiedSummary() {
    const dock = this.dockSummary();
    const recap = this.recapSummary();
    return {
      generatedAt: Date.now(),
      storage: EXPERIMENT_STORAGE_POSTURE,
      integrity: this.integrity.snapshot(),
      experiments: [
        {
          id: "dock_layout_v1",
          description: "Dock layout: top vs stack",
          variants: {
            top: {
              users: dock.variants.top.assignedUsers,
              events: dock.variants.top.events,
            },
            stack: {
              users: dock.variants.stack.assignedUsers,
              events: dock.variants.stack.events,
            },
          },
        },
        {
          id: "recap_cta_v1",
          description: "Win recap CTA: goal_focus vs requeue_focus",
          variants: {
            goal_focus: {
              users: recap.variants.goal_focus.assignedUsers,
              events: recap.variants.goal_focus.events,
            },
            requeue_focus: {
              users: recap.variants.requeue_focus.assignedUsers,
              events: recap.variants.requeue_focus.events,
            },
          },
        },
        {
          id: "vault_runtime_v1",
          description: "Runtime reward and HUD variants",
          rewardVariants: Object.fromEntries(
            [...this.runtimeRewardStats.entries()].map(([key, value]) => [
              key,
              { users: value.assignedUsers, events: value.events },
            ]),
          ),
          hudVariants: Object.fromEntries(
            [...this.runtimeHudStats.entries()].map(([key, value]) => [
              key,
              { users: value.assignedUsers, events: value.events },
            ]),
          ),
        },
      ],
    };
  }

  recordOutcome(identity: string, telemetry: OutcomeTelemetry) {
    const assignment = this.ensureRecapAssignment(identity);
    const verdict = this.integrity.check({
      eventId: `outcome:${telemetry.gameId}:${telemetry.eventId}`,
      value: 1,
      serverVariants: [assignment.variant],
      clientVariants: [telemetry.recapCtaVariant],
    });
    if (!verdict.ok) return verdict;
    const bucketKey = assignment.variant;
    for (const key of ["all", bucketKey]) {
      const target = this.outcomeBuckets.get(key) ?? emptyOutcomeBucket();
      this.outcomeBuckets.set(key, target);
      target.observations += 1;
      target.hudTotals.vaultNoticeJumps += telemetry.hud.vaultNoticeJumps;
      target.hudTotals.objectiveRailClicks += telemetry.hud.objectiveRailClicks;
      target.hudTotals.timelineJumps += telemetry.hud.timelineJumps;
      if (telemetry.recapCtaClicked) target.recapCtaClicks += 1;
      if (telemetry.requeueClicked) target.requeueClicks += 1;
      target.recapVariant[assignment.variant] += 1;
    }
    return { ok: true as const, bucketKey, assignment };
  }

  outcomeSummary() {
    const all = this.outcomeBuckets.get("all") ?? emptyOutcomeBucket();
    const rate = (count: number, observations: number) =>
      observations > 0 ? Number((count / observations).toFixed(4)) : 0;
    const perObservation = (count: number, observations: number) =>
      observations > 0 ? Number((count / observations).toFixed(3)) : 0;
    const summarize = ([key, value]: [string, OutcomeBucket]) => ({
      key,
      observations: value.observations,
      hudPerObservation: {
        vaultNoticeJumps: perObservation(
          value.hudTotals.vaultNoticeJumps,
          value.observations,
        ),
        objectiveRailClicks: perObservation(
          value.hudTotals.objectiveRailClicks,
          value.observations,
        ),
        timelineJumps: perObservation(
          value.hudTotals.timelineJumps,
          value.observations,
        ),
      },
      recapCtaRate: rate(value.recapCtaClicks, value.observations),
      requeueRate: rate(value.requeueClicks, value.observations),
      recapVariant: value.recapVariant,
    });
    return {
      generatedAt: Date.now(),
      storage: EXPERIMENT_STORAGE_POSTURE,
      evidence: "authenticated-client-interaction" as const,
      excludes: ["win", "match-duration", "behind-at-minute-8"] as const,
      totals: {
        observations: all.observations,
        recapCtaRate: rate(all.recapCtaClicks, all.observations),
        requeueRate: rate(all.requeueClicks, all.observations),
        hudPerObservation: {
          vaultNoticeJumps: perObservation(
            all.hudTotals.vaultNoticeJumps,
            all.observations,
          ),
          objectiveRailClicks: perObservation(
            all.hudTotals.objectiveRailClicks,
            all.observations,
          ),
          timelineJumps: perObservation(
            all.hudTotals.timelineJumps,
            all.observations,
          ),
        },
      },
      buckets: [...this.outcomeBuckets.entries()]
        .filter(([key]) => key !== "all")
        .map(summarize),
    };
  }
  private recordEvent(
    stats: EventStats,
    input: { event: string; value: number },
  ) {
    stats.events[input.event] = (stats.events[input.event] ?? 0) + input.value;
    stats.eventHistory.push({
      at: Date.now(),
      event: input.event,
      value: input.value,
    });
    if (stats.eventHistory.length > EVENT_HISTORY_LIMIT) {
      stats.eventHistory.splice(
        0,
        stats.eventHistory.length - EVENT_HISTORY_LIMIT,
      );
    }
  }

  private buildDockGuardrail(top: EventStats, stack: EventStats) {
    const objectiveCount = (stats: EventStats) =>
      Object.entries(stats.events).reduce(
        (sum, [event, value]) =>
          sum + (OBJECTIVE_EVENTS.has(event) ? value : 0),
        0,
      );
    const eventsInRange = (
      stats: EventStats,
      fromInclusive: number,
      toExclusive: number,
    ) =>
      stats.eventHistory.reduce(
        (sum, item) =>
          sum +
          (item.at >= fromInclusive &&
          item.at < toExclusive &&
          OBJECTIVE_EVENTS.has(item.event)
            ? item.value
            : 0),
        0,
      );
    const now = Date.now();
    const currentStart = now - TREND_WINDOW_MS;
    const previousStart = currentStart - TREND_WINDOW_MS;
    const topEvents = objectiveCount(top);
    const stackEvents = objectiveCount(stack);
    const topRate = topEvents / Math.max(1, top.assignedUsers);
    const stackRate = stackEvents / Math.max(1, stack.assignedUsers);
    const enoughSample =
      top.assignedUsers >= GUARDRAIL_MIN_ASSIGNED &&
      stack.assignedUsers >= GUARDRAIL_MIN_ASSIGNED &&
      topEvents >= GUARDRAIL_MIN_OBJECTIVE_EVENTS &&
      stackEvents >= GUARDRAIL_MIN_OBJECTIVE_EVENTS;
    const worseRatio =
      Math.max(topRate, stackRate) > 0
        ? Math.min(topRate, stackRate) / Math.max(topRate, stackRate)
        : 1;
    let decision:
      "hold" | "prefer_top" | "prefer_stack" | "disable_top" | "disable_stack" =
      "hold";
    let reason = "Not enough sample to make a guardrail decision.";
    if (enoughSample && worseRatio <= 0.7) {
      decision = topRate > stackRate ? "disable_stack" : "disable_top";
      reason = `${topRate > stackRate ? "Top" : "Stack"} variant materially outperforms the alternative on objective interactions per assigned user.`;
    } else if (enoughSample) {
      decision = topRate >= stackRate ? "prefer_top" : "prefer_stack";
      reason =
        "Both variants are healthy; keep ramp while preferring the current leader.";
    }
    const trend = (stats: EventStats) => {
      const current = eventsInRange(stats, currentStart, now);
      const previous = eventsInRange(stats, previousStart, currentStart);
      return { current, previous, delta: current - previous };
    };
    return {
      objective: {
        topEvents,
        stackEvents,
        topPerAssigned: Number(topRate.toFixed(4)),
        stackPerAssigned: Number(stackRate.toFixed(4)),
        deltaPctTopVsStack: Number(
          (stackRate > 0
            ? ((topRate - stackRate) / stackRate) * 100
            : topRate > 0
              ? 100
              : 0
          ).toFixed(2),
        ),
      },
      trend5m: { top: trend(top), stack: trend(stack) },
      guardrail: {
        minAssigned: GUARDRAIL_MIN_ASSIGNED,
        minObjectiveEvents: GUARDRAIL_MIN_OBJECTIVE_EVENTS,
        enoughSample,
        decision,
        reason,
      },
    };
  }
}

export const experimentControlPlane = new ExperimentControlPlane();

export function registerExperimentRoutes(
  app: ExperimentRouteApp,
  dependencies: ExperimentRouterDependencies,
  plane = experimentControlPlane,
) {
  app.get("/api/vaultfront/ab/dock/assignment", async (req, res) => {
    const identity = await dependencies.resolveIdentity(req);
    if (!identity) return res.status(401).json({ error: "Missing identity" });
    return res.json(plane.ensureDockAssignment(identity));
  });
  dependencies.assertPolicyBinding(
    "experiment-dock-event",
    "POST",
    "/api/vaultfront/ab/dock/event",
  );
  app.post("/api/vaultfront/ab/dock/event", async (req, res) => {
    const actor = await dependencies.resolveActor(req);
    if (
      !dependencies.authorize(
        "experiment-dock-event",
        { hasVerifiedActor: Boolean(actor) },
        res,
      ) ||
      !actor
    )
      return;
    const parsed = DockEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const result = plane.checkDockEvent(
      `auth:${actor.persistentId}`,
      parsed.data,
    );
    if (!result.ok) return res.status(409).json({ error: result.reason });
    return res.json({ ok: true, ...result.assignment });
  });
  app.get("/api/vaultfront/ab/dock/summary", (req, res) =>
    dependencies.isAdmin(req)
      ? res.json(plane.dockSummary())
      : res.status(401).json({ error: "Unauthorized" }),
  );

  app.get("/api/vaultfront/ab/recap/assignment", async (req, res) => {
    const identity = await dependencies.resolveIdentity(req);
    if (!identity) return res.status(401).json({ error: "Missing identity" });
    return res.json(plane.ensureRecapAssignment(identity));
  });
  dependencies.assertPolicyBinding(
    "experiment-recap-event",
    "POST",
    "/api/vaultfront/ab/recap/event",
  );
  app.post("/api/vaultfront/ab/recap/event", async (req, res) => {
    const actor = await dependencies.resolveActor(req);
    if (
      !dependencies.authorize(
        "experiment-recap-event",
        { hasVerifiedActor: Boolean(actor) },
        res,
      ) ||
      !actor
    )
      return;
    const parsed = RecapEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const result = plane.checkRecapEvent(
      `auth:${actor.persistentId}`,
      parsed.data,
    );
    if (!result.ok) return res.status(409).json({ error: result.reason });
    return res.json({ ok: true, ...result.assignment });
  });
  app.get("/api/vaultfront/ab/recap/summary", (req, res) =>
    dependencies.isAdmin(req)
      ? res.json(plane.recapSummary())
      : res.status(401).json({ error: "Unauthorized" }),
  );

  app.get("/api/vaultfront/ab/runtime/assignment", async (req, res) => {
    const identity = await dependencies.resolveIdentity(req);
    if (!identity) return res.status(401).json({ error: "Missing identity" });
    return res.json(plane.ensureRuntimeAssignment(identity));
  });
  dependencies.assertPolicyBinding(
    "experiment-runtime-event",
    "POST",
    "/api/vaultfront/ab/runtime/event",
  );
  app.post("/api/vaultfront/ab/runtime/event", async (req, res) => {
    const actor = await dependencies.resolveActor(req);
    if (
      !dependencies.authorize(
        "experiment-runtime-event",
        { hasVerifiedActor: Boolean(actor) },
        res,
      ) ||
      !actor
    )
      return;
    const parsed = RuntimeEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const result = plane.checkRuntimeEvent(
      `auth:${actor.persistentId}`,
      parsed.data,
    );
    if (!result.ok) return res.status(409).json({ error: result.reason });
    return res.json({ ok: true, ...result.assignment });
  });
  app.get("/api/vaultfront/ab/runtime/summary", (req, res) =>
    dependencies.isAdmin(req)
      ? res.json(plane.runtimeSummary())
      : res.status(401).json({ error: "Unauthorized" }),
  );
  app.get("/api/admin/ab/results", (req, res) =>
    dependencies.isAdmin(req)
      ? res.json(plane.unifiedSummary())
      : res.status(401).json({ error: "Unauthorized" }),
  );

  dependencies.assertPolicyBinding(
    "experiment-outcome-observation",
    "POST",
    "/api/vaultfront/outcome",
  );
  app.post("/api/vaultfront/outcome", async (req, res) => {
    const actor = await dependencies.resolveActor(req);
    if (
      !dependencies.authorize(
        "experiment-outcome-observation",
        { hasVerifiedActor: Boolean(actor) },
        res,
      ) ||
      !actor
    )
      return;
    const parsed = OutcomeTelemetrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const result = plane.recordOutcome(
      `auth:${actor.persistentId}`,
      parsed.data,
    );
    if (!result.ok) return res.status(409).json({ error: result.reason });
    return res.json({ ok: true, bucketKey: result.bucketKey });
  });
  app.get("/api/vaultfront/outcome/summary", (req, res) =>
    dependencies.isAdmin(req)
      ? res.json(plane.outcomeSummary())
      : res.status(401).json({ error: "Unauthorized" }),
  );
}
