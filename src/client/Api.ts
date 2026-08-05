import { z } from "zod";
import {
  ClanLeaderboardResponse,
  ClanLeaderboardResponseSchema,
  PlayerProfile,
  PlayerProfileSchema,
  RankedLeaderboardResponse,
  RankedLeaderboardResponseSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { appUrl } from "../core/RuntimeUrls";
import { AnalyticsRecord, AnalyticsRecordSchema } from "../core/Schemas";
import { getAuthHeader, getPlayToken, logOut, userAuth } from "./Auth";

export async function fetchPlayerById(
  playerId: string,
): Promise<PlayerProfile | false> {
  try {
    const userAuthResult = await userAuth();
    if (!userAuthResult) return false;
    const { jwt } = userAuthResult;

    const url = `${getApiBase()}/player/${encodeURIComponent(playerId)}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchPlayerById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = PlayerProfileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchPlayerById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchPlayerById: request failed", err);
    return false;
  }
}

let __userMe: Promise<UserMeResponse | false> | null = null;
export async function getUserMe(): Promise<UserMeResponse | false> {
  if (__userMe !== null) {
    return __userMe;
  }
  __userMe = (async () => {
    try {
      const userAuthResult = await userAuth();
      if (!userAuthResult) return false;
      const { jwt } = userAuthResult;

      // Get the user object
      const response = await fetch(getApiBase() + "/users/@me", {
        headers: {
          authorization: `Bearer ${jwt}`,
        },
      });
      if (response.status === 401) {
        await logOut();
        return false;
      }
      if (response.status !== 200) return false;
      const body = await response.json();
      const result = UserMeResponseSchema.safeParse(body);
      if (!result.success) {
        const error = z.prettifyError(result.error);
        console.error("Invalid response", error);
        return false;
      }
      return result.data;
    } catch (e) {
      return false;
    }
  })();
  return __userMe;
}

export async function createCheckoutSession(
  priceId: string,
  colorPaletteName: string | null,
): Promise<string | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/stripe/create-checkout-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({
          priceId: priceId,
          hostname: appUrl(""),
          colorPaletteName: colorPaletteName,
        }),
      },
    );
    if (!response.ok) {
      console.error(
        "createCheckoutSession: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("createCheckoutSession: request failed", e);
    return false;
  }
}

export function getApiBase() {
  const apiDomain = process?.env?.API_DOMAIN;
  if (apiDomain) {
    return /^https?:\/\//.test(apiDomain) ? apiDomain : `https://${apiDomain}`;
  }

  const domainname = getAudience();
  if (domainname === "localhost") {
    return localStorage.getItem("apiHost") ?? "http://localhost:8787";
  }

  return `https://api.${domainname}`;
}

export function getAudience() {
  const { hostname } = new URL(window.location.href);
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname;
}

// Check if the user's account is linked to a Discord or email account.
export function hasLinkedAccount(
  userMeResponse: UserMeResponse | false,
): boolean {
  return (
    userMeResponse !== false &&
    (userMeResponse.user?.discord !== undefined ||
      userMeResponse.user?.email !== undefined)
  );
}

export async function fetchGameById(
  gameId: string,
): Promise<AnalyticsRecord | false> {
  try {
    const url = `${getApiBase()}/game/${encodeURIComponent(gameId)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchGameById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = AnalyticsRecordSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchGameById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchGameById: request failed", err);
    return false;
  }
}

export async function fetchClanLeaderboard(): Promise<
  ClanLeaderboardResponse | false
> {
  try {
    const res = await fetch(`${getApiBase()}/public/clans/leaderboard`, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(
        "fetchClanLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = ClanLeaderboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        "fetchClanLeaderboard: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchClanLeaderboard: request failed", err);
    return false;
  }
}

export async function fetchPlayerLeaderboard(
  page: number,
): Promise<RankedLeaderboardResponse | "reached_limit" | false> {
  try {
    const url = new URL(`${getApiBase()}/leaderboard/ranked`);
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(
        "fetchPlayerLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = RankedLeaderboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      // Handle "Page must be between X and Y" error as end of list
      if (json?.message?.includes?.("Page must be between")) {
        return "reached_limit";
      }
      console.warn(
        "fetchPlayerLeaderboard: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.error("fetchPlayerLeaderboard: request failed", err);
    return false;
  }
}

const VaultFrontSeasonContractStateSchema = z.object({
  seasonId: z.string(),
  interceptionTiming: z.number(),
  objectiveDenial: z.number(),
  comebackExecution: z.number(),
  surgeExecution: z.number(),
  evidence: z.literal("certified-match-result"),
  durability: z.enum(["postgres", "process-local"]),
});

export type VaultFrontSeasonContractState = z.infer<
  typeof VaultFrontSeasonContractStateSchema
>;

const VaultFrontDockAssignmentSchema = z.object({
  experimentId: z.literal("dock_layout_v1"),
  variant: z.enum(["top", "stack"]),
  assignedAt: z.number(),
});

const VaultFrontDockSummarySchema = z.object({
  experimentId: z.literal("dock_layout_v1"),
  generatedAt: z.number(),
  assignedTotal: z.number(),
  variants: z.object({
    top: z.object({
      assignedUsers: z.number(),
      events: z.record(z.string(), z.number()),
    }),
    stack: z.object({
      assignedUsers: z.number(),
      events: z.record(z.string(), z.number()),
    }),
  }),
  guardrail: z
    .object({
      objective: z.object({
        topEvents: z.number(),
        stackEvents: z.number(),
        topPerAssigned: z.number(),
        stackPerAssigned: z.number(),
        deltaPctTopVsStack: z.number(),
      }),
      trend5m: z.object({
        top: z.object({
          current: z.number(),
          previous: z.number(),
          delta: z.number(),
        }),
        stack: z.object({
          current: z.number(),
          previous: z.number(),
          delta: z.number(),
        }),
      }),
      guardrail: z.object({
        minAssigned: z.number(),
        minObjectiveEvents: z.number(),
        enoughSample: z.boolean(),
        decision: z.enum([
          "hold",
          "prefer_top",
          "prefer_stack",
          "disable_top",
          "disable_stack",
        ]),
        reason: z.string(),
      }),
    })
    .optional(),
});

const VaultFrontRecapAssignmentSchema = z.object({
  experimentId: z.literal("recap_cta_v1"),
  variant: z.enum(["goal_focus", "requeue_focus"]),
  assignedAt: z.number(),
});

const VaultFrontRecapSummarySchema = z.object({
  experimentId: z.literal("recap_cta_v1"),
  generatedAt: z.number(),
  assignedTotal: z.number(),
  variants: z.object({
    goal_focus: z.object({
      assignedUsers: z.number(),
      events: z.record(z.string(), z.number()),
    }),
    requeue_focus: z.object({
      assignedUsers: z.number(),
      events: z.record(z.string(), z.number()),
    }),
  }),
  cta: z.object({
    goalFocusRate: z.number(),
    requeueFocusRate: z.number(),
  }),
});

const VaultFrontRuntimeAssignmentSchema = z.object({
  experimentId: z.literal("vault_runtime_v1"),
  rewardVariant: z.enum(["control", "high_risk_high_reward"]),
  hudVariant: z.enum(["default", "mobile_priority"]),
  assignedAt: z.number(),
});

const VaultFrontOutcomeTelemetryInputSchema = z.object({
  gameId: z.string().min(1).max(64),
  recapCtaVariant: z.enum(["goal_focus", "requeue_focus"]).optional(),
  recapCtaClicked: z.boolean().optional(),
  requeueClicked: z.boolean().optional(),
  hud: z.object({
    vaultNoticeJumps: z.number().int().min(0),
    objectiveRailClicks: z.number().int().min(0),
    timelineJumps: z.number().int().min(0),
  }),
});
const VaultFrontOutcomeSummarySchema = z.object({
  generatedAt: z.number(),
  evidence: z.literal("authenticated-client-interaction"),
  excludes: z.tuple([
    z.literal("win"),
    z.literal("match-duration"),
    z.literal("behind-at-minute-8"),
  ]),
  totals: z.object({
    observations: z.number(),
    recapCtaRate: z.number(),
    requeueRate: z.number(),
    hudPerObservation: z.object({
      vaultNoticeJumps: z.number(),
      objectiveRailClicks: z.number(),
      timelineJumps: z.number(),
    }),
  }),
  buckets: z.array(
    z.object({
      key: z.string(),
      observations: z.number(),
      hudPerObservation: z.object({
        vaultNoticeJumps: z.number(),
        objectiveRailClicks: z.number(),
        timelineJumps: z.number(),
      }),
      recapCtaRate: z.number(),
      requeueRate: z.number(),
      recapVariant: z.object({
        goal_focus: z.number(),
        requeue_focus: z.number(),
      }),
    }),
  ),
});
const VaultFrontFunnelSummarySchema = z.object({
  generatedAt: z.number(),
  matches: z.number(),
  playerSamples: z.number(),
  vaultParticipants: z.number(),
  outcomeParticipants: z.number(),
  completedCycleParticipants: z.number(),
  vaultParticipationRatePct: z.number(),
  cycleCompletionRatePct: z.number(),
  averageFirstVaultSeconds: z.number().nullable(),
  averageFirstOutcomeSeconds: z.number().nullable(),
  phases: z.object({
    early: z.record(z.string(), z.number()),
    mid: z.record(z.string(), z.number()),
    late: z.record(z.string(), z.number()),
  }),
  evidence: z.literal("certified-match-result"),
  durability: z.enum(["postgres", "process-local"]),
});

const VaultFrontPlaytestPulseEventSchema = z.object({
  surface: z.enum(["tutorial", "match", "tournament", "retention"]),
  event: z.string().min(1).max(64),
  value: z.literal(1).optional(),
});

const VaultFrontPlaytestPulseSummarySchema = z.object({
  generatedAt: z.string(),
  status: z.enum(["no-signal", "warming", "ready"]),
  score: z.number(),
  totals: z.object({
    events: z.number(),
    tutorialShown: z.number(),
    tutorialAdvanced: z.number(),
    tutorialCompleted: z.number(),
    tutorialSkipped: z.number(),
    matchFeedback: z.number(),
    tournamentActions: z.number(),
    retentionSignals: z.number(),
    retentionChallengeShown: z.number(),
    retentionGoalSaved: z.number(),
    retentionRequeued: z.number(),
    retentionRematchRequested: z.number(),
  }),
  rates: z.object({
    tutorialAdvance: z.number(),
    tutorialCompletion: z.number(),
    tutorialSkip: z.number(),
    matchFeedback: z.number(),
    retentionAction: z.number(),
  }),
  freshness: z.object({
    firstEventAt: z.string().nullable(),
    lastEventAt: z.string().nullable(),
    ageMinutes: z.number().nullable(),
  }),
  recent: z.array(
    VaultFrontPlaytestPulseEventSchema.extend({
      at: z.number(),
      evidenceSessionId: z.string(),
      eventId: z.string(),
      source: z.enum(["human", "agent", "test", "system"]),
    }),
  ),
  evidence: z.object({
    acceptedHumanEvents: z.number(),
    uniqueHumanSessions: z.number(),
    uniqueHumanActors: z.number(),
    duplicateEvents: z.number(),
    rejectedEvents: z.number(),
    excludedBySource: z.object({
      agent: z.number(),
      test: z.number(),
      system: z.number(),
    }),
  }),
  insights: z.array(z.string()),
  actionInsights: z.array(z.string()),
  operatorNext: z.object({
    headline: z.string(),
    steps: z.array(z.string()),
    successMetric: z.string(),
  }),
  alphaGate: z.object({
    status: z.enum(["not-started", "warming", "blocked", "ready"]),
    checks: z.object({
      fresh: z.boolean(),
      sampleSize: z.boolean(),
      tutorial: z.boolean(),
      feedback: z.boolean(),
      rivalExposure: z.boolean(),
      rivalAction: z.boolean(),
    }),
    passLabel: z.string(),
    nextCheck: z.string(),
  }),
});

export type VaultFrontDockAssignment = z.infer<
  typeof VaultFrontDockAssignmentSchema
>;
export type VaultFrontDockSummary = z.infer<typeof VaultFrontDockSummarySchema>;
export type VaultFrontRecapAssignment = z.infer<
  typeof VaultFrontRecapAssignmentSchema
>;
export type VaultFrontRecapSummary = z.infer<
  typeof VaultFrontRecapSummarySchema
>;
export type VaultFrontRuntimeAssignment = z.infer<
  typeof VaultFrontRuntimeAssignmentSchema
>;
export type VaultFrontOutcomeTelemetryInput = z.infer<
  typeof VaultFrontOutcomeTelemetryInputSchema
>;
export type VaultFrontOutcomeSummary = z.infer<
  typeof VaultFrontOutcomeSummarySchema
>;
export type VaultFrontFunnelSummary = z.infer<
  typeof VaultFrontFunnelSummarySchema
>;
export type VaultFrontPlaytestPulseEvent = z.infer<
  typeof VaultFrontPlaytestPulseEventSchema
>;
export type VaultFrontPlaytestPulseSummary = z.infer<
  typeof VaultFrontPlaytestPulseSummarySchema
>;

const MasteryDoctrineDefinitionSchema = z.object({
  id: z.enum(["route-reader", "breach-architect", "vault-warden"]),
  name: z.string().min(1).max(64),
  costMastery: z.number().int().nonnegative(),
  role: z.string().min(1).max(80),
  brief: z.string().min(1).max(240),
});

const DailyChallengeSchema = z.object({
  challengeId: z.string().min(1),
  description: z.string().min(1),
  progress: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  rewardMastery: z.number().int().nonnegative(),
  completed: z.boolean(),
  masteryBalance: z.number().int().nonnegative(),
  dateUtc: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  evidence: z.literal("certified-match-result"),
  durability: z.enum(["postgres", "process-local"]),
  doctrines: z.object({
    catalog: z.array(MasteryDoctrineDefinitionSchema),
    ownedIds: z.array(MasteryDoctrineDefinitionSchema.shape.id),
    activeId: MasteryDoctrineDefinitionSchema.shape.id.nullable(),
    effectPolicy: z.literal("coaching-and-identity-only"),
  }),
});

export type DailyChallenge = z.infer<typeof DailyChallengeSchema>;
export type MasteryDoctrineId =
  DailyChallenge["doctrines"]["catalog"][number]["id"];

export async function fetchDailyChallenge(): Promise<DailyChallenge | null> {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetch(`${getApiBase()}/api/vaultfront/daily-challenge`, {
      headers: authHeader ? { Authorization: authHeader } : {},
    });
    if (!res.ok) return null;
    const parsed = DailyChallengeSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const MasteryDoctrineSelectionResponseSchema = z.object({
  receipt: z.object({
    requestId: z.string(),
    doctrineId: MasteryDoctrineDefinitionSchema.shape.id,
    unlockedNow: z.boolean(),
    spentMastery: z.number().int().nonnegative(),
    masteryBalance: z.number().int().nonnegative(),
    durability: z.enum(["postgres", "process-local"]),
    evidence: z.literal("authenticated-mastery-choice"),
    receiptDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  snapshot: DailyChallengeSchema,
});

export type MasteryDoctrineSelectionResult =
  | { ok: true; value: z.infer<typeof MasteryDoctrineSelectionResponseSchema> }
  | { ok: false; error: string };

export async function selectMasteryDoctrine(
  doctrineId: MasteryDoctrineId,
): Promise<MasteryDoctrineSelectionResult> {
  try {
    const authHeader = await getAuthHeader();
    if (!authHeader) return { ok: false, error: "Sign in to spend Mastery" };
    const res = await fetch(`${getApiBase()}/api/vaultfront/mastery-doctrine`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ doctrineId, requestId: crypto.randomUUID() }),
    });
    const body: unknown = await res.json();
    if (!res.ok) {
      const message = z.object({ error: z.string() }).safeParse(body);
      return {
        ok: false,
        error: message.success ? message.data.error : "Doctrine change failed",
      };
    }
    const parsed = MasteryDoctrineSelectionResponseSchema.safeParse(body);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, error: "Invalid doctrine receipt" };
  } catch {
    return { ok: false, error: "Mastery Doctrine unavailable" };
  }
}

export interface VaultFrontContractsSnapshot extends VaultFrontSeasonContractState {
  eloRating: number;
  eloLabel: string;
  matchesPlayed: number;
  isDecaying: boolean;
  eloHistory: number[];
}

export async function fetchVaultFrontContracts(): Promise<
  VaultFrontContractsSnapshot | false
> {
  try {
    const authHeader = await getAuthHeader();
    if (!authHeader) return false;
    const response = await fetch(`${getApiBase()}/api/vaultfront/contracts`, {
      headers: { Authorization: authHeader },
    });
    if (!response.ok) return false;
    const json = await response.json();
    const contracts = VaultFrontSeasonContractStateSchema.safeParse(json);
    if (
      !contracts.success ||
      typeof json.eloRating !== "number" ||
      typeof json.eloLabel !== "string"
    )
      return false;
    return {
      ...contracts.data,
      eloRating: json.eloRating as number,
      eloLabel: json.eloLabel as string,
      matchesPlayed: (json.matchesPlayed as number) ?? 0,
      isDecaying: (json.isDecaying as boolean) ?? false,
      eloHistory: Array.isArray(json.eloHistory)
        ? (json.eloHistory as number[])
        : [],
    };
  } catch {
    return false;
  }
}

function vaultFrontTelemetryEventId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `vf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
async function vaultFrontIdentityHeaders(): Promise<Record<string, string>> {
  const authHeader = await getAuthHeader();
  const playToken = authHeader ? null : await getPlayToken();
  return {
    Authorization: authHeader || `Bearer ${playToken}`,
  };
}

export async function fetchVaultFrontDockAssignment(): Promise<
  VaultFrontDockAssignment | false
> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/ab/dock/assignment`,
      {
        headers: {
          ...(await vaultFrontIdentityHeaders()),
        },
      },
    );
    if (!response.ok) {
      return false;
    }
    const json = await response.json();
    const parsed = VaultFrontDockAssignmentSchema.safeParse(json);
    if (!parsed.success) {
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

export async function recordVaultFrontDockEvent(input: {
  event: string;
  variant?: "top" | "stack";
  value?: 1;
  eventId?: string;
}): Promise<boolean> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/ab/dock/event`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await vaultFrontIdentityHeaders()),
        },
        body: JSON.stringify({
          ...input,
          value: 1,
          eventId: input.eventId ?? vaultFrontTelemetryEventId(),
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchVaultFrontDockSummary(
  adminToken: string,
): Promise<VaultFrontDockSummary | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/ab/dock/summary`,
      {
        headers: {
          "x-admin-key": adminToken,
        },
      },
    );
    if (!response.ok) {
      return false;
    }
    const json = await response.json();
    const parsed = VaultFrontDockSummarySchema.safeParse(json);
    if (!parsed.success) {
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

export async function fetchVaultFrontRecapAssignment(): Promise<
  VaultFrontRecapAssignment | false
> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/ab/recap/assignment`,
      {
        headers: {
          ...(await vaultFrontIdentityHeaders()),
        },
      },
    );
    if (!response.ok) {
      return false;
    }
    const json = await response.json();
    const parsed = VaultFrontRecapAssignmentSchema.safeParse(json);
    if (!parsed.success) {
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

export async function recordVaultFrontRecapEvent(input: {
  event: string;
  variant?: "goal_focus" | "requeue_focus";
  value?: 1;
  eventId?: string;
}): Promise<boolean> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/ab/recap/event`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await vaultFrontIdentityHeaders()),
        },
        body: JSON.stringify({
          ...input,
          value: 1,
          eventId: input.eventId ?? vaultFrontTelemetryEventId(),
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

// ── Mutator Vote ─────────────────────────────────────────────────────────────

export interface MutatorVoteCandidate {
  key: string;
  name: string;
}

export interface MutatorVoteStatus {
  open: boolean;
  candidates: MutatorVoteCandidate[];
  closesAt: number | null;
  effectiveWeek: number;
}

export interface MutatorVoteReceipt {
  accepted: boolean;
  reason:
    | "accepted"
    | "vote-closed"
    | "invalid-candidate"
    | "duplicate-actor"
    | "persistence-unavailable";
  candidateKey: string;
  effectiveWeek: number | null;
  durability: "postgres" | "process-local" | "none";
  receiptDigest: string;
}

/** Returns the current vote window (candidates + close time), or null if no vote is open. */
export async function fetchMutatorVoteStatus(): Promise<MutatorVoteStatus | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/season/current`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.vote?.open) return null;
    return data.vote as MutatorVoteStatus;
  } catch {
    return null;
  }
}

