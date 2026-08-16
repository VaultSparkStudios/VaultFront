import { render } from "lit";
import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  submitPredictionLeaguePick,
  fetchPredictionLeagueStats,
  fetchPredictionConsensus,
} = vi.hoisted(() => ({
  submitPredictionLeaguePick: vi.fn(),
  fetchPredictionLeagueStats: vi.fn(),
  fetchPredictionConsensus: vi.fn(),
}));
vi.mock("../../../src/client/Api", () => ({
  submitPredictionLeaguePick,
  fetchPredictionLeagueStats,
  fetchPredictionConsensus,
}));

import { PredictionLeaguePanel } from "../../../src/client/components/PredictionLeaguePanel";
import { predictionLeagueContract } from "../../../src/shared/PredictionLeagueContract";

describe("PredictionLeaguePanel", () => {
  beforeEach(() => {
    submitPredictionLeaguePick.mockReset();
    fetchPredictionLeagueStats.mockReset().mockResolvedValue({ accuracy: 75 });
    fetchPredictionConsensus.mockReset().mockResolvedValue(null);
  });

  test("becomes reachable only in spectator mode", () => {
    const panel = new PredictionLeaguePanel() as any;
    panel.game = { myPlayer: () => null, gameID: () => "g1" };
    panel.tick();
    expect(panel.visible).toBe(true);
    panel.game = { myPlayer: () => ({ isAlive: () => true }) };
    panel.tick();
    expect(panel.visible).toBe(false);
  });

  test("submits the certified game identity once and locks the choice", async () => {
    submitPredictionLeaguePick.mockResolvedValue({
      accepted: true,
      reason: "accepted",
      durability: "postgres",
      consensus: {
        gameId: "certified-game",
        deliveryPct: 25,
        interceptPct: 75,
        total: 4,
        status: "open",
        durability: "postgres",
      },
    });
    const panel = new PredictionLeaguePanel() as any;
    panel.game = { gameID: () => "certified-game" };
    await panel.submit("intercept");
    await panel.submit("delivery");
    expect(submitPredictionLeaguePick).toHaveBeenCalledTimes(1);
    expect(submitPredictionLeaguePick).toHaveBeenCalledWith(
      "certified-game",
      "intercept",
    );
    expect(panel.selected).toBe("intercept");
    expect(panel.consensus.interceptPct).toBe(75);
    expect(panel.notice).toBe("Prediction locked in");
  });

  test("describes the authoritative whole-match rule and delivery tie break", () => {
    const panel = new PredictionLeaguePanel() as any;
    panel.visible = true;
    const container = document.createElement("div");
    render(panel.render(), container);
    expect(container.textContent).toContain(predictionLeagueContract.question);
    expect(container.textContent).toContain(predictionLeagueContract.rule);
    expect(container.textContent).toContain("ties included");
    expect(container.textContent).not.toContain("next decisive outcome");
  });
});
