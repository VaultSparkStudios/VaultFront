import type { CertifiedLoopEvidenceSummary } from "./CertifiedLoopEvidenceStore";

export type VaultFrontPulseSurface =
  "tutorial" | "match" | "tournament" | "retention";

export type VaultFrontEvidenceSource = "human" | "agent" | "test" | "system";

export interface VaultFrontPlaytestPulseEvent {
  surface: VaultFrontPulseSurface;
  event: string;
  /** Evidence is always unit-weighted. Caller-selected weights are rejected. */
  value?: 1;
  at?: number;
  evidenceSessionId?: string;
  eventId?: string;
  source?: VaultFrontEvidenceSource;
  /** Server-derived pseudonymous key. Never send a raw account identifier. */
  actorKey?: string;
}

export interface VaultFrontPlaytestPulseSummary {
  generatedAt: string;
  durability: "postgres" | "process-local";
  evidenceWindowHours: 24;
  status: "no-signal" | "warming" | "ready";
  score: number;
  totals: {
    events: number;
    tutorialShown: number;
    tutorialAdvanced: number;
    tutorialCompleted: number;
    tutorialSkipped: number;
    matchFeedback: number;
    tournamentActions: number;
    retentionSignals: number;
    retentionChallengeShown: number;
    retentionGoalSaved: number;
    retentionRequeued: number;
    retentionRematchRequested: number;
  };
  rates: {
    tutorialAdvance: number;
    tutorialCompletion: number;
    tutorialSkip: number;
    matchFeedback: number;
    retentionAction: number;
  };
  freshness: {
    firstEventAt: string | null;
    lastEventAt: string | null;
    ageMinutes: number | null;
  };
  recent: Array<{
    surface: VaultFrontPulseSurface;
    event: string;
    value: 1;
    at: number;
    source: VaultFrontEvidenceSource;
  }>;
  evidence: {
    acceptedHumanEvents: number;
    uniqueHumanSessions: number;
    uniqueHumanActors: number;
    duplicateEvents: number;
    rejectedEvents: number;
    excludedBySource: Record<
      Exclude<VaultFrontEvidenceSource, "human">,
      number
    >;
  };
  insights: string[];
  actionInsights: string[];
  operatorNext: {
    headline: string;
    steps: string[];
    successMetric: string;
  };
  alphaGate: {
    status: "not-started" | "warming" | "blocked" | "ready";
    checks: {
      fresh: boolean;
      sampleSize: boolean;
      tutorial: boolean;
      feedback: boolean;
      rivalExposure: boolean;
      rivalAction: boolean;
      certifiedCapture?: boolean;
      certifiedConvoyOutcome?: boolean;
      certifiedPressure?: boolean;
      certifiedBreach?: boolean;
      certifiedDecisiveDelivery?: boolean;
      certifiedOrderedLoop?: boolean;
    };
    passLabel: string;
    nextCheck: string;
  };
}

const MAX_RECENT = 40;
const allowedEvents: Record<VaultFrontPulseSurface, ReadonlySet<string>> = {
  tutorial: new Set(["shown", "advance", "complete", "skip"]),
  match: new Set([
    "feedback",
    "feedback_epic",
    "feedback_balanced",
    "feedback_off",
  ]),
  tournament: new Set(["seed_bracket", "report_winner"]),
  retention: new Set([
    "funnel_win",
    "funnel_loss",
    "rival_challenge_shown",
    "rival_goal_saved",
    "rival_requeue_clicked",
    "rival_rematch_requested",
  ]),
};

interface PulseState {
  seenEventIds: Set<string>;
  seenEventOrder: string[];
  humanSessionActors: Map<string, string>;
  sessionEvents: Map<string, Set<string>>;
  duplicateEvents: number;
  rejectedEvents: number;
  legacyEventSequence: number;
  excludedBySource: Record<Exclude<VaultFrontEvidenceSource, "human">, number>;
  pulse: {
    events: number;
    tutorialShown: number;
    tutorialAdvanced: number;
    tutorialCompleted: number;
    tutorialSkipped: number;
    matchFeedback: number;
    tournamentActions: number;
    retentionSignals: number;
    retentionChallengeShown: number;
    retentionGoalSaved: number;
    retentionRequeued: number;
    retentionRematchRequested: number;
    firstEventAt: number | null;
    lastEventAt: number | null;
    recent: VaultFrontPlaytestPulseSummary["recent"];
  };
}

