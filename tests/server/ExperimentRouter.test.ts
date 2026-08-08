import { describe, expect, test, vi } from "vitest";
import {
  ExperimentControlPlane,
  registerExperimentRoutes,
} from "../../src/server/ExperimentRouter";

describe("ExperimentControlPlane", () => {
  test("preserves legacy deterministic dock bucketing", () => {
    const first = new ExperimentControlPlane();
    const restarted = new ExperimentControlPlane();

    expect(first.ensureDockAssignment("auth:player-0").variant).toBe("stack");
    expect(first.ensureDockAssignment("auth:player-1").variant).toBe("top");
    expect(restarted.ensureDockAssignment("auth:player-1").variant).toBe("top");
  });

  test("rejects duplicate and variant-forged events without inflating stats", () => {
    const plane = new ExperimentControlPlane();
    const identity = "auth:player-1";
    const assignment = plane.ensureDockAssignment(identity);
    const event = {
      eventId: "dock-event-000001",
      event: "hud_objective_rail_click",
      value: 1 as const,
      variant: assignment.variant,
    };

    expect(plane.checkDockEvent(identity, event).ok).toBe(true);
    expect(plane.checkDockEvent(identity, event).ok).toBe(false);
    expect(
      plane.checkDockEvent(identity, {
        ...event,
        eventId: "dock-event-000002",
        variant: assignment.variant === "top" ? "stack" : "top",
      }).ok,
    ).toBe(false);
    expect(plane.dockSummary().variants[assignment.variant].events).toEqual({
      hud_objective_rail_click: 1,
    });
  });

  test("labels aggregate reset scope as process-local across worker restarts", () => {
    const summary = new ExperimentControlPlane().outcomeSummary();
    expect(summary.storage).toEqual({
      assignments: "process-local",
      aggregates: "process-local",
      resetBoundary: "worker-restart",
    });
  });

  test("records only authenticated interaction observations", () => {
    const plane = new ExperimentControlPlane();
    const identity = "auth:player-1";
    const variant = plane.ensureRecapAssignment(identity).variant;
    const observation = {
      eventId: "outcome-event-000001",
      gameId: "game-1",
      recapCtaVariant: variant,
      recapCtaClicked: true,
      requeueClicked: false,
      hud: {
        vaultNoticeJumps: 2,
        objectiveRailClicks: 4,
        timelineJumps: 1,
      },
    };

    expect(plane.recordOutcome(identity, observation)).toMatchObject({
      ok: true,
      bucketKey: variant,
    });
    expect(plane.recordOutcome(identity, observation).ok).toBe(false);
    expect(plane.outcomeSummary()).toMatchObject({
      evidence: "authenticated-client-interaction",
      excludes: ["win", "match-duration", "behind-at-minute-8"],
      totals: {
        observations: 1,
        recapCtaRate: 1,
        requeueRate: 0,
        hudPerObservation: {
          vaultNoticeJumps: 2,
          objectiveRailClicks: 4,
          timelineJumps: 1,
        },
      },
    });
  });
});

describe("registerExperimentRoutes", () => {
  test("registers the complete bounded surface and all mutation policies", () => {
    const get = vi.fn();
    const post = vi.fn();
    const assertPolicyBinding = vi.fn();

    registerExperimentRoutes(
      { get, post },
      {
        resolveIdentity: async () => "identity",
        resolveActor: async () => ({ persistentId: "player" }),
        authorize: () => true,
        assertPolicyBinding,
        isAdmin: () => true,
      },
      new ExperimentControlPlane(),
    );

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      "/api/vaultfront/ab/dock/assignment",
      "/api/vaultfront/ab/dock/summary",
      "/api/vaultfront/ab/recap/assignment",
      "/api/vaultfront/ab/recap/summary",
      "/api/vaultfront/ab/runtime/assignment",
      "/api/vaultfront/ab/runtime/summary",
      "/api/admin/ab/results",
      "/api/vaultfront/outcome/summary",
    ]);
    expect(post.mock.calls.map(([path]) => path)).toEqual([
      "/api/vaultfront/ab/dock/event",
      "/api/vaultfront/ab/recap/event",
      "/api/vaultfront/ab/runtime/event",
      "/api/vaultfront/outcome",
    ]);
    expect(assertPolicyBinding).toHaveBeenCalledTimes(4);
  });

  test("rate-limits all four write endpoints (S99 audit #175)", () => {
    const get = vi.fn();
    const post = vi.fn();

    registerExperimentRoutes(
      { get, post },
      {
        resolveIdentity: async () => "identity",
        resolveActor: async () => ({ persistentId: "player" }),
        authorize: () => true,
        assertPolicyBinding: () => {},
        isAdmin: () => true,
      },
      new ExperimentControlPlane(),
    );

    // Each POST call is (path, rateLimitMiddleware, handler) -- three args,
    // with a rate-limit middleware function inserted before the handler.
    for (const call of post.mock.calls) {
      expect(call).toHaveLength(3);
      expect(typeof call[1]).toBe("function");
      expect(typeof call[2]).toBe("function");
    }
    // All four share one bounded window rather than four independent ones.
    const limiters = new Set(post.mock.calls.map((call) => call[1]));
    expect(limiters.size).toBe(1);
  });
});
