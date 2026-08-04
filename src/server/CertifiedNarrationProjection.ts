import type { StampedIntent } from "../core/Schemas";

export const CERTIFIED_NARRATION_AUTHORITY = "accepted-game-intent" as const;

export interface CertifiedNarrationEvent {
  authority: typeof CERTIFIED_NARRATION_AUTHORITY;
  intentType: StampedIntent["type"];
  label: string;
}

const convoyLabels = {
  reroute_city: "A vault convoy rerouted toward an urban stronghold.",
  reroute_port: "A vault convoy pivoted toward a strategic port.",
  reroute_factory: "A vault convoy rerouted toward industrial cover.",
  reroute_silo: "A vault convoy committed to a high-value silo route.",
  reroute_safest: "A vault convoy abandoned speed for the safest corridor.",
  escort: "An escort screen formed around a vault convoy.",
  sell_intel: "A team converted vault intelligence into leverage.",
  vault_heist: "A vault heist was committed.",
} as const;

const rolePingLabels = {
  escort_convoy: "An escort call echoed across the front.",
  intercept_lane: "An interception lane was called out.",
  pulse_soon: "A warning announced an imminent vault pulse.",
} as const;

/**
 * Projects only accepted, high-signal intents into privacy-minimal narration.
 * Player identifiers and caller-provided prose never enter the commentary bus.
 */
export function projectCertifiedNarration(
  intent: StampedIntent,
): CertifiedNarrationEvent | null {
  let label: string;
  switch (intent.type) {
    case "vault_convoy_command":
      label = convoyLabels[intent.command];
      break;
    case "defense_factory_command":
      label = "A defense factory deployed a signal jammer.";
      break;
    case "vault_role_ping":
      label = rolePingLabels[intent.ping];
      break;
    case "attack":
      label = "A new offensive crossed the line.";
      break;
    case "boat":
      label = "A naval offensive opened a second front.";
      break;
    case "build_unit":
      label = "A strategic unit entered production.";
      break;
    case "upgrade_structure":
      label = "A frontline structure was upgraded.";
      break;
    default:
      return null;
  }
  return {
    authority: CERTIFIED_NARRATION_AUTHORITY,
    intentType: intent.type,
    label,
  };
}