function createPulseState(): PulseState {
  return {
    seenEventIds: new Set<string>(),
    seenEventOrder: [],
    humanSessionActors: new Map<string, string>(),
    sessionEvents: new Map<string, Set<string>>(),
    duplicateEvents: 0,
    rejectedEvents: 0,
    legacyEventSequence: 0,
    excludedBySource: { agent: 0, test: 0, system: 0 },
    pulse: {
      events: 0,
      tutorialShown: 0,
      tutorialAdvanced: 0,
      tutorialCompleted: 0,
      tutorialSkipped: 0,
      matchFeedback: 0,
      tournamentActions: 0,
      retentionSignals: 0,
      retentionChallengeShown: 0,
      retentionGoalSaved: 0,
      retentionRequeued: 0,
      retentionRematchRequested: 0,
      firstEventAt: null,
      lastEventAt: null,
      recent: [],
    },
  };
}

const defaultState = createPulseState();

function sessionsWith(
  state: PulseState,
  surface: VaultFrontPulseSurface,
  ...events: string[]
): number {
  let count = 0;
  for (const keys of state.sessionEvents.values()) {
    if (events.some((event) => keys.has(`${surface}:${event}`))) count += 1;
  }
  return count;
}

export function resetVaultFrontPlaytestPulseForTests(): void {
  const state = defaultState;
  const {
    pulse,
    seenEventIds,
    seenEventOrder,
    humanSessionActors,
    sessionEvents,
    excludedBySource,
  } = state;
  pulse.events = 0;
  pulse.tutorialShown = 0;
  pulse.tutorialAdvanced = 0;
  pulse.tutorialCompleted = 0;
  pulse.tutorialSkipped = 0;
  pulse.matchFeedback = 0;
  pulse.tournamentActions = 0;
  pulse.retentionSignals = 0;
  pulse.retentionChallengeShown = 0;
  pulse.retentionGoalSaved = 0;
  pulse.retentionRequeued = 0;
  pulse.retentionRematchRequested = 0;
  pulse.firstEventAt = null;
  pulse.lastEventAt = null;
  pulse.recent = [];
  seenEventIds.clear();
  seenEventOrder.length = 0;
  humanSessionActors.clear();
  sessionEvents.clear();
  state.duplicateEvents = 0;
  state.rejectedEvents = 0;
  state.legacyEventSequence = 0;
  excludedBySource.agent = 0;
  excludedBySource.test = 0;
  excludedBySource.system = 0;
}

