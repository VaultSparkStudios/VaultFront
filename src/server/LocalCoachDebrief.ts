import type { GameRecord } from "../core/Schemas";
import { CoachOutputSchema, type CoachOutput } from "./CanonicalAiEvidence";

const labels: Record<string, string> = {
  attack: "land attack",
  boat: "naval attack",
  build_unit: "structure build",
  upgrade_structure: "structure upgrade",
  set_resource_focus: "resource focus change",
  vault_convoy_command: "convoy command",
  defense_factory_command: "defense command",
  vault_role_ping: "Vault role signal",
  donate_gold: "gold support",
  donate_troops: "troop support",
  allianceRequest: "alliance request",
  embargo: "embargo",
};

function advice(
  intentType: string | null,
  phase: string,
): { decision: string; optimal: string; why: string } {
  if (!intentType) {
    return {
      decision: `Replay read · ${phase} tempo`,
      optimal:
        "Set one explicit economy, pressure, or support objective for this phase.",
      why: "The certified replay contains no committed command from you in this phase; this is an activity observation, not a claim about intent.",
    };
  }
  const label = labels[intentType] ?? intentType.replace(/_/gu, " ");
  if (["attack", "boat", "embargo"].includes(intentType)) {
    return {
      decision: `Replay read · ${phase} ${label}`,
      optimal:
        "Pair pressure with a visible resource margin and a defined follow-up objective.",
      why: `Your certified timeline records a ${label} here. The replay proves timing, while outcome causality still requires a comparative playtest.`,
    };
  }
  if (
    ["build_unit", "upgrade_structure", "set_resource_focus"].includes(
      intentType,
    )
  ) {
    return {
      decision: `Replay read · ${phase} ${label}`,
      optimal:
        "Connect this investment to the next Vault, convoy, or defensive timing window.",
      why: `The certified replay records a ${label}; treating it as a timed setup makes the next decision measurable without inventing causality.`,
    };
  }
  if (
    [
      "vault_convoy_command",
      "defense_factory_command",
      "vault_role_ping",
    ].includes(intentType)
  ) {
    return {
      decision: `Replay read · ${phase} ${label}`,
      optimal:
        "Pre-commit the next route, escort, or breach response before the window tightens.",
      why: `The certified replay records this VaultFront command. The recommendation is a deterministic timing prompt, not a generated claim that it won or lost the match.`,
    };
  }
  return {
    decision: `Replay read · ${phase} ${label}`,
    optimal:
      "Name the next measurable objective before issuing the follow-up command.",
    why: `The certified replay records a ${label}; this coach baseline only interprets observable order timing.`,
  };
}

export function buildLocalCoachDebrief(
  record: GameRecord,
  clientId: string,
): CoachOutput {
  const maxTick = Math.max(0, record.info.num_turns);
  const phases = [
    { name: "opening", start: 0, end: Math.floor(maxTick / 3) },
    {
      name: "midgame",
      start: Math.floor(maxTick / 3) + 1,
      end: Math.floor((maxTick * 2) / 3),
    },
    { name: "closing", start: Math.floor((maxTick * 2) / 3) + 1, end: maxTick },
  ];
  const moments = phases.map((phase) => {
    const turn = record.turns.find(
      (candidate) =>
        candidate.turnNumber >= phase.start &&
        candidate.turnNumber <= phase.end &&
        candidate.intents.some((intent) => intent.clientID === clientId),
    );
    const intent = turn?.intents.find(
      (candidate) => candidate.clientID === clientId,
    );
    return {
      tick: turn?.turnNumber ?? Math.min(maxTick, Math.max(0, phase.start)),
      ...advice(intent?.type ?? null, phase.name),
    };
  });
  return CoachOutputSchema.parse(moments);
}