/** Submits a vote for the given candidate key. Returns true on success. */
export async function castMutatorVote(
  candidateKey: string,
): Promise<MutatorVoteReceipt | null> {
  try {
    const authorization = await getAuthHeader();
    if (!authorization) return null;
    const res = await fetch(`${getApiBase()}/api/mutator-vote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({ candidateKey }),
    });
    const data = (await res
      .json()
      .catch(() => null)) as MutatorVoteReceipt | null;
    return data?.receiptDigest ? data : null;
  } catch {
    return null;
  }
}

export async function fetchVaultFrontRecapSummary(
  adminToken: string,
): Promise<VaultFrontRecapSummary | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/ab/recap/summary`,
      {
        headers: {
          "x-admin-key": adminToken,
        },
      },
    );
    if (!response.ok) {
      return false;
    }
    const json = await response.json();
    const parsed = VaultFrontRecapSummarySchema.safeParse(json);
    if (!parsed.success) {
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

export async function fetchVaultFrontRuntimeAssignment(): Promise<
  VaultFrontRuntimeAssignment | false
> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/ab/runtime/assignment`,
      {
        headers: {
          ...(await vaultFrontIdentityHeaders()),
        },
      },
    );
    if (!response.ok) {
      return false;
    }
    const json = await response.json();
    const parsed = VaultFrontRuntimeAssignmentSchema.safeParse(json);
    if (!parsed.success) {
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

export async function recordVaultFrontRuntimeEvent(input: {
  event: string;
  rewardVariant?: "control" | "high_risk_high_reward";
  hudVariant?: "default" | "mobile_priority";
  value?: 1;
  eventId?: string;
}): Promise<boolean> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/ab/runtime/event`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await vaultFrontIdentityHeaders()),
        },
        body: JSON.stringify({
          ...input,
          value: 1,
          eventId: input.eventId ?? vaultFrontTelemetryEventId(),
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function recordVaultFrontOutcomeTelemetry(
  input: VaultFrontOutcomeTelemetryInput,
): Promise<boolean> {
  const parsed = VaultFrontOutcomeTelemetryInputSchema.safeParse(input);
  if (!parsed.success) {
    return false;
  }
  try {
    const response = await fetch(`${getApiBase()}/api/vaultfront/outcome`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await vaultFrontIdentityHeaders()),
      },
      body: JSON.stringify({
        ...parsed.data,
        eventId: vaultFrontTelemetryEventId(),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchVaultFrontOutcomeSummary(
  adminToken: string,
): Promise<VaultFrontOutcomeSummary | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/outcome/summary`,
      {
        headers: {
          "x-admin-key": adminToken,
        },
      },
    );
    if (!response.ok) {
      return false;
    }
    const json = await response.json();
    const parsed = VaultFrontOutcomeSummarySchema.safeParse(json);
    if (!parsed.success) {
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

export async function fetchVaultFrontFunnelSummary(
  adminToken: string,
): Promise<VaultFrontFunnelSummary | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/funnel/summary`,
      {
        headers: {
          "x-admin-key": adminToken,
        },
      },
    );
    if (!response.ok) {
      return false;
    }
    const json = await response.json();
    const parsed = VaultFrontFunnelSummarySchema.safeParse(json);
    if (!parsed.success) {
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

const VAULTFRONT_EVIDENCE_SESSION_KEY = "vaultfront:evidence-session:v1";

function evidenceIdentifier(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}:${uuid ?? `${Date.now()}:${Math.random().toString(36).slice(2)}`}`;
}

function evidenceSessionId(): string {
  try {
    const existing = sessionStorage.getItem(VAULTFRONT_EVIDENCE_SESSION_KEY);
    if (existing) return existing;
    const created = evidenceIdentifier("session");
    sessionStorage.setItem(VAULTFRONT_EVIDENCE_SESSION_KEY, created);
    return created;
  } catch {
    return evidenceIdentifier("session");
  }
}

export async function recordVaultFrontPlaytestPulse(
  input: VaultFrontPlaytestPulseEvent,
): Promise<boolean> {
  const parsed = VaultFrontPlaytestPulseEventSchema.safeParse(input);
  if (!parsed.success) return false;
  try {
    const authHeader = await getAuthHeader();
    const fallbackToken = authHeader ? null : await getPlayToken();
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/playtest-pulse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader || `Bearer ${fallbackToken}`,
        },
        body: JSON.stringify({
          ...parsed.data,
          value: 1,
          evidenceSessionId: evidenceSessionId(),
          eventId: evidenceIdentifier("event"),
          source: "human",
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
export async function fetchVaultFrontPlaytestPulseSummary(): Promise<
  VaultFrontPlaytestPulseSummary | false
> {
  try {
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/playtest-pulse/summary`,
    );
    if (!response.ok) {
      return false;
    }
    const json = await response.json();
    const parsed = VaultFrontPlaytestPulseSummarySchema.safeParse(json);
    if (!parsed.success) {
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

// ── Match invite deep links ───────────────────────────────────────────────

export interface InviteLinkResponse {
  gameId: string;
  mapName: string;
  playerCount: number;
  phase: string;
  shareUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
}

export async function requestInviteLink(
  gameId: string,
): Promise<InviteLinkResponse | false> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/invite/${encodeURIComponent(gameId)}`,
    );
    if (!res.ok) return false;
    return (await res.json()) as InviteLinkResponse;
  } catch {
    return false;
  }
}

export async function shareMatchInvite(gameId: string): Promise<void> {
  const info = await requestInviteLink(gameId);
  if (!info) return;
  if (navigator.share) {
    try {
      await navigator.share({
        title: info.ogTitle,
        text: info.ogDescription,
        url: info.shareUrl,
      });
      return;
    } catch {
      // fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(info.shareUrl);
  } catch {
    // clipboard blocked — nothing to do
  }
}

// ── Rematch queue ─────────────────────────────────────────────────────────

export interface RematchStatus {
  gameId: string;
  lobbyId: string;
  code: string;
  mapName: string;
  participantCount: number;
  expiresAt: number;
  joinUrl: string;
  status: "ready";
}

const RematchStatusSchema = z.object({
  gameId: z.string(),
  lobbyId: z.string(),
  code: z.string(),
  mapName: z.string(),
  participantCount: z.number().int().positive(),
  expiresAt: z.number(),
  joinUrl: z.string().url(),
  status: z.literal("ready"),
});

export async function createRematch(
  gameId: string,
  _legacyPlayerId?: string,
): Promise<RematchStatus | false> {
  try {
    const authHeader = await getAuthHeader();
    const fallbackToken = authHeader ? null : await getPlayToken();
    const res = await fetch(
      `${getApiBase()}/api/rematch/${encodeURIComponent(gameId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader || `Bearer ${fallbackToken}`,
        },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) return false;
    const parsed = RematchStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : false;
  } catch {
    return false;
  }
}

export async function getRematchStatus(
  gameId: string,
): Promise<RematchStatus | false> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/rematch/status/${encodeURIComponent(gameId)}`,
    );
    if (!res.ok) return false;
    const parsed = RematchStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : false;
  } catch {
    return false;
  }
}
// ── Replay highlights ─────────────────────────────────────────────────────

export interface ReplayHighlight {
  gameId: string;
  highlightId: string;
  topMoment: string;
  autoHighlightTick?: number;
  clipStartTurn: number;
  clipEndTurn: number;
  shareUrl: string;
  ogTitle: string;
}

export async function requestReplayHighlight(
  gameId: string,
): Promise<ReplayHighlight | false> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/replay/${encodeURIComponent(gameId)}/highlight`,
    );
    if (!res.ok) return false;
    return (await res.json()) as ReplayHighlight;
  } catch {
    return false;
  }
}

/**
 * Creates a user-defined clip for a replay at a specific tick range.
 * Returns the share URL, or null on failure.
 */
export async function createCustomClip(
  gameId: string,
  startTick: number,
  endTick: number,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/replay/${encodeURIComponent(gameId)}/clip`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTick, endTick }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { shareUrl?: string };
    return data.shareUrl ?? null;
  } catch {
    return null;
  }
}

export async function shareReplayHighlight(gameId: string): Promise<void> {
  const highlight = await requestReplayHighlight(gameId);
  if (!highlight) return;
  if (navigator.share) {
    try {
      await navigator.share({
        title: highlight.ogTitle,
        url: highlight.shareUrl,
      });
      return;
    } catch {
      // fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(highlight.shareUrl);
  } catch {
    // clipboard blocked
  }
}

// ── Dynasty Story Engine ────────────────────────────────────────────────────

export async function fetchDynastyStory(
  clanId: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/vaultfront/dynasty-story/${encodeURIComponent(clanId)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { story?: string };
    return data.story ?? null;
  } catch {
    return null;
  }
}

export async function generateDynastyStoryChapter(input: {
  gameId: string;
}): Promise<{ chapter: string; story: string } | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/vaultfront/dynasty-story`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await vaultFrontIdentityHeaders()),
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      chapter?: string;
      story?: string;
    };
    if (!data.ok) return null;
    return { chapter: data.chapter ?? "", story: data.story ?? "" };
  } catch {
    return null;
  }
}