export function recordVaultFrontPlaytestPulse(
  input: VaultFrontPlaytestPulseEvent,
  state: PulseState = defaultState,
): VaultFrontPlaytestPulseSummary {
  const {
    pulse,
    seenEventIds,
    seenEventOrder,
    humanSessionActors,
    sessionEvents,
    excludedBySource,
  } = state;
  const source = input.source ?? "system";
  const value = input.value ?? 1;
  const at = input.at ?? Date.now();
  const eventId =
    input.eventId ?? `legacy:${source}:${at}:${state.legacyEventSequence++}`;
  const evidenceSessionId =
    input.evidenceSessionId ?? `legacy:${source}:${eventId}`;

  if (!allowedEvents[input.surface].has(input.event) || value !== 1) {
    state.rejectedEvents += 1;
    return buildVaultFrontPlaytestPulseSummary(at, state);
  }
  if (seenEventIds.has(eventId)) {
    state.duplicateEvents += 1;
    return buildVaultFrontPlaytestPulseSummary(at, state);
  }
  seenEventIds.add(eventId);
  seenEventOrder.push(eventId);
  if (seenEventOrder.length > 20_000) {
    const oldest = seenEventOrder.shift();
    if (oldest) seenEventIds.delete(oldest);
  }

  const publicEvent: VaultFrontPlaytestPulseSummary["recent"][number] = {
    surface: input.surface,
    event: input.event,
    value: 1,
    at,
    source,
  };
  pulse.recent.unshift(publicEvent);
  pulse.recent = pulse.recent.slice(0, MAX_RECENT);

  // Only authenticated, server-pseudonymized human evidence contributes to
  // launch gates. Agent, test, and system samples remain visible but excluded.
  if (source !== "human") {
    excludedBySource[source] += 1;
    return buildVaultFrontPlaytestPulseSummary(at, state);
  }
  if (!input.actorKey) {
    state.rejectedEvents += 1;
    return buildVaultFrontPlaytestPulseSummary(at, state);
  }
  const sessionActor = humanSessionActors.get(evidenceSessionId);
  if (sessionActor && sessionActor !== input.actorKey) {
    state.rejectedEvents += 1;
    return buildVaultFrontPlaytestPulseSummary(at, state);
  }
  humanSessionActors.set(evidenceSessionId, input.actorKey);
  const evidence = sessionEvents.get(evidenceSessionId) ?? new Set<string>();
  evidence.add(`${input.surface}:${input.event}`);
  sessionEvents.set(evidenceSessionId, evidence);

  pulse.events += 1;
  pulse.firstEventAt ??= at;
  pulse.lastEventAt = at;

  if (input.surface === "tutorial") {
    if (input.event === "shown") pulse.tutorialShown += 1;
    if (input.event === "advance") pulse.tutorialAdvanced += 1;
    if (input.event === "complete") pulse.tutorialCompleted += 1;
    if (input.event === "skip") pulse.tutorialSkipped += 1;
  } else if (input.surface === "match") {
    pulse.matchFeedback += 1;
  } else if (input.surface === "tournament") {
    pulse.tournamentActions += 1;
  } else if (input.surface === "retention") {
    pulse.retentionSignals += 1;
    if (input.event === "rival_challenge_shown") {
      pulse.retentionChallengeShown += 1;
    }
    if (input.event === "rival_goal_saved") {
      pulse.retentionGoalSaved += 1;
    }
    if (input.event === "rival_requeue_clicked") {
      pulse.retentionRequeued += 1;
    }
    if (input.event === "rival_rematch_requested") {
      pulse.retentionRematchRequested += 1;
    }
  }

  return buildVaultFrontPlaytestPulseSummary(at, state);
}
export function buildVaultFrontPlaytestPulseSummary(
  now = Date.now(),
  state: PulseState = defaultState,
  durability: VaultFrontPlaytestPulseSummary["durability"] = "process-local",
): VaultFrontPlaytestPulseSummary {
  const { pulse, humanSessionActors, excludedBySource } = state;
  const tutorialShownSessions = sessionsWith(state, "tutorial", "shown");
  const tutorialCompletion =
    tutorialShownSessions > 0
      ? Number(
          (
            sessionsWith(state, "tutorial", "complete") / tutorialShownSessions
          ).toFixed(4),
        )
      : 0;
  const tutorialAdvance =
    tutorialShownSessions > 0
      ? Number(
          (
            sessionsWith(state, "tutorial", "advance") / tutorialShownSessions
          ).toFixed(4),
        )
      : 0;
  const tutorialSkip =
    tutorialShownSessions > 0
      ? Number(
          (
            sessionsWith(state, "tutorial", "skip") / tutorialShownSessions
          ).toFixed(4),
        )
      : 0;
  const matchFeedback =
    humanSessionActors.size > 0
      ? Number(
          (
            sessionsWith(
              state,
              "match",
              "feedback",
              "feedback_epic",
              "feedback_balanced",
              "feedback_off",
            ) / humanSessionActors.size
          ).toFixed(4),
        )
      : 0;

  const retentionExposureSessions = sessionsWith(
    state,
    "retention",
    "rival_challenge_shown",
  );
  const retentionAction =
    retentionExposureSessions > 0
      ? Number(
          (
            sessionsWith(
              state,
              "retention",
              "rival_goal_saved",
              "rival_requeue_clicked",
              "rival_rematch_requested",
            ) / retentionExposureSessions
          ).toFixed(4),
        )
      : 0;
  const ageMinutes =
    pulse.lastEventAt === null
      ? null
      : Number(((now - pulse.lastEventAt) / 60_000).toFixed(1));
  const score = Math.min(
    100,
    Math.round(
      pulse.tutorialCompleted * 12 +
        pulse.matchFeedback * 8 +
        pulse.tournamentActions * 10 +
        pulse.retentionSignals * 6,
    ),
  );
  const status =
    pulse.events === 0 ? "no-signal" : score >= 30 ? "ready" : "warming";

  const actionInsights = buildActionInsights(state, {
    tutorialAdvance,
    tutorialCompletion,
    tutorialSkip,
    matchFeedback,
    retentionAction,
    ageMinutes,
  });
  const alphaGate = buildAlphaGate(state, {
    tutorialAdvance,
    tutorialCompletion,
    matchFeedback,
    retentionAction,
    ageMinutes,
  });

  return {
    generatedAt: new Date(now).toISOString(),
    durability,
    evidenceWindowHours: 24,
    status,
    score,
    totals: {
      events: pulse.events,
      tutorialShown: pulse.tutorialShown,
      tutorialAdvanced: pulse.tutorialAdvanced,
      tutorialCompleted: pulse.tutorialCompleted,
      tutorialSkipped: pulse.tutorialSkipped,
      matchFeedback: pulse.matchFeedback,
      tournamentActions: pulse.tournamentActions,
      retentionSignals: pulse.retentionSignals,
      retentionChallengeShown: pulse.retentionChallengeShown,
      retentionGoalSaved: pulse.retentionGoalSaved,
      retentionRequeued: pulse.retentionRequeued,
      retentionRematchRequested: pulse.retentionRematchRequested,
    },
    rates: {
      tutorialAdvance,
      tutorialCompletion,
      tutorialSkip,
      matchFeedback,
      retentionAction,
    },
    freshness: {
      firstEventAt:
        pulse.firstEventAt === null
          ? null
          : new Date(pulse.firstEventAt).toISOString(),
      lastEventAt:
        pulse.lastEventAt === null
          ? null
          : new Date(pulse.lastEventAt).toISOString(),
      ageMinutes,
    },
    recent: pulse.recent.slice(0, 10),
    evidence: {
      acceptedHumanEvents: pulse.events,
      uniqueHumanSessions: humanSessionActors.size,
      uniqueHumanActors: new Set(humanSessionActors.values()).size,
      duplicateEvents: state.duplicateEvents,
      rejectedEvents: state.rejectedEvents,
      excludedBySource: { ...excludedBySource },
    },
    insights: buildPulseInsights(
      state,
      tutorialCompletion,
      tutorialSkip,
      ageMinutes,
    ),
    actionInsights,
    operatorNext: buildOperatorNext(state, {
      tutorialAdvance,
      tutorialCompletion,
      tutorialSkip,
      matchFeedback,
      retentionAction,
      ageMinutes,
      actionInsights,
    }),
    alphaGate,
  };
}

