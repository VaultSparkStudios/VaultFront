import {
  type PostMatchContinuationAction,
  type PostMatchContinuationInput,
  selectPostMatchContinuationAction,
} from "./PostMatchContinuationPolicy";

export type {
  PostMatchContinuationAction,
  PostMatchContinuationInput,
} from "./PostMatchContinuationPolicy";

export interface PostMatchContinuation {
  action: PostMatchContinuationAction;
  eyebrow: string;
  label: string;
  reason: string;
}

const RECOMMENDED_NEXT_MOVE = "Recommended next move";

export function selectPostMatchContinuation(
  input: PostMatchContinuationInput,
): PostMatchContinuation {
  const action = selectPostMatchContinuationAction(input);
  if (action === "requeue") {
    return {
      action: "requeue",
      eyebrow: RECOMMENDED_NEXT_MOVE,
      label: "Play the next ranked match",
      reason: "Keep the ranked run moving while this result is fresh.",
    };
  }
  if (input.rivalryRevengeDelta > 0) {
    return {
      action: "rematch",
      eyebrow: "Rivalry continuation",
      label: "Settle the rivalry",
      reason: `${input.rivalryRevengeDelta} revenge ${
        input.rivalryRevengeDelta === 1 ? "counter is" : "counters are"
      } ready for the rematch.`,
    };
  }
  if (action === "rematch") {
    return {
      action: "rematch",
      eyebrow: "Goal continuation",
      label: "Run the saved plan",
      reason: "Carry your next-match goal directly into a fresh lobby.",
    };
  }
  return action === "keep"
    ? {
        action: "keep",
        eyebrow: RECOMMENDED_NEXT_MOVE,
        label: "Keep shaping the map",
        reason: "Your nation is alive; keep shaping the current board.",
      }
    : {
        action: "spectate",
        eyebrow: RECOMMENDED_NEXT_MOVE,
        label: "Watch the finish",
        reason: "Watch the remaining decisions before starting another match.",
      };
}
