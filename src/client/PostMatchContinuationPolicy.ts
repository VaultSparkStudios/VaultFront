export type PostMatchContinuationAction =
  "requeue" | "rematch" | "keep" | "spectate";

export interface PostMatchContinuationInput {
  isRanked: boolean;
  rivalryRevengeDelta: number;
  nextGoalSaved: boolean;
  isAlive: boolean;
}

export function selectPostMatchContinuationAction(
  input: PostMatchContinuationInput,
): PostMatchContinuationAction {
  if (input.isRanked) return "requeue";
  if (input.rivalryRevengeDelta > 0 || input.nextGoalSaved) return "rematch";
  return input.isAlive ? "keep" : "spectate";
}