function buildAlphaGate(
  state: PulseState,
  input: {
    tutorialAdvance: number;
    tutorialCompletion: number;
    matchFeedback: number;
    retentionAction: number;
    ageMinutes: number | null;
  },
): VaultFrontPlaytestPulseSummary["alphaGate"] {
  const { pulse, humanSessionActors } = state;
  const checks = {
    fresh: input.ageMinutes !== null && input.ageMinutes <= 1440,
    sampleSize: new Set(humanSessionActors.values()).size >= 3,
    tutorial:
      pulse.tutorialShown > 0 &&
      input.tutorialAdvance >= 0.5 &&
      input.tutorialCompletion >= 0.35,
    feedback: pulse.matchFeedback > 0 && input.matchFeedback > 0,
    rivalExposure: pulse.retentionChallengeShown > 0,
    rivalAction:
      pulse.retentionChallengeShown > 0 && input.retentionAction >= 0.25,
  };
  const orderedFailures: Array<[keyof typeof checks, string]> = [
    [
      "fresh",
      "Refresh playtest evidence; the latest signal is older than 24 hours.",
    ],
    [
      "tutorial",
      "Prove onboarding: tutorial advance 50%+ and completion 35%+.",
    ],

    [
      "feedback",
      "Prove the post-match surface: record at least one feedback signal.",
    ],
    [
      "rivalExposure",
      "Seed rivalry revenge and show the Rival Challenge card.",
    ],
    ["rivalAction", "Drive Rival Challenge action rate to 25%+."],
    [
      "sampleSize",
      "Collect authenticated evidence from at least three distinct human actors.",
    ],
  ];
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const nextCheck =
    orderedFailures.find(([key]) => !checks[key])?.[1] ??
    "Alpha gate evidence is complete; run one more rivalry/rematch pass only if freshness expires.";
  const status =
    pulse.events === 0
      ? "not-started"
      : !checks.fresh
        ? "blocked"
        : passed === total
          ? "ready"
          : "warming";
  return {
    status,
    checks,
    passLabel:
      status === "ready"
        ? "Alpha gate passed: three authenticated actors, tutorial, feedback, rivalry exposure, Rival action, and freshness are all green."
        : `${passed}/${total} alpha gate checks passing.`,
    nextCheck,
  };
}

