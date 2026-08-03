import { describe, expect, it } from "vitest";
import { selectPostMatchContinuation } from "../../src/client/PostMatchContinuation";
import { PostMatchContinuationCard } from "../../src/client/PostMatchContinuationCard";

describe("selectPostMatchContinuation", () => {
  it("prioritizes ranked requeue over every lower-context action", () => {
    expect(
      selectPostMatchContinuation({
        isRanked: true,
        rivalryRevengeDelta: 3,
        nextGoalSaved: true,
        isAlive: true,
      }).action,
    ).toBe("requeue");
  });

  it("turns a casual rivalry into a contextual rematch", () => {
    const continuation = selectPostMatchContinuation({
      isRanked: false,
      rivalryRevengeDelta: 2,
      nextGoalSaved: false,
      isAlive: false,
    });
    expect(continuation).toMatchObject({
      action: "rematch",
      eyebrow: "Rivalry continuation",
    });
    expect(continuation.reason).toContain("2 revenge counters");
  });

  it("falls back to a truthful live-board action", () => {
    expect(
      selectPostMatchContinuation({
        isRanked: false,
        rivalryRevengeDelta: 0,
        nextGoalSaved: false,
        isAlive: true,
      }).action,
    ).toBe("keep");
  });

  it("carries a saved goal into a casual rematch", () => {
    expect(
      selectPostMatchContinuation({
        isRanked: false,
        rivalryRevengeDelta: 0,
        nextGoalSaved: true,
        isAlive: true,
      }).action,
    ).toBe("rematch");
  });

  it("recommends spectating when the current board is no longer playable", () => {
    expect(
      selectPostMatchContinuation({
        isRanked: false,
        rivalryRevengeDelta: 0,
        nextGoalSaved: false,
        isAlive: false,
      }).action,
    ).toBe("spectate");
  });
});

describe("PostMatchContinuationCard", () => {
  it("emits only the evidence-selected action", async () => {
    const card = new PostMatchContinuationCard();
    card.context = {
      isRanked: true,
      rivalryRevengeDelta: 0,
      nextGoalSaved: false,
      isAlive: true,
    };
    document.body.append(card);
    await card.updateComplete;
    const actions: string[] = [];
    card.addEventListener("post-match-continue", (event) =>
      actions.push((event as CustomEvent<{ action: string }>).detail.action),
    );

    (card.querySelector("button") as HTMLButtonElement).click();

    expect(actions).toEqual(["requeue"]);
    card.remove();
  });
});