// ── IGNIS Founder Signal ────────────────────────────────────────────────────

export async function recordIgnisSignal(input: {
  itemSlug: string;
  signal: "accept" | "reject" | "pivot";
  sessionId?: string;
}): Promise<void> {
  try {
    await fetch(`${getApiBase()}/api/ignis/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    // fire-and-forget
  }
}

// ── Match Oracle (pre-match ELO prediction) ─────────────────────────────────

export async function fetchMatchOracle(
  playerIds: string[],
  signal?: AbortSignal,
): Promise<{
  predictions: Array<{
    playerId: string;
    deltaIfWin: number;
    deltaIfLoss: number;
    threat?: string;
  }>;
} | null> {
  try {
    const params = new URLSearchParams();
    playerIds.forEach((id) => params.append("players", id));
    const res = await fetch(
      `${getApiBase()}/api/vaultfront/match-oracle?${params.toString()}`,
      { headers: await vaultFrontIdentityHeaders(), signal },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      predictions: Array<{
        playerId: string;
        deltaIfWin: number;
        deltaIfLoss: number;
        threat?: string;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchMatchProphecy(
  mapName: string,
  playerCount: number,
  mutator: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/vaultfront/match-prophecy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapName, playerCount, mutator }),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; prophecy?: string };
    return data.prophecy ?? null;
  } catch {
    return null;
  }
}

// ── Micro-Coach Hint ────────────────────────────────────────────────────────

export function subscribeNarrator(
  gameId: string,
  onCommentary: (text: string) => void,
): () => void {
  const url = `${getApiBase()}/api/vaultfront/narrator/${encodeURIComponent(gameId)}`;
  const es = new EventSource(url);
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data as string) as {
        type: string;
        text?: string;
      };
      if (data.type === "commentary" && data.text) onCommentary(data.text);
    } catch {
      // ignore
    }
  };
  return () => es.close();
}

// ── Session 5 API functions ────────────────────────────────────────────────

export type PlayStyle =
  "Iron Fist" | "Convoy Lord" | "Shadow Broker" | "Fortress" | "Balanced";

export interface AchievementProgress {
  id: string;
  unlockedAt: number | null;
  progress: number;
  progressLabel: string;
}

export interface MetaChainProgress {
  id: string;
  name: string;
  description: string;
  reward: { badge: string; title: string };
  requires: string[];
  completedRequires: string[];
  unlocked: boolean;
  unlockedAt: number | null;
}

export interface FortuneItem {
  id: string;
  name: string;
  description: string;
  type: "title" | "badge" | "emoji";
  rarity: "common" | "rare" | "legendary";
  value: string;
}

export interface StyleEntry {
  matchId: string;
  style: PlayStyle;
  confidence?: number;
  timestamp: number;
}

export interface SeasonMilestoneProgress {
  milestone: {
    id: string;
    tier: number;
    title: string;
    description: string;
    metric: string;
    target: number;
    reward: { type: string; value: string };
  };
  progress: number;
  target: number;
  pct: number;
  unlocked: boolean;
  claimed: boolean;
}

export interface SeasonEntitlement {
  milestoneId: string;
  type: "title" | "badge";
  value: string;
  claimedAt: string;
}

export async function fetchAchievements(persistentId: string): Promise<{
  achievements: AchievementProgress[];
  metaChains: MetaChainProgress[];
} | null> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/vaultfront/achievements/${encodeURIComponent(persistentId)}`,
      { headers: await vaultFrontIdentityHeaders() },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      achievements: AchievementProgress[];
      metaChains: MetaChainProgress[];
    };
  } catch {
    return null;
  }
}