/**
 * Binds the authenticated human cohort to the server-certified gameplay loop.
 * Missing or stale evidence can never preserve a ready gate.
 */
export function attachCertifiedLoopAlphaEvidence(
  summary: VaultFrontPlaytestPulseSummary,
  certified: Pick<
    CertifiedLoopEvidenceSummary,
    | "windowStartAt"
    | "windowEndAt"
    | "latestEvidenceAt"
    | "vaultParticipants"
    | "outcomeParticipants"
    | "pressureParticipants"
    | "breachParticipants"
    | "decisiveDeliveryParticipants"
    | "certifiedLoopParticipants"
  > | null,
  now = Date.now(),
): VaultFrontPlaytestPulseSummary {
  const evidenceWindowMs = 24 * 60 * 60 * 1000;
  const latestEvidenceAt = certified?.latestEvidenceAt ?? null;
  const cohortWindowBound =
    certified !== null &&
    certified.windowStartAt !== null &&
    certified.windowStartAt >= now - evidenceWindowMs - 1_000 &&
    certified.windowEndAt <= now + 1_000;
  const certifiedFresh =
    cohortWindowBound &&
    latestEvidenceAt !== null &&
    latestEvidenceAt <= now &&
    now - latestEvidenceAt <= evidenceWindowMs;
  const certifiedCapture =
    certifiedFresh && (certified?.vaultParticipants ?? 0) > 0;
  const certifiedConvoyOutcome =
    certifiedFresh && (certified?.outcomeParticipants ?? 0) > 0;
  const certifiedPressure =
    certifiedFresh && (certified?.pressureParticipants ?? 0) > 0;
  const certifiedBreach =
    certifiedFresh && (certified?.breachParticipants ?? 0) > 0;
  const certifiedDecisiveDelivery =
    certifiedFresh && (certified?.decisiveDeliveryParticipants ?? 0) > 0;
  const certifiedOrderedLoop =
    certifiedFresh && (certified?.certifiedLoopParticipants ?? 0) > 0;
  const certifiedChecks = {
    certifiedCapture,
    certifiedConvoyOutcome,
    certifiedPressure,
    certifiedBreach,
    certifiedDecisiveDelivery,
    certifiedOrderedLoop,
  };
  const checks = { ...summary.alphaGate.checks, ...certifiedChecks };
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const hadReadyHumanCohort = summary.alphaGate.status === "ready";
  const certifiedStagesReady = Object.values(certifiedChecks).every(Boolean);
  const status =
    summary.alphaGate.status === "not-started"
      ? "not-started"
      : !summary.alphaGate.checks.fresh ||
          (latestEvidenceAt !== null && !certifiedFresh)
        ? "blocked"
        : hadReadyHumanCohort && certifiedStagesReady
          ? "ready"
          : "warming";
  const nextCheck = !certified
    ? "Certified loop evidence is unavailable; restore the evidence store and complete Capture → Convoy → Pressure → Breach → decisive delivery."
    : certified.windowStartAt === null
      ? "Query the certified evidence store through the bounded 24-hour Alpha cohort window."
      : !certifiedFresh
        ? "Complete a fresh certified Capture → Convoy → Pressure → Breach → decisive-delivery loop within 24 hours."
        : !certifiedCapture
          ? "Complete a server-certified Vault capture in the current Alpha cohort."
          : !certifiedConvoyOutcome
            ? "Complete a server-certified convoy delivery or loss after Capture."
            : !certifiedPressure
              ? "Start certified Vault Pressure after the convoy outcome."
              : !certifiedBreach
                ? "Open a certified Breach from the active Pressure chain."
                : !certifiedDecisiveDelivery
                  ? "Land the certified decisive delivery before the Breach window closes."
                  : !certifiedOrderedLoop
                    ? "Complete Capture → Convoy → Pressure → Breach → decisive delivery in order in one certified player timeline."
                    : summary.alphaGate.nextCheck;

  return {
    ...summary,
    alphaGate: {
      ...summary.alphaGate,
      status,
      checks,
      passLabel:
        status === "ready"
          ? "Alpha gate passed: three authenticated actors plus a fresh, ordered, server-certified Capture-to-decisive-delivery loop are green."
          : `${passed}/${total} alpha gate checks passing.`,
      nextCheck,
    },
  };
}

