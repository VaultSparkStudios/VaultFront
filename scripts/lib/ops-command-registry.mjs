export const OPS_COMMANDS = Object.freeze({
  "blocker-preflight": { script: "blocker-preflight.mjs" },
  "startup-brief": { script: "render-startup-brief.mjs" },
  "closeout-board": { script: "render-closeout-board.mjs" },
  "closeout-summary": { script: "closeout-summary.mjs" },
  "genius-list": {
    script: "generate-genius-list.mjs",
    defaultArgs: ["--write"],
  },
  "innovation-pack": { script: "innovation-pack.mjs" },
  "write-session-lock": { script: "write-session-lock.mjs" },
  "check-secrets": { script: "check-secrets.mjs" },
  doctor: { script: "project-doctor.mjs" },
  onboard: { script: "onboard-project.mjs" },
  rescore: { script: "rescore-project.mjs" },
  "sanitize-settings": { script: "sanitize-claude-settings.mjs" },
  "state-vector": { script: "render-state-vector.mjs" },
  entropy: { script: "compute-entropy.mjs" },
  "genome-snapshot": { script: "append-genome-snapshot.mjs" },
  "closeout-autopilot": { script: "closeout-autopilot.mjs" },
});

export function commandArgs(command, suppliedArgs) {
  const entry = OPS_COMMANDS[command];
  if (!entry) return null;
  return suppliedArgs.length > 0
    ? [...suppliedArgs]
    : [...(entry.defaultArgs ?? [])];
}