export async function fetchStyleHistory(persistentId: string): Promise<{
  history: StyleEntry[];
  trend: { style: PlayStyle; count: number } | null;
} | null> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/vaultfront/style-history/${encodeURIComponent(persistentId)}`,
      { headers: await vaultFrontIdentityHeaders() },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      history: StyleEntry[];
      trend: { style: PlayStyle; count: number } | null;
    };
  } catch {
    return null;
  }
}

export async function fetchWinFortune(
  persistentId: string,
  matchId: string,
): Promise<{ item: FortuneItem; alreadyOwned: boolean } | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/vaultfront/win-fortune`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await vaultFrontIdentityHeaders()),
      },
      body: JSON.stringify({ persistentId, matchId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { item: FortuneItem; alreadyOwned: boolean };
  } catch {
    return null;
  }
}

export async function fetchPrematchBrief(
  persistentId: string,
  mapName: string,
  style?: PlayStyle,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = new URL(`${getApiBase()}/api/vaultfront/prematch-brief`);
    url.searchParams.set("persistentId", persistentId);
    url.searchParams.set("mapName", mapName);
    if (style) url.searchParams.set("style", style);
    const res = await fetch(url.toString(), {
      headers: await vaultFrontIdentityHeaders(),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { brief?: string };
    return data.brief ?? null;
  } catch {
    return null;
  }
}

export async function fetchMatchRecap(
  gameId: string,
  winner: string,
  events: string,
  durationSec: number,
): Promise<string | null> {
  try {
    // Legacy callers still provide client projections, but certified recap
    // evidence is deliberately server-owned and ignores all three values.
    void winner;
    void events;
    void durationSec;
    const url = `${getApiBase()}/api/vaultfront/match-recap/${encodeURIComponent(gameId)}`;
    const res = await fetch(url, {
      headers: await vaultFrontIdentityHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { recap?: string };
    return data.recap ?? null;
  } catch {
    return null;
  }
}

export interface CoachDebriefMoment {
  tick: number;
  decision: string;
  optimal: string;
  why: string;
}

export async function fetchCoachDebrief(params: {
  persistentId: string;
  gameId: string;
  activityLog?: Array<{ type: string; tick: number; detail?: string }>;
  matchStats?: {
    won: boolean;
    vaultCaptures?: number;
    convoyDeliveries?: number;
    style?: string;
  };
}): Promise<CoachDebriefMoment[] | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/vaultfront/coach-debrief`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await vaultFrontIdentityHeaders()),
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { moments?: CoachDebriefMoment[] };
    return data.moments ?? null;
  } catch {
    return null;
  }
}

export type MatchFeedbackSignal =
  | "decisive-convoy"
  | "comeback-tension"
  | "clear-objectives"
  | "pacing-drag"
  | "map-flow"
  | "control-friction"
  | "technical-friction";

export interface MatchRatingReceipt {
  accepted: boolean;
  duplicate: boolean;
  gameId: string;
  mapName: string;
  durability: "postgres" | "process-local";
  evidence: "certified-match-result";
  retentionDays: 30;
  signal: MatchFeedbackSignal | null;
}

export type MatchRatingSubmission =
  | { status: "accepted" | "duplicate"; receipt: MatchRatingReceipt }
  | { status: "rejected" | "unavailable"; detail: string };

export async function postMatchRating(params: {
  gameId: string;
  persistentId?: string;
  matchRating: number;
  mapRating: number;
  mapName?: string;
  signal?: MatchFeedbackSignal;
}): Promise<MatchRatingSubmission> {
  try {
    const res = await fetch(`${getApiBase()}/api/vaultfront/match-rating`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await vaultFrontIdentityHeaders()),
      },
      body: JSON.stringify(params),
    });
    const data = (await res.json().catch(() => null)) as
      MatchRatingReceipt | { error?: string } | null;
    if (
      data &&
      "evidence" in data &&
      data.evidence === "certified-match-result"
    ) {
      if (res.status === 201 && data.accepted) {
        return { status: "accepted", receipt: data };
      }
      if (res.status === 409 && data.duplicate) {
        return { status: "duplicate", receipt: data };
      }
    }
    const errorDetail = data && "error" in data ? data.error : undefined;
    return {
      status: "rejected",
      detail:
        errorDetail ?? `Certified feedback was rejected (HTTP ${res.status}).`,
    };
  } catch {
    return {
      status: "unavailable",
      detail: "Certified feedback is temporarily unavailable. Please retry.",
    };
  }
}

export async function fetchSeasonProgress(persistentId: string): Promise<{
  seasonId: string;
  milestones: SeasonMilestoneProgress[];
  entitlements?: SeasonEntitlement[];
  evidence?: "certified-match-result";
  durability?: "postgres" | "process-local";
} | null> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/vaultfront/season-progress/${encodeURIComponent(persistentId)}`,
      { headers: await vaultFrontIdentityHeaders() },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      seasonId: string;
      milestones: SeasonMilestoneProgress[];
      entitlements?: SeasonEntitlement[];
      evidence?: "certified-match-result";
      durability?: "postgres" | "process-local";
    };
  } catch {
    return null;
  }
}

