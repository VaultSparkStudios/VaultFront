export const predictionLeagueContract = Object.freeze({
  notice: "Pick the whole-match convoy balance",
  question:
    "Will this match finish with at least as many deliveries as interceptions?",
  deliveryChoice: "Deliveries win (ties included)",
  interceptChoice: "Interceptions win",
  rule: "All convoy deliveries and interceptions in the match are counted. A tie resolves to delivery.",
});

export function resolvePredictionLeagueOutcome(
  deliveries: number,
  intercepts: number,
): "delivery" | "intercept" {
  return deliveries >= intercepts ? "delivery" : "intercept";
}