function buildPulseInsights(
  state: PulseState,
  tutorialCompletion: number,
  tutorialSkip: number,
  ageMinutes: number | null,
): string[] {
  const { pulse } = state;
  const insights: string[] = [];
  if (pulse.events === 0) {
    insights.push("No playtest pulse events have landed in this process yet.");
  }
  if (pulse.tutorialShown > 0) {
    insights.push(
      `Tutorial completion is ${Math.round(tutorialCompletion * 100)}% with ${Math.round(tutorialSkip * 100)}% skips.`,
    );
  }
  if (pulse.matchFeedback > 0) {
    insights.push(
      `${pulse.matchFeedback} post-match feedback signal(s) recorded.`,
    );
  }
  if (pulse.tournamentActions > 0) {
    insights.push(
      `${pulse.tournamentActions} tournament operator action(s) recorded.`,
    );
  }
  if (ageMinutes !== null && ageMinutes > 1440) {
    insights.push("Latest playtest signal is older than 24 hours.");
  }
  return insights;
}

function buildActionInsights(
  state: PulseState,
  input: {
    tutorialAdvance: number;
    tutorialCompletion: number;
    tutorialSkip: number;
    matchFeedback: number;
    retentionAction: number;
    ageMinutes: number | null;
  },
): string[] {
  const { pulse } = state;
  if (pulse.events === 0) {
    return [
      "Run one guided internal match and confirm tutorial, match feedback, and post-match retention events land.",
    ];
  }

  const actions: string[] = [];
  if (input.ageMinutes !== null && input.ageMinutes > 1440) {
    actions.push(
      "Refresh playtest evidence; latest pulse is older than 24 hours.",
    );
  }
  if (pulse.tutorialShown > 0 && input.tutorialAdvance < 0.5) {
    actions.push(
      "Tutorial advances are weak; tighten the first strip copy or make the next action more obvious.",
    );
  }
  if (pulse.tutorialShown > 0 && input.tutorialCompletion < 0.35) {
    actions.push(
      "Tutorial completion is below launch confidence; shorten or split the onboarding flow before public traffic.",
    );
  }
  if (pulse.matchFeedback === 0) {
    actions.push(
      "No post-match feedback has landed; verify the win modal is reached during the next playtest.",
    );
  }
  if (pulse.retentionChallengeShown > 0 && input.retentionAction < 0.25) {
    actions.push(
      "Rival Challenge is visible but not converting; make rematch/requeue the primary rival action.",
    );
  }
  if (pulse.retentionChallengeShown === 0 && pulse.events >= 10) {
    actions.push(
      "Pulse has activity but no rivalry challenge exposure; seed a rivalry scenario in the next internal match.",
    );
  }
  if (actions.length === 0) {
    actions.push(
      "Pulse is broad enough for this alpha gate; continue with a focused rivalry/rematch playtest.",
    );
  }
  return actions.slice(0, 3);
}