export interface PlayerProgressionSnapshot {
  eloRating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  vaultCaptures: number;
  convoyDeliveries: number;
  executionChains: number;
}

export interface CertifiedProgressionDividend {
  status: "verified";
  gameId: string;
  recordedAt: string;
  durability: "postgres" | "process-local";
  receiptDigest: string;
  dividend: {
    persistentId: string;
    before: PlayerProgressionSnapshot | null;
    after: PlayerProgressionSnapshot | null;
    delta: PlayerProgressionSnapshot;
    achievementsUnlocked: string[];
    dailyMastery: {
      challengeId: string;
      progress: number;
      target: number;
      rewardMastery: number;
      completedNow: boolean;
      durability: "postgres" | "process-local";
    } | null;
    seasonPass: {
      seasonId: string;
      milestones: SeasonMilestoneProgress[];
      durability: "postgres" | "process-local";
    } | null;
    match: {
      vaultPressureContributions: number;
      vaultCaptures: number;
      convoyDeliveries: number;
      executionChains: number;
      won: boolean;
    };
  };
}

export async function fetchMatchProgressionDividend(
  gameId: string,
): Promise<CertifiedProgressionDividend | null> {
  try {
    const authorization = await getAuthHeader();
    if (!authorization) return null;
    const response = await fetch(
      `${getApiBase()}/api/vaultfront/progression-dividend/${encodeURIComponent(gameId)}`,
      { headers: { Authorization: authorization } },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as CertifiedProgressionDividend;
    return body.status === "verified" &&
      /^sha256:[a-f0-9]{64}$/.test(body.receiptDigest)
      ? body
      : null;
  } catch {
    return null;
  }
}

export async function claimSeasonMilestone(
  persistentId: string,
  milestoneId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/vaultfront/season-progress/claim`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await vaultFrontIdentityHeaders()),
        },
        body: JSON.stringify({ persistentId, milestoneId }),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { claimed?: boolean };
    return data.claimed ?? false;
  } catch {
    return false;
  }
}

export async function fetchPredictionLeaderboard(weekOnly = false): Promise<
  Array<{
    spectatorId: string;
    accuracy: number;
    totalPredictions: number;
    weeklyScore: number;
  }>
> {
  try {
    const url = `${getApiBase()}/api/vaultfront/prediction-league/leaderboard?week=${weekOnly ? "1" : "0"}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      leaderboard?: Array<{
        spectatorId: string;
        accuracy: number;
        totalPredictions: number;
        weeklyScore: number;
      }>;
    };
    return data.leaderboard ?? [];
  } catch {
    return [];
  }
}

