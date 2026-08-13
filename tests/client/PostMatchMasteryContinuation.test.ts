import { describe, expect, test, vi } from "vitest";
import {
  POST_MATCH_MASTERY_CONTINUE_EVENT,
  PostMatchMasteryContinuationCoordinator,
} from "../../src/client/PostMatchMasteryContinuation";

describe("PostMatchMasteryContinuationCoordinator", () => {
  test("owns one listener and forwards the source match exactly while active", () => {
    const source = new EventTarget();
    const target = { requestMasteryRematch: vi.fn() };
    const coordinator = new PostMatchMasteryContinuationCoordinator(
      source,
      target,
    );
    const event = () =>
      new CustomEvent(POST_MATCH_MASTERY_CONTINUE_EVENT, {
        detail: {
          sourceGameId: "game-1",
          goal: "Escort the first convoy",
          evidence: "certified",
          doctrine: null,
        },
      });

    coordinator.init();
    coordinator.init();
    source.dispatchEvent(event());
    expect(target.requestMasteryRematch).toHaveBeenCalledOnce();
    expect(target.requestMasteryRematch).toHaveBeenCalledWith("game-1");

    coordinator.dispose();
    coordinator.dispose();
    source.dispatchEvent(event());
    expect(target.requestMasteryRematch).toHaveBeenCalledOnce();
  });
});