function buildOperatorNext(
  state: PulseState,
  input: {
    tutorialAdvance: number;
    tutorialCompletion: number;
    tutorialSkip: number;
    matchFeedback: number;
    retentionAction: number;
    ageMinutes: number | null;
    actionInsights: string[];
  },
): VaultFrontPlaytestPulseSummary["operatorNext"] {
  const { pulse } = state;
  if (pulse.events === 0) {
    return {
      headline: "Run a guided first-match alpha pass.",
      steps: [
        "Start one fresh-player match on a compact viewport and confirm the tutorial strip appears.",
        "Finish the match, submit one post-match feedback choice, and open the KPI panel.",
        "Check readiness again and confirm pulse status moved away from no-signal.",
      ],
      successMetric:
        "Pulse records tutorialShown, tutorialAdvanced, tutorialCompleted, and matchFeedback above zero.",
    };
  }

  if (pulse.tutorialShown > 0 && input.tutorialCompletion < 0.35) {
    return {
      headline: "Replay onboarding until the first action is obvious.",
      steps: [
        "Run two first-time matches and ask each tester to advance the tutorial without coaching.",
        "Stop when a tester hesitates on the first strip and rewrite that step in-place.",
        "Recheck pulse action insights before moving to rivalry validation.",
      ],
      successMetric:
        "Tutorial completion reaches 35%+ with tutorialAdvance at 50%+ in the next pulse sample.",
    };
  }

  if (pulse.matchFeedback === 0) {
    return {
      headline: "Force a post-match feedback check.",
      steps: [
        "Play or spectate through a full win modal and click one feedback option.",
        "Verify the KPI panel shows at least one match feedback signal.",
        "Only then judge Rival Challenge behavior, because the post-match surface is proven reachable.",
      ],
      successMetric:
        "matchFeedback is greater than zero and readiness no longer names feedback as the next action.",
    };
  }

  if (pulse.retentionChallengeShown > 0 && input.retentionAction < 0.25) {
    return {
      headline: "Make the Rival Challenge action unmissable.",
      steps: [
        "Seed rivalry revenge progress, reach the win modal, and observe the first action testers choose.",
        "Run one pass with goal-save as the primary ask and one pass with requeue/rematch as the primary ask.",
        "Keep the variant that raises Rival Challenge action rate without reducing match feedback.",
      ],
      successMetric:
        "Rival Challenge action rate reaches 25%+ across goal-save, requeue, and rematch events.",
    };
  }

  if (pulse.retentionChallengeShown === 0 && pulse.events >= 10) {
    return {
      headline: "Seed a rivalry rematch scenario.",
      steps: [
        "Create a match where the same opponent blocks or defeats the player twice.",
        "Earn rivalry revenge progress and confirm the win modal shows Rival Challenge.",
        "Click requeue or rematch from that card, then inspect retention counters.",
      ],
      successMetric:
        "retentionChallengeShown and at least one Rival Challenge action counter are both above zero.",
    };
  }

  return {
    headline: "Run the focused rivalry/rematch alpha gate.",
    steps: [
      "Run one guided rivalry scenario from first tutorial touch through win modal.",
      "Confirm tutorial, feedback, and Rival Challenge counters all move in the same process.",
      "Use readiness action insight as the pass/fail note for the next launch checkpoint.",
    ],
    successMetric:
      input.actionInsights[0] ??
      "Pulse stays ready with tutorial, feedback, and retention signals present.",
  };
}

/** Build a cohort summary without sharing mutable process state. */
export function buildVaultFrontPlaytestPulseSummaryFromEvents(
  events: readonly VaultFrontPlaytestPulseEvent[],
  now = Date.now(),
  durability: VaultFrontPlaytestPulseSummary["durability"] = "postgres",
): VaultFrontPlaytestPulseSummary {
  const state = createPulseState();
  for (const event of events) recordVaultFrontPlaytestPulse(event, state);
  return buildVaultFrontPlaytestPulseSummary(now, state, durability);
}

export function isAllowedVaultFrontPulseEvent(
  event: Pick<VaultFrontPlaytestPulseEvent, "surface" | "event" | "value">,
): boolean {
  return (
    allowedEvents[event.surface].has(event.event) && (event.value ?? 1) === 1
  );
}