export type PredictionOutcome = "intercept" | "delivery";

export interface PredictionSubmissionResult {
  accepted: boolean;
  reason: "accepted" | "duplicate-or-closed" | "unavailable";
  durability?: "postgres" | "process-local";
  consensus?: PredictionConsensus;
}

export interface PredictionConsensus {
  gameId: string;
  interceptPct: number;
  deliveryPct: number;
  total: number;
  status: "open" | "resolved";
  durability: "postgres" | "process-local";
}

export async function submitPredictionLeaguePick(
  gameId: string,
  outcome: PredictionOutcome,
): Promise<PredictionSubmissionResult> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/vaultfront/prediction-league/predict`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await vaultFrontIdentityHeaders()),
        },
        body: JSON.stringify({ gameId, outcome }),
      },
    );
    if (res.status !== 201 && res.status !== 409) {
      return { accepted: false, reason: "unavailable" };
    }
    return (await res.json()) as PredictionSubmissionResult;
  } catch {
    return { accepted: false, reason: "unavailable" };
  }
}

export async function fetchPredictionLeagueStats(): Promise<{
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  weeklyScore: number;
} | null> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/vaultfront/prediction-league/stats`,
      { headers: await vaultFrontIdentityHeaders() },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      stats?: {
        totalPredictions: number;
        correctPredictions: number;
        accuracy: number;
        weeklyScore: number;
      } | null;
    };
    return data.stats ?? null;
  } catch {
    return null;
  }
}

export async function fetchPredictionConsensus(
  gameId: string,
): Promise<PredictionConsensus | null> {
  try {
    const res = await fetch(
      `${getApiBase()}/api/vaultfront/prediction-league/games/${encodeURIComponent(gameId)}/consensus`,
    );
    if (!res.ok) return null;
    return (await res.json()) as PredictionConsensus;
  } catch {
    return null;
  }
}
